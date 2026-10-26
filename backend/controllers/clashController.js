const { pool } = require('../db/pool');
const XLSX     = require('xlsx');
const multer   = require('multer');
const path     = require('path');
const fsp      = require('fs').promises;
const userQ    = require('../db/queries/userQueries');

// Clash data is owned by ePULSE. iso_clash_items is read by GAD here and by
// PIMS on PC-2 (remotely) — nothing else on this PC reads it.
// Every uploaded Excel file is kept as-is under uploads/clash/{job}/{unit}/
// and logged in clash_uploads; iso_clash_items always holds only the latest.
const CLASH_FILES_ROOT = path.join(__dirname, '..', 'uploads', 'clash');

pool.query(`
  CREATE TABLE IF NOT EXISTS clash_uploads (
    id              SERIAL PRIMARY KEY,
    job_no          VARCHAR(50)   NOT NULL,
    unit_no         VARCHAR(50)   NOT NULL,
    original_name   VARCHAR(300)  NOT NULL,
    stored_file     VARCHAR(400)  NOT NULL,
    file_size       INTEGER,
    row_count       INTEGER,
    mismatch_count  INTEGER,       -- rows skipped (pipeline unit ≠ selected unit, or unreadable)
    uploaded_by     VARCHAR(20),
    uploaded_at     TIMESTAMPTZ   DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_clash_uploads_job_unit ON clash_uploads(job_no, unit_no, uploaded_at DESC);
`).catch(console.error);

// Who may upload: HOD, or anyone holding a non-Modeller role on that job/unit
// in PIMS (read live from PC-2). Users who are only Modeller there may not.
async function canUploadClash(user, jobNo, unitNo) {
  if (user.isHod) return true;
  const roles = await userQ.getRolesForUnit(user.id, jobNo, unitNo);
  return roles.some(r => r !== 'Modeller');
}

// ── Create / migrate table on startup ──
// Self-migrating (same pattern as inch_data / iso_special_items) rather than
// living in a schema file nothing actually runs.
//
// Clash reports are generated PER UNIT (confirmed with the user — not one
// federated job-wide run), so the replace-on-upload must be scoped to only
// the units actually present in each upload: uploading unit 101's report
// must not wipe out unit 102's previously-uploaded clashes. `unit_no` is
// parsed from each row's PIPELINE value (e.g. "P-101-17902B-A" → "101")
// specifically so the delete can be scoped by ANY(units-in-this-file)
// instead of the whole job — see uploadClashReport below.
//
// `pipeline` is matched EXACTLY (not zone-agnostic like linelist matching) —
// zone is the last segment of this string (e.g. "P-101-17902B-A") and a
// clash in zone A is a physically different situation from the same line
// number in zone B, so the two must never be merged.
pool.query(`
  CREATE TABLE IF NOT EXISTS iso_clash_items (
    id            SERIAL PRIMARY KEY,
    job_no        VARCHAR(50)  NOT NULL,
    unit_no       VARCHAR(50),
    item_oid      VARCHAR(100),
    pipeline      VARCHAR(200) NOT NULL,
    item          VARCHAR(200),
    clashing_with VARCHAR(200),
    clash_x       NUMERIC,
    clash_y       NUMERIC,
    clash_z       NUMERIC,
    remark        TEXT,
    clash_status  VARCHAR(100),
    clash_type    VARCHAR(100),
    marker_name   VARCHAR(200),
    uploaded_by   VARCHAR(20),
    uploaded_at   TIMESTAMPTZ  DEFAULT NOW()
  );
  ALTER TABLE iso_clash_items ADD COLUMN IF NOT EXISTS unit_no VARCHAR(50);
  CREATE INDEX IF NOT EXISTS idx_iso_clash_items_job      ON iso_clash_items(job_no);
  CREATE INDEX IF NOT EXISTS idx_iso_clash_items_pipeline ON iso_clash_items(job_no, pipeline);
  CREATE INDEX IF NOT EXISTS idx_iso_clash_items_unit     ON iso_clash_items(job_no, unit_no);
`).catch(console.error);

// Extract unit number from a PIPELINE value, e.g. "P-101-17902B-A" → "101".
// Matches this app's own line-number convention (see public/js/upload.js's
// LINE_PATTERN: {FLUID}-{UNIT}-{SEQ}[-{SUBLINE}]-{ZONE}) — unit is always
// the second hyphen-separated, all-digit token.
function extractUnitNo(pipeline) {
  const m = /^[A-Za-z]+-(\d+)-/.exec(pipeline || '');
  return m ? m[1] : null;
}

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

// ── Scan the first N rows of a sheet (as array-of-arrays) to locate headers ──
const HEADER_SCAN_ROWS = 15;

function norm(c) {
  return String(c ?? '').replace(/\s+/g, ' ').trim();
}

// Column headers per the real S3D clash report export:
// ITEM OID | PIPELINE | ITEM | CLASHING WITH | CLASH POSITION -X/-Y/-Z |
// REMARK | CLASH STATUS | CLASH TYPE | MARKER NAME
function detectHeaders(rawRows) {
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, rawRows.length); i++) {
    const row = (rawRows[i] || []).map(norm);
    const pipelineIdx = row.findIndex(c => /^pipeline$/i.test(c));
    if (pipelineIdx < 0) continue;

    const col = (re) => row.findIndex(c => re.test(c));
    return {
      headerRowIdx:  i,
      colItemOid:    col(/^item\s*oid$/i),
      colPipeline:   pipelineIdx,
      colItem:       row.findIndex((c, idx) => idx !== pipelineIdx && /^item$/i.test(c)),
      colClashWith:  col(/^clashing\s*with$/i),
      colX:          col(/clash\s*position\s*-?\s*x/i),
      colY:          col(/clash\s*position\s*-?\s*y/i),
      colZ:          col(/clash\s*position\s*-?\s*z/i),
      colRemark:     col(/^remark$/i),
      colStatus:     col(/^clash\s*status$/i),
      colType:       col(/^clash\s*type$/i),
      colMarker:     col(/^marker\s*name$/i),
      headerLabels: { pipeline: row[pipelineIdx] },
    };
  }
  return null;
}

// POST /api/clash/upload
// Body (multipart): file, jobNo, unitNo
async function uploadClashReport(req, res) {
  _upload(req, res, async (multerErr) => {
    if (multerErr) return res.status(400).json({ ok: false, error: multerErr.message });
    if (!req.file)  return res.status(400).json({ ok: false, error: 'No file uploaded' });

    const { jobNo, unitNo } = req.body;
    if (!jobNo || !unitNo)
      return res.status(400).json({ ok: false, error: 'jobNo and unitNo are required' });

    const userId = req.session?.user?.id ?? null;

    try {
      if (!(await canUploadClash(req.session.user, jobNo, unitNo))) {
        return res.status(403).json({
          ok: false,
          error: `Not authorised — you need a role other than Modeller on ${jobNo} / unit ${unitNo} in PIMS to upload clash reports.`,
        });
      }

      const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
      if (!workbook.SheetNames.length)
        return res.status(400).json({ ok: false, error: 'Excel file has no sheets' });

      // Search every sheet for the header row — don't assume SheetNames[0]
      // is the data sheet (same lesson learned from the INCH DIA upload).
      let rawRows = null;
      let found   = null;
      for (const name of workbook.SheetNames) {
        const candidateRows = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
          header: 1,
          defval: null,
        });
        const candidateFound = detectHeaders(candidateRows);
        if (candidateFound) {
          rawRows = candidateRows;
          found   = candidateFound;
          break;
        }
      }

      if (!found) {
        return res.status(400).json({
          ok: false,
          error: `Could not find a "PIPELINE" column in the first ${HEADER_SCAN_ROWS} rows of any sheet ` +
                 `(checked: ${workbook.SheetNames.join(', ')})`,
        });
      }

      const {
        headerRowIdx, colItemOid, colPipeline, colItem, colClashWith,
        colX, colY, colZ, colRemark, colStatus, colType, colMarker, headerLabels,
      } = found;
      const dataRows = rawRows.slice(headerRowIdx + 1);

      // Parse every row. Only rows whose PIPELINE unit (e.g. "P-101-17902B-A" → 101)
      // equals the selected unit are stored. Rows for another unit, or whose
      // unit can't be read from PIPELINE, are skipped and reported.
      const parsedRows = [];
      let mismatchCount = 0;     // pipeline belongs to a different unit
      let unparsedCount = 0;     // unit not readable from pipeline
      const skippedSamples = []; // first few skipped pipelines, for the message
      for (const row of dataRows) {
        const raw = (col) => (col >= 0 && row[col] != null ? row[col] : null);
        const str = (col) => { const v = raw(col); return v != null ? String(v).trim() : null; };
        const num = (col) => { const v = raw(col); const n = parseFloat(v); return isNaN(n) ? null : n; };

        const pipeline = str(colPipeline);
        if (!pipeline) continue; // skip blank / subtotal rows

        const rowUnit = extractUnitNo(pipeline);
        if (rowUnit !== String(unitNo)) {
          if (rowUnit) mismatchCount++; else unparsedCount++;
          if (skippedSamples.length < 5) skippedSamples.push(pipeline);
          continue;
        }

        parsedRows.push({
          pipeline,
          itemOid: str(colItemOid), item: str(colItem), clashingWith: str(colClashWith),
          x: num(colX), y: num(colY), z: num(colZ),
          remark: str(colRemark), status: str(colStatus), type: str(colType), marker: str(colMarker),
        });
      }

      const skippedCount = mismatchCount + unparsedCount;
      const skippedList  = skippedSamples.join(', ') + (skippedCount > skippedSamples.length ? ', …' : '');

      // Every row belongs to another unit → almost certainly the wrong file.
      // Reject without touching this unit's existing data. (A report with no
      // clash rows at all is still accepted: it means every clash is resolved.)
      if (!parsedRows.length && skippedCount > 0) {
        return res.status(400).json({
          ok: false,
          error: `No rows in this file belong to unit ${unitNo} — all ${skippedCount} row(s) were for another unit ` +
                 `or had no readable unit (e.g. ${skippedList}). Nothing was changed. Check the selected unit or the file.`,
        });
      }

      // Keep the original file exactly as uploaded
      const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const safeName = req.file.originalname.replace(/[^\w.\-]/g, '_');
      const storedRel = path.join(String(jobNo), String(unitNo), `${ts}_${safeName}`);
      const storedAbs = path.join(CLASH_FILES_ROOT, storedRel);
      await fsp.mkdir(path.dirname(storedAbs), { recursive: true });
      await fsp.writeFile(storedAbs, req.file.buffer);

      const client = await pool.connect();
      let inserted = 0;
      try {
        await client.query('BEGIN');

        // Hard replace — scoped to exactly the selected job+unit. No history
        // kept: a clash absent from a re-upload of this unit is resolved and
        // simply disappears (per explicit product decision). Other units are
        // never touched by this query.
        await client.query(`DELETE FROM iso_clash_items WHERE job_no=$1 AND unit_no=$2`, [jobNo, unitNo]);

        for (const r of parsedRows) {
          await client.query(
            `INSERT INTO iso_clash_items
               (job_no, unit_no, item_oid, pipeline, item, clashing_with,
                clash_x, clash_y, clash_z, remark, clash_status, clash_type, marker_name, uploaded_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              jobNo, unitNo, r.itemOid, r.pipeline, r.item, r.clashingWith,
              r.x, r.y, r.z, r.remark, r.status, r.type, r.marker,
              userId,
            ]
          );
          inserted++;
        }

        await client.query(
          `INSERT INTO clash_uploads
             (job_no, unit_no, original_name, stored_file, file_size, row_count, mismatch_count, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [jobNo, unitNo, req.file.originalname, storedRel.replace(/\\/g, '/'),
           req.file.size, inserted, skippedCount, userId]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        await fsp.unlink(storedAbs).catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      const parts = [];
      if (mismatchCount) parts.push(`${mismatchCount} for another unit`);
      if (unparsedCount) parts.push(`${unparsedCount} with no readable unit`);
      const mismatchNote = skippedCount > 0
        ? ` ⚠ ${skippedCount} row(s) skipped — ${parts.join(', ')} in PIPELINE (e.g. ${skippedList}).`
        : '';
      res.json({
        ok: true,
        inserted,
        skippedCount,
        mismatchCount,
        unparsedCount,
        headerRow: headerRowIdx + 1,
        headerLabels,
        message: `${inserted} clash row(s) saved for ${jobNo} / ${unitNo} (headers found on row ${headerRowIdx + 1}: "${headerLabels.pipeline}"). ` +
                 `Only this unit's previous clash data was replaced — other units in this job are untouched. Original file kept.${mismatchNote}`,
      });
    } catch (err) {
      console.error('uploadClashReport error:', err);
      res.status(500).json({ ok: false, error: 'Failed to process file' });
    }
  });
}

// GET /api/clash/data?jobNo=X&unitNo=Y — all rows for a job+unit, used by
// clash-upload.html preview (mirrors inchController.js's getInchData)
async function getClashData(req, res) {
  const { jobNo, unitNo } = req.query;
  if (!jobNo || !unitNo) return res.status(400).json({ ok: false, error: 'jobNo and unitNo required' });

  try {
    const { rows } = await pool.query(
      `SELECT id, unit_no, item_oid, pipeline, item, clashing_with,
              clash_x, clash_y, clash_z, remark, clash_status, clash_type, marker_name, uploaded_at
       FROM iso_clash_items
       WHERE job_no=$1 AND unit_no=$2
       ORDER BY pipeline, id`,
      [jobNo, unitNo]
    );
    res.json({ ok: true, count: rows.length, rows });
  } catch (err) {
    console.error('getClashData error:', err);
    res.status(500).json({ ok: false, error: 'Failed' });
  }
}

// GET /api/clash/summary — one entry per job+unit (mirrors inchController.js's getInchSummary)
async function getClashSummary(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT job_no, unit_no,
              COUNT(*)::int                  AS row_count,
              COUNT(DISTINCT pipeline)::int   AS line_count,
              MAX(uploaded_at)                AS uploaded_at
       FROM iso_clash_items
       GROUP BY job_no, unit_no
       ORDER BY job_no, unit_no`
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('getClashSummary error:', err);
    res.status(500).json({ ok: false, error: 'Failed' });
  }
}

// GET /api/clash/files?jobNo=X&unitNo=Y — every Excel file ever uploaded (newest first)
async function getClashFiles(req, res) {
  const { jobNo, unitNo } = req.query;
  const where = [], params = [];
  if (jobNo)  { params.push(jobNo);  where.push(`c.job_no = $${params.length}`); }
  if (unitNo) { params.push(unitNo); where.push(`c.unit_no = $${params.length}`); }
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.job_no, c.unit_no, c.original_name, c.file_size, c.row_count,
              c.mismatch_count, c.uploaded_by, u.name AS uploaded_by_name, c.uploaded_at
       FROM clash_uploads c
       LEFT JOIN users u ON u.id = c.uploaded_by
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY c.uploaded_at DESC
       LIMIT 500`,
      params
    );
    res.json({ ok: true, files: rows });
  } catch (err) {
    console.error('getClashFiles error:', err);
    res.status(500).json({ ok: false, error: 'Failed' });
  }
}

// GET /api/clash/files/:id/download — the original file, unchanged
async function downloadClashFile(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT original_name, stored_file FROM clash_uploads WHERE id = $1`, [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: 'File not found' });
    const abs = path.resolve(CLASH_FILES_ROOT, rows[0].stored_file);
    if (!abs.startsWith(path.resolve(CLASH_FILES_ROOT) + path.sep))
      return res.status(400).json({ ok: false, error: 'Invalid file path' });
    res.download(abs, rows[0].original_name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ ok: false, error: 'File missing on server' });
    });
  } catch (err) {
    console.error('downloadClashFile error:', err);
    res.status(500).json({ ok: false, error: 'Failed' });
  }
}

module.exports = { uploadClashReport, getClashData, getClashSummary, getClashFiles, downloadClashFile };
