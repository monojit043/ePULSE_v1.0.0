const { pool } = require('../db/pool');
const XLSX     = require('xlsx');
const multer   = require('multer');
const path     = require('path');

// ── Create / migrate table on startup ──
pool.query(`
  CREATE TABLE IF NOT EXISTS lms_data (
    id          SERIAL PRIMARY KEY,
    job_no      VARCHAR(50)  NOT NULL,
    unit_no     VARCHAR(50)  NOT NULL,
    line_no     VARCHAR(200),
    equip_raw   VARCHAR(500),
    row_data    JSONB,
    uploaded_by VARCHAR(50),
    uploaded_at TIMESTAMPTZ  DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_lms_data_job_unit ON lms_data(job_no, unit_no);
  CREATE INDEX IF NOT EXISTS idx_lms_data_line_no  ON lms_data(job_no, unit_no, line_no);
  ALTER TABLE lms_data ADD COLUMN IF NOT EXISTS lms_type VARCHAR(100) NOT NULL DEFAULT 'General';
  CREATE INDEX IF NOT EXISTS idx_lms_data_type ON lms_data(job_no, unit_no, lms_type);
  ALTER TABLE lms_data ADD COLUMN IF NOT EXISTS tag_no VARCHAR(200);
  -- Fixed category names run past 100 chars (ED-01 is 103). Widening a
  -- varchar is metadata-only in PostgreSQL: no rewrite, existing rows untouched.
  ALTER TABLE lms_data ALTER COLUMN lms_type TYPE VARCHAR(255);
  -- Original uploaded Excel, saved in the same transaction as its rows so the
  -- Upload History can hand back exactly the file that produced the data.
  CREATE TABLE IF NOT EXISTS lms_uploads (
    id          SERIAL PRIMARY KEY,
    job_no      VARCHAR(50)  NOT NULL,
    unit_no     VARCHAR(50)  NOT NULL,
    lms_type    VARCHAR(255) NOT NULL,
    file_name   VARCHAR(500) NOT NULL,
    file_data   BYTEA        NOT NULL,
    uploaded_by VARCHAR(50),
    uploaded_at TIMESTAMPTZ  DEFAULT NOW()
  );
  ALTER TABLE lms_data ADD COLUMN IF NOT EXISTS upload_id INTEGER REFERENCES lms_uploads(id) ON DELETE SET NULL;
`).catch(console.error);

// ── Multer — memory storage ──
const _upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) return cb(null, true);
    cb(new Error('Only .xlsx / .xls / .csv files are accepted'));
  },
}).single('file');

// ── Normalise a cell value for matching (strip non-breaking spaces, collapse whitespace) ──
function normalise(v) {
  return String(v ?? '')
    .replace(/ /g, ' ')   // non-breaking space → regular space
    .replace(/\s+/g, ' ')      // collapse all whitespace
    .trim()
    .toLowerCase();
}

// ── Scan first 50 rows for the "Equipment no. / Line no." column ──
// Returns { headerRowIdx, colEquip, allHeaders, headerLabel }
// On failure returns { error, scanned } with debug info about what was found
function detectLmsHeaders(rawRows) {
  const scanned = [];   // for debug output on failure

  for (let i = 0; i < Math.min(50, rawRows.length); i++) {
    const row = rawRows[i] || [];

    // Collect non-empty cell texts for this row (for debug)
    const texts = row
      .filter(c => c != null && String(c).trim() !== '')
      .map(c => String(c).substring(0, 60));
    if (texts.length) scanned.push(`Row ${i + 1}: ${texts.join(' | ')}`);

    // Match any cell whose normalised text contains "equipment"
    const equipIdx = row.findIndex(c => normalise(c).includes('equipment'));
    if (equipIdx < 0) continue;

    return {
      headerRowIdx: i,
      colEquip:     equipIdx,
      headerLabel:  String(row[equipIdx]).trim(),
      allHeaders:   row.map((c, idx) =>
        (c != null && String(c).trim()) ? String(c).trim() : `Col${idx + 1}`
      ),
    };
  }

  // Not found — return debug info so the UI can show it
  return {
    notFound: true,
    scanned,
  };
}

// ── Extract base line_no from LMS values — zone suffix is intentionally dropped ──
// Examples:
//   2"-P-101-12000-A-IH   → P-101-12000  (zone -A dropped; drawings match on base)
//   2"-P-111-12404-D5D-IH → P-111-12404  (pipe-class -D5D not captured)
// Zone is stripped here so that P-101-12000-A, -B, -C in drawings all resolve
// to the same LMS rows.
function extractLineNo(raw) {
  if (!raw) return null;
  // Matches PREFIX-UNIT-SEQNO anywhere in the raw string (e.g. "2"-TRM-111-VV1227-01-A-IH")
  // PREFIX: one or more letters  UNIT: digits  SEQNO: 1-7 alphanumeric chars
  const m = String(raw).match(/([A-Za-z]+-\d+-[A-Za-z0-9]{1,7})/);
  return m ? m[1] : null;
}

// ── Instrument tag: UNIT-TYPE-NUMBER, e.g. 101-PSV-11301 / 101-PSV-11301A ──
// Unit is the FIRST segment (unlike line numbers, where it's the second).
// Instrument type is letters only (never digits); the number may carry a
// letter suffix.
function extractTag(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(?:^|[^A-Za-z0-9])(\d+)-([A-Za-z]+)-([A-Za-z0-9]+)/);
  return m ? { tag: `${m[1]}-${m[2]}-${m[3]}`, unit: m[1] } : null;
}

// "Tag no." column on the already-found header row. Whole-word match so
// headers like "Stage" don't count. Optional — some LMS types have no tags.
function findTagColumn(headerRow) {
  return (headerRow || []).findIndex(c => /\btag\b/.test(normalise(c)));
}

const normUnit = u => String(u ?? '').trim().toUpperCase();
const lineUnitOf = baseLineNo => (baseLineNo ? String(baseLineNo).split('-')[1] || null : null);

// Read the workbook into plain rows. Same sheet/header detection as before;
// additionally picks up the optional Tag column. Pure — no DB access.
function parseLmsFile(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (!workbook.SheetNames.length) return { ok: false, error: 'Excel file has no sheets' };

  // ── Scan every sheet in order — use the first one that has the Equipment column ──
  let rawRows = null, usedSheet = null, found = null;
  for (const sName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sName], { header: 1, defval: null });
    const result = detectLmsHeaders(rows);
    if (!result.notFound) { rawRows = rows; usedSheet = sName; found = result; break; }
  }

  if (!found) {
    // Collect debug lines from all sheets for the error message
    const allScanned = workbook.SheetNames.map(sName => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sName], { header: 1, defval: null });
      const r    = detectLmsHeaders(rows);
      return `Sheet "${sName}": ${r.scanned.length ? r.scanned.join(' / ') : '(empty)'}`;
    });
    console.warn('LMS header not found in any sheet.\n' + allScanned.join('\n'));
    return {
      ok: false,
      error: `Could not find "Equipment no. / Line no." column in any of the ${workbook.SheetNames.length} sheet(s).`,
      scanned: allScanned,
    };
  }

  const { headerRowIdx, colEquip, allHeaders, headerLabel } = found;
  const colTag = findTagColumn(rawRows[headerRowIdx]);
  const rows = [];
  rawRows.slice(headerRowIdx + 1).forEach((row, i) => {
    const equipRaw = (row[colEquip] != null) ? String(row[colEquip]).trim() : null;
    if (!equipRaw) return;   // skip empty rows (unchanged rule)
    const tagRaw = (colTag >= 0 && row[colTag] != null) ? String(row[colTag]).trim() || null : null;

    // Build JSONB row from all header columns (preserve order)
    const rowData = {};
    allHeaders.forEach((h, idx) => { if (row[idx] != null) rowData[h] = row[idx]; });

    rows.push({
      excelRow: headerRowIdx + 2 + i,
      equipRaw, tagRaw, rowData,
      lineNo: extractLineNo(equipRaw),
      tag: extractTag(tagRaw),
    });
  });

  return {
    ok: true, rows, usedSheet,
    headerRow:   headerRowIdx + 1,
    equipColumn: headerLabel,
    tagColumn:   colTag >= 0 ? allHeaders[colTag] : null,
  };
}

// ── Unit routing (same rules as the stress index upload) ─────────────────────
// Each row's unit comes from its instrument TAG when readable (1st segment),
// otherwise from its LINE number (2nd segment). Tag and line disagreeing →
// the tag wins and the row is flagged "unit mismatch".
//   • Normal/child unit selected → only that unit's rows are accepted.
//   • Master unit selected → master + its child units, each row stored under
//     its own unit.
//   • Rows of other units are skipped (reported, never saved).
//   • Rows with neither a readable tag nor line stay under the selected unit
//     (as before) and are reported as "unrecognised".
//   • Only units with rows in the file have this CATEGORY replaced; a child
//     unit absent from the file keeps its data (warned). Other categories
//     are never touched.
//   • Rows already stored under the SELECTED unit (this category) that belong
//     to another unit are removed — cleans up earlier mis-uploads.
//   • Nothing in the file belongs to the selection → refused.
function rowUnitOf(tagUnit, lineUnit) {
  return tagUnit || lineUnit || null;
}

async function buildLmsPlan(db, jobNo, unitNo, lmsType, parsed) {
  const { rows: childRows } = await db.query(
    `SELECT DISTINCT child_unit FROM master_units
     WHERE project_id=$1 AND master_unit=$2 ORDER BY child_unit`,
    [jobNo, unitNo]
  );
  const children = childRows.map(r => r.child_unit).filter(u => normUnit(u) !== normUnit(unitNo));
  const isMaster = children.length > 0;
  const allowed  = [unitNo, ...children];
  const allowedByNorm = new Map(allowed.map(u => [normUnit(u), u]));

  const rowsByUnit = new Map();
  const preview = [];
  let unrecognised = 0, mismatch = 0, skipped = 0;
  const skippedUnits = new Set();

  for (const p of parsed.rows) {
    const tagUnit  = p.tag ? p.tag.unit : null;
    const lineUnit = lineUnitOf(p.lineNo);
    const ownUnit  = rowUnitOf(tagUnit, lineUnit);
    const isMismatch = !!(tagUnit && lineUnit && normUnit(tagUnit) !== normUnit(lineUnit));

    let status, target;
    if (!ownUnit) {
      status = 'unrecognised'; target = unitNo; unrecognised++;
    } else if (allowedByNorm.has(normUnit(ownUnit))) {
      target = allowedByNorm.get(normUnit(ownUnit));
      status = isMismatch ? 'mismatch' : 'ok';
      if (isMismatch) mismatch++;
    } else {
      status = 'skipped'; target = null; skipped++; skippedUnits.add(ownUnit);
    }

    preview.push({
      excelRow: p.excelRow, tagRaw: p.tagRaw, equipRaw: p.equipRaw,
      tagNo: p.tag ? p.tag.tag : null, lineNo: p.lineNo,
      tagUnit, lineUnit, unitNo: target, status,
    });
    if (target) {
      if (!rowsByUnit.has(target)) rowsByUnit.set(target, []);
      rowsByUnit.get(target).push(p);
    }
  }

  // Existing rows of THIS category for every unit the upload can touch
  const { rows: existing } = await db.query(
    `SELECT id, unit_no, tag_no, line_no FROM lms_data
     WHERE job_no=$1 AND unit_no=ANY($2) AND lms_type=$3`,
    [jobNo, allowed, lmsType]
  );
  const existingByUnit = new Map(allowed.map(u => [u, []]));
  for (const r of existing) existingByUnit.get(r.unit_no)?.push(r);

  const units = [];      // units whose category data changes
  const untouched = [];  // allowed units with no rows in the file

  for (const u of allowed) {
    const ex = existingByUnit.get(u) || [];
    // An existing row is misplaced when its own unit (tag first, then line)
    // is known and isn't this unit. Unrecognised rows are left alone.
    const wrongIds = ex.filter(r => {
      const own = rowUnitOf(extractTag(r.tag_no)?.unit || null, lineUnitOf(r.line_no));
      return own && normUnit(own) !== normUnit(u);
    }).map(r => r.id);
    const fileRows = rowsByUnit.get(u);

    if (fileRows) {
      units.push({ unitNo: u, inFile: true, fileRows: fileRows.length,
                   replacesExisting: ex.length, removedWrongUnit: wrongIds.length,
                   wrongIds: [], rows: fileRows });
    } else {
      if (u === unitNo && wrongIds.length) {
        units.push({ unitNo: u, inFile: false, fileRows: 0, replacesExisting: 0,
                     removedWrongUnit: wrongIds.length, wrongIds, rows: [] });
      }
      if (isMaster) untouched.push({ unitNo: u, existingCount: ex.length - (u === unitNo ? wrongIds.length : 0) });
    }
  }

  let refusal = null;
  if (!rowsByUnit.size) {
    const scope = isMaster ? `unit ${unitNo} or its child units ${children.join(', ')}` : `unit ${unitNo}`;
    refusal = `No rows in this file belong to ${scope}` +
      (skippedUnits.size ? ` (file contains units ${[...skippedUnits].sort().join(', ')})` : '') +
      '. Nothing was changed.';
  }

  const accepted = preview.filter(p => p.unitNo);
  const summary = {
    total:            parsed.rows.length,
    accepted:         accepted.length,
    linesMatched:     accepted.filter(p => p.lineNo).length,
    tagsMatched:      accepted.filter(p => p.tagNo).length,
    mismatch, unrecognised, skipped,
    skippedUnits:     [...skippedUnits].sort(),
    removedWrongUnit: units.reduce((a, u) => a + u.removedWrongUnit, 0),
    sheetName:        parsed.usedSheet,
    headerRow:        parsed.headerRow,
    equipColumn:      parsed.equipColumn,
    tagColumn:        parsed.tagColumn,
  };

  return { isMaster, children, units, untouched, preview, summary, refusal };
}

function publicLmsUnits(plan) {
  return plan.units.map(({ rows, wrongIds, ...u }) => u);
}

// The only LMS categories an upload may use — single source of truth, the
// page reads it via GET /api/lms/categories. Names are stored verbatim as
// lms_data.lms_type, so changing a name later orphans rows saved under the
// old one.
const LMS_CATEGORIES = [
  'CONTROL VALVES, SHUTDOWN/ ON-OFF VALVES, SELF- ACTUATED CONTROL VALVES, DESUPERHEATERS AND PRDS (ED-01)',
  'PRESSURE RELIEF VALVES, BREATHER VALVES, RUPTURE DISCS, FLAME ARRESTERS (ED-20)',
  'SPECIAL FLOW INSTRUMENTS AND MISCELLANEOUS INSTRUMENTS (ED-03)',
  'Interface Details for Analysers (ED-04)',
  'TEMPERATURE INSTRUMENT DETAILS (ED-05)',
];

// GET /api/lms/categories
function getLmsCategories(_req, res) {
  res.json({ ok: true, categories: LMS_CATEGORIES });
}

// Shared request validation for preview + apply
function readLmsRequest(req, res) {
  if (!req.file) { res.status(400).json({ ok: false, error: 'No file uploaded' }); return null; }
  const { jobNo, unitNo, lmsType } = req.body;
  if (!jobNo || !unitNo) { res.status(400).json({ ok: false, error: 'jobNo and unitNo are required' }); return null; }
  const effectiveLmsType = String(lmsType ?? '').trim();
  if (!LMS_CATEGORIES.includes(effectiveLmsType)) {
    res.status(400).json({ ok: false, error: 'Select one of the listed LMS categories.' });
    return null;
  }
  const parsed = parseLmsFile(req.file.buffer);
  if (!parsed.ok) { res.status(400).json(parsed); return null; }
  if (!parsed.rows.length) {
    res.status(400).json({ ok: false, error: `No data rows found under "${parsed.equipColumn}".` });
    return null;
  }
  return { jobNo, unitNo, lmsType: effectiveLmsType, parsed };
}

// POST /api/lms/preview — dry run, changes nothing
async function previewLmsData(req, res) {
  _upload(req, res, async (multerErr) => {
    if (multerErr) return res.status(400).json({ ok: false, error: multerErr.message });
    let input;
    try { input = readLmsRequest(req, res); } catch (err) {
      console.error('previewLmsData parse error:', err);
      return res.status(400).json({ ok: false, error: 'Could not read the Excel file' });
    }
    if (!input) return;
    try {
      const plan = await buildLmsPlan(pool, input.jobNo, input.unitNo, input.lmsType, input.parsed);
      if (plan.refusal) return res.status(400).json({ ok: false, error: plan.refusal });
      res.json({
        ok: true, jobNo: input.jobNo, unitNo: input.unitNo, lmsType: input.lmsType,
        isMaster: plan.isMaster, children: plan.children,
        summary: plan.summary, units: publicLmsUnits(plan), untouched: plan.untouched,
        preview: plan.preview,
      });
    } catch (err) {
      console.error('previewLmsData error:', err);
      res.status(500).json({ ok: false, error: 'Failed to process file' });
    }
  });
}

// POST /api/lms/apply (also /api/lms/upload) — one transaction across all units
async function uploadLmsData(req, res) {
  _upload(req, res, async (multerErr) => {
    if (multerErr) return res.status(400).json({ ok: false, error: multerErr.message });
    let input;
    try { input = readLmsRequest(req, res); } catch (err) {
      console.error('uploadLmsData parse error:', err);
      return res.status(400).json({ ok: false, error: 'Could not read the Excel file' });
    }
    if (!input) return;
    const { jobNo, unitNo, lmsType, parsed } = input;
    const userId = req.session?.user?.id ?? null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Plan rebuilt here (not trusted from the preview) so the rules hold
      // even if the preview step is bypassed.
      const plan = await buildLmsPlan(client, jobNo, unitNo, lmsType, parsed);
      if (plan.refusal) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: plan.refusal });
      }

      // multer decodes the multipart filename as latin1 — restore UTF-8
      const fileName = Buffer.from(req.file.originalname || 'lms.xlsx', 'latin1').toString('utf8');
      const { rows: [upl] } = await client.query(
        `INSERT INTO lms_uploads (job_no, unit_no, lms_type, file_name, file_data, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [jobNo, unitNo, lmsType, fileName.slice(0, 500), req.file.buffer, userId]
      );

      let inserted = 0, removed = 0;
      for (const u of plan.units) {
        if (u.inFile) {
          // Replace this unit's data for THIS category only
          const del = await client.query(
            'DELETE FROM lms_data WHERE job_no=$1 AND unit_no=$2 AND lms_type=$3',
            [jobNo, u.unitNo, lmsType]
          );
          removed += del.rowCount;
          await client.query(
            `INSERT INTO lms_data (job_no, unit_no, line_no, equip_raw, row_data, uploaded_by, lms_type, tag_no, upload_id)
             SELECT $1, $2, t.line_no, t.equip_raw, t.row_data::jsonb, $3, $4, t.tag_no, $9
             FROM unnest($5::text[], $6::text[], $7::text[], $8::text[])
               AS t(line_no, equip_raw, row_data, tag_no)`,
            [jobNo, u.unitNo, userId, lmsType,
             u.rows.map(p => p.lineNo), u.rows.map(p => p.equipRaw),
             u.rows.map(p => JSON.stringify(p.rowData)), u.rows.map(p => p.tagRaw ? p.tagRaw.slice(0, 200) : null), upl.id]
          );
          inserted += u.rows.length;
        } else if (u.wrongIds.length) {
          const del = await client.query('DELETE FROM lms_data WHERE id = ANY($1::int[])', [u.wrongIds]);
          removed += del.rowCount;
        }
      }
      // Keep only files that still back current data in this job — a file
      // whose rows were all replaced is no longer anyone's "original".
      await client.query(
        `DELETE FROM lms_uploads lu WHERE lu.job_no=$1
           AND NOT EXISTS (SELECT 1 FROM lms_data d WHERE d.upload_id = lu.id)`,
        [jobNo]
      );
      await client.query('COMMIT');

      const s = plan.summary;
      res.json({
        ok:          true,
        inserted,
        removed,
        matched:     s.linesMatched,
        unmatched:   s.accepted - s.linesMatched,
        tagsMatched: s.tagsMatched,
        mismatch:    s.mismatch,
        unrecognised: s.unrecognised,
        skipped:     s.skipped,
        skippedUnits: s.skippedUnits,
        removedWrongUnit: s.removedWrongUnit,
        isMaster:    plan.isMaster,
        units:       publicLmsUnits(plan),
        untouched:   plan.untouched,
        lmsType,
        headerRow:   s.headerRow,
        equipColumn: s.equipColumn,
        tagColumn:   s.tagColumn,
        sheetName:   s.sheetName,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('uploadLmsData error:', err);
      res.status(500).json({ ok: false, error: 'Failed to process file — nothing was changed' });
    } finally {
      client.release();
    }
  });
}

// GET /api/lms/line?project=X&unit=Y&lineNo=Z — all items for a single line, used by line details modal
// lineNo may include a zone suffix (e.g. P-101-12000-A); we strip it before matching
// because lms_data stores only the base (P-101-12000), so zones A/B/C all resolve to the same rows.
async function getLmsByLine(req, res) {
  const { project, unit, lineNo } = req.query;
  if (!project || !unit || !lineNo)
    return res.status(400).json({ ok: false, error: 'project, unit, lineNo required' });

  // Extract base PREFIX-UNIT-SEQNO, dropping zone and subline
  // e.g. TRM-111-VV1227-01-A → TRM-111-VV1227,  P-101-12000-A → P-101-12000
  const _m = String(lineNo).match(/^([A-Za-z]+-\d+-[A-Za-z0-9]{1,7})/);
  const baseLineNo = _m ? _m[1] : lineNo.replace(/-[A-Za-z]$/, '');

  try {
    const { rows } = await pool.query(
      `SELECT id, line_no, tag_no, equip_raw, row_data, lms_type, uploaded_at
       FROM lms_data
       WHERE job_no=$1 AND unit_no=$2 AND line_no=$3
       ORDER BY lms_type, id`,
      [project, unit, baseLineNo]
    );
    res.json({
      ok:    true,
      count: rows.length,
      rows:  rows.map(r => ({
        id:         r.id,
        lineNo:     r.line_no,
        tagNo:      r.tag_no,
        equipRaw:   r.equip_raw,
        rowData:    r.row_data,
        lmsType:    r.lms_type,
        uploadedAt: r.uploaded_at,
      })),
    });
  } catch (err) {
    console.error('getLmsByLine error:', err);
    res.status(500).json({ ok: false, error: 'Failed' });
  }
}

// GET /api/lms/data?project=X&unit=Y
async function getLmsData(req, res) {
  const { project, unit } = req.query;
  if (!project || !unit)
    return res.status(400).json({ ok: false, error: 'project and unit required' });

  try {
    const { rows } = await pool.query(
      `SELECT id, line_no, tag_no, equip_raw, row_data, lms_type, uploaded_at
       FROM lms_data
       WHERE job_no=$1 AND unit_no=$2
       ORDER BY lms_type, id`,
      [project, unit]
    );
    res.json({
      ok:    true,
      count: rows.length,
      rows:  rows.map(r => ({
        id:         r.id,
        lineNo:     r.line_no,
        tagNo:      r.tag_no,
        equipRaw:   r.equip_raw,
        rowData:    r.row_data,
        lmsType:    r.lms_type,
        uploadedAt: r.uploaded_at,
      })),
    });
  } catch (err) {
    console.error('getLmsData error:', err);
    res.status(500).json({ ok: false, error: 'Failed' });
  }
}

// GET /api/lms/summary — one entry per job+unit
async function getLmsSummary(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT d.job_no, d.unit_no, d.lms_type,
              COUNT(*)::int            AS row_count,
              COUNT(d.line_no)::int    AS matched_count,
              MAX(d.uploaded_at)       AS uploaded_at,
              MAX(d.upload_id)         AS upload_id,
              (SELECT lu.file_name FROM lms_uploads lu WHERE lu.id = MAX(d.upload_id)) AS file_name
       FROM lms_data d
       GROUP BY d.job_no, d.unit_no, d.lms_type
       ORDER BY d.job_no, d.unit_no, d.lms_type`
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('getLmsSummary error:', err);
    res.status(500).json({ ok: false, error: 'Failed' });
  }
}

// GET /api/lms/original?project=X&unit=Y&type=Z — the exact Excel that was
// uploaded for this job/unit/category (Upload History "Download"). A master
// unit upload serves the same file for each of its child units.
async function downloadLmsOriginal(req, res) {
  const { project, unit, type } = req.query;
  if (!project || !unit || !type)
    return res.status(400).json({ ok: false, error: 'project, unit and type required' });
  try {
    const { rows } = await pool.query(
      `SELECT lu.file_name, lu.file_data
       FROM lms_uploads lu
       WHERE lu.id = (SELECT MAX(upload_id) FROM lms_data
                      WHERE job_no=$1 AND unit_no=$2 AND lms_type=$3)`,
      [project, unit, type]
    );
    if (!rows.length)
      return res.status(404).json({ ok: false, error: 'Original file not available — this data was uploaded before original files were stored. Re-upload it to enable download.' });
    const { file_name, file_data } = rows[0];
    const ascii = file_name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file_name)}`);
    res.setHeader('Content-Type', /\.csv$/i.test(file_name) ? 'text/csv'
      : /\.xls$/i.test(file_name) ? 'application/vnd.ms-excel'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(file_data);
  } catch (err) {
    console.error('downloadLmsOriginal error:', err);
    res.status(500).json({ ok: false, error: 'Download failed' });
  }
}

// GET /api/lms/export?project=X&unit=Y — stream Excel download
async function exportLmsData(req, res) {
  const { project, unit } = req.query;
  if (!project || !unit)
    return res.status(400).json({ ok: false, error: 'project and unit required' });

  try {
    const { rows } = await pool.query(
      `SELECT line_no, equip_raw, row_data, uploaded_at
       FROM lms_data
       WHERE job_no=$1 AND unit_no=$2
       ORDER BY id`,
      [project, unit]
    );
    if (!rows.length)
      return res.status(404).json({ ok: false, error: 'No data found for this project / unit' });

    // Collect all unique column headers (preserving insertion order across rows)
    const allKeys = [];
    const keySet  = new Set();
    rows.forEach(r => {
      if (r.row_data) {
        Object.keys(r.row_data).forEach(k => {
          if (!keySet.has(k)) { keySet.add(k); allKeys.push(k); }
        });
      }
    });

    const sheetData = rows.map(r => {
      const obj = { 'Line No (Extracted)': r.line_no || '' };
      allKeys.forEach(k => { obj[k] = r.row_data?.[k] ?? ''; });
      return obj;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, 'LMS Data');

    const buf        = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const uploadedAt = rows[0].uploaded_at
      ? new Date(rows[0].uploaded_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : '';
    const filename   = `LMS_${project}_${unit}_${uploadedAt.replace(/ /g, '-')}.xlsx`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error('exportLmsData error:', err);
    res.status(500).json({ ok: false, error: 'Export failed' });
  }
}

module.exports = { downloadLmsOriginal, getLmsCategories, previewLmsData, uploadLmsData, getLmsByLine, getLmsData, getLmsSummary, exportLmsData };
