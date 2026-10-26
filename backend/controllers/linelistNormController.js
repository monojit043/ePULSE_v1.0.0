const { pool } = require('../db/pool');

// Column mapping: OUTCOLS key → DB column name
const COL_MAP = {
  'PID_NO':                   'pid_no',
  'SERVICE':                  'service',
  'UNIT_NO':                  'unit_no',
  'LINE_NO':                  'line_no',
  'LINE_SIZE':                'line_size',
  'LINE_SIZE_UNIT':           'line_size_unit',
  'LINE_CLASS':               'line_class',
  'LINE_FROM':                'line_from',
  'LINE_TO':                  'line_to',
  'MIN_DESIGN_PRESS':         'min_design_press',
  'MIN_DESIGN_PRESS_UNIT':    'min_design_press_unit',
  'MIN_DESIGN_TEMP':          'min_design_temp',
  'MIN_DESIGN_TEMP_UNIT':     'min_design_temp_unit',
  'MIN_OPERATING_PRESS':      'min_operating_press',
  'MIN_OPERATING_PRESS_UNIT': 'min_operating_press_unit',
  'MIN_OPERATING_TEMP':       'min_operating_temp',
  'MIN_OPERATING_TEMP_UNIT':  'min_operating_temp_unit',
  'OPERATING_TEMP':           'operating_temp',
  'OPERATING_TEMP_UNIT':      'operating_temp_unit',
  'OPERATING_PRESS':          'operating_press',
  'OPERATING_PRESS_UNIT':     'operating_press_unit',
  'DESIGN_TEMP':              'design_temp',
  'DESIGN_TEMP_UNIT':         'design_temp_unit',
  'DESIGN_PRESS':             'design_press',
  'DESIGN_PRESS_UNIT':        'design_press_unit',
  'INSULATION':               'insulation',
  'FULL_VACCUM':              'full_vaccum',
  'FLUID_STATE':              'fluid_state',
  'MULTI PHASE (FLOW REGIME)':'multi_phase',
  'INSULATION THICKNESS':     'insulation_thickness',
};

const OUT_KEYS = Object.keys(COL_MAP);

// The current line list of every job lives in `line_list` — same table as PC-2's
// cmp_pims_1014.line_list plus the normalizer extras (db/createLineList.js).
// linelist_uploads is the upload log (revision numbers, who / when). The per-upload copy of
// every line (linelist_lines) was dropped on 2026-10-22 — nothing read it.
// Normalizer key → line_list column (where the name differs from the old table)
const LINE_LIST_RENAME = {
  OPERATING_PRESS: 'oper_press', OPERATING_PRESS_UNIT: 'oper_press_unit',
  OPERATING_TEMP: 'oper_temp',   OPERATING_TEMP_UNIT: 'oper_temp_unit',
};
const LL_KEYS = OUT_KEYS;
const LL_COLS = LL_KEYS.map((k) => LINE_LIST_RENAME[k] || COL_MAP[k]);

// ── Line list history (2026-10-25, for backtracking) ──────────────────────────
// line_list holds only each job's CURRENT line list (replaced on every upload).
// line_list_history keeps a full copy of every upload, tagged with its
// linelist_uploads row (rev no., who, when), so any older revision of a line
// can be looked up — e.g. the line-list revision an IPMCS MTO was based on.
// A job whose line list predates this (no upload record) gets a baseline
// "Rev 0" record holding the line list as it was when history started.
const BASELINE_NOTE = 'Baseline: line_list as it was when history started (copied from PC-2, no upload record)';

async function lineListColumns(client) {
  const { rows } = await client.query(
    `SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) AS cols
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'line_list'`
  );
  return rows[0].cols;
}

// Copy a job's current line_list rows into the history under an upload
async function archiveUpload(client, jobNo, uploadId) {
  const cols = await lineListColumns(client);
  await client.query(
    `INSERT INTO line_list_history (${cols}, upload_id) SELECT ${cols}, $1 FROM line_list WHERE project_id = $2`,
    [uploadId, jobNo]
  );
}

async function ensureLineListHistory() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS line_list_history (LIKE line_list);
    ALTER TABLE line_list_history ADD COLUMN IF NOT EXISTS upload_id INTEGER REFERENCES linelist_uploads(id);
    ALTER TABLE line_list_history ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NOT NULL DEFAULT now();
    CREATE INDEX IF NOT EXISTS idx_line_list_history_upload ON line_list_history (upload_id);
    CREATE INDEX IF NOT EXISTS idx_line_list_history_line ON line_list_history (project_id, service, line_no);
  `);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('line_list_history_baseline'))`);
    const { rows: jobs } = await client.query(
      `SELECT project_id, count(*)::int AS n, max(saved_on) AS saved_on FROM line_list l
       WHERE NOT EXISTS (SELECT 1 FROM linelist_uploads u WHERE u.job_no = l.project_id)
       GROUP BY project_id`
    );
    for (const j of jobs) {
      const { rows: [up] } = await client.query(
        `INSERT INTO linelist_uploads (job_no, source_files, rev_no, uploaded_by, row_count, is_latest, uploaded_at)
         VALUES ($1, $2, 0, NULL, $3, TRUE, coalesce($4::timestamptz, now())) RETURNING id`,
        [j.project_id, JSON.stringify([BASELINE_NOTE]), j.n, j.saved_on || null]
      );
      await archiveUpload(client, j.project_id, up.id);
      console.log(`line list history: baseline Rev 0 recorded for ${j.project_id} (${j.n} lines)`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
ensureLineListHistory().catch((err) => console.error('line_list_history self-migrate error:', err));

// First number in a unit label: "101 (PDH Unit)" / "101(PDH Unit)" → "101"
const unitCode = (u) => (String(u || '').match(/^\s*(\d+)/) || [])[1] || String(u || '').trim();

// Replace a job's rows in line_list with this upload (one transaction, caller's client)
async function replaceJobLineList(client, jobNo, rows, savedBy) {
  // Same unique key as PC-2 (project_id, unit_no, line_no, service) — a repeated line keeps the last row
  const byKey = new Map();
  for (const row of rows) {
    const k = [row.UNIT_NO, row.LINE_NO, row.SERVICE].map((v) => String(v ?? '')).join('\u0001');
    byKey.set(k, row);
  }
  const unique = [...byKey.values()];

  // parent_unit = the unit's PIMS parent (as on PC-2), else the unit itself
  const { rows: units } = await client.query(
    `SELECT unit_no, nullif(trim(parent_unit), '') AS parent_unit FROM project_units WHERE project_id = $1`, [jobNo]
  );
  const parentOf = new Map(units.map((u) => [u.unit_no, u.parent_unit || u.unit_no]));

  await client.query('DELETE FROM line_list WHERE project_id = $1', [jobNo]);
  const cols = ['project_id', 'parent_unit', ...LL_COLS, 'has_mismatch', 'saved_by', 'saved_on'];
  const savedOn = new Date().toISOString();
  const BATCH = 500;
  for (let i = 0; i < unique.length; i += BATCH) {
    const params = [];
    const values = unique.slice(i, i + BATCH).map((row) => {
      const code = unitCode(row.UNIT_NO);
      const vals = [jobNo, parentOf.get(code) || code || null,
                    ...LL_KEYS.map((k) => String(row[k] ?? '')), 0, savedBy || null, savedOn];
      const start = params.length;
      params.push(...vals);
      return `(${vals.map((_, j) => `$${start + j + 1}`).join(', ')})`;
    });
    await client.query(`INSERT INTO line_list (${cols.join(', ')}) VALUES ${values.join(', ')}`, params);
  }
  return { saved: unique.length, duplicatesMerged: rows.length - unique.length };
}

// ── POST /api/linelist/save ───────────────────────────────────────────────────
// Body: { jobNo, revNo, sourceFiles: string[], rows: object[] }
async function saveLinelist(req, res) {
  const { jobNo, revNo, sourceFiles, rows } = req.body || {};
  const userId = req.session?.user?.id;

  if (!jobNo)  return res.status(400).json({ ok: false, message: 'jobNo is required.' });
  if (!rows?.length) return res.status(400).json({ ok: false, message: 'No rows to save.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mark all previous uploads for this job as not latest
    await client.query(
      `UPDATE linelist_uploads SET is_latest = FALSE WHERE job_no = $1`,
      [jobNo]
    );

    // Insert the upload record
    const { rows: upRows } = await client.query(
      `INSERT INTO linelist_uploads (job_no, source_files, rev_no, uploaded_by, row_count, is_latest)
       VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id`,
      [jobNo, JSON.stringify(sourceFiles || []), revNo ?? 0, userId, rows.length]
    );
    const uploadId = upRows[0].id;

    // The job's current line list (what ePULSE pages and SSMS read)
    const ll = await replaceJobLineList(client, jobNo, rows, userId);
    // Keep this revision in the history (older revisions stay there)
    await archiveUpload(client, jobNo, uploadId);

    await client.query('COMMIT');
    res.json({ ok: true, uploadId, rowCount: rows.length, lineListRows: ll.saved, duplicatesMerged: ll.duplicatesMerged });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('saveLinelist error:', err);
    res.status(500).json({ ok: false, message: 'Failed to save line list.' });
  } finally {
    client.release();
  }
}

// ── GET /api/linelist/jobs ────────────────────────────────────────────────────
// Returns one row per job (latest upload only) for the dashboard section
async function getJobsSummary(req, res) {
  try {
    // One row per job in line_list; upload details from the latest upload, if it came through here
    // (rows copied from PC-2 on 2026-10-19 have no upload record — saved_by / saved_on are used)
    const { rows } = await pool.query(`
      SELECT
        lu.id                                   AS upload_id,
        ll.project_id                           AS job_no,
        lu.rev_no,
        ll.row_count,
        COALESCE(lu.uploaded_at, ll.saved_on::timestamptz) AS uploaded_at,
        lu.source_files,
        COALESCE(u.name, ll.saved_by)           AS uploaded_by_name,
        ll.units
      FROM (
        SELECT project_id, count(*)::int AS row_count, max(saved_on) AS saved_on, max(saved_by) AS saved_by,
               ARRAY_AGG(DISTINCT unit_no) FILTER (WHERE unit_no <> '') AS units
        FROM line_list GROUP BY project_id
      ) ll
      LEFT JOIN linelist_uploads lu ON lu.job_no = ll.project_id AND lu.is_latest = TRUE
      LEFT JOIN users u ON u.id = COALESCE(lu.uploaded_by, ll.saved_by)
      ORDER BY uploaded_at DESC NULLS LAST
      LIMIT 50
    `);
    res.json({ ok: true, jobs: rows });
  } catch (err) {
    console.error('getJobsSummary error:', err);
    res.status(500).json({ ok: false, message: 'Failed to load stored line lists.' });
  }
}

// ── GET /api/linelist/check-rev/:jobNo ───────────────────────────────────────
// Returns whether a job has existing data and what the next rev should be
async function checkRev(req, res) {
  const { jobNo } = req.params;
  try {
    const { rows } = await pool.query(`
      SELECT MAX(rev_no) AS max_rev FROM linelist_uploads WHERE job_no = $1
    `, [jobNo]);
    const maxRev = rows[0].max_rev;
    if (maxRev === null) {
      res.json({ ok: true, exists: false, nextRev: 0 });
    } else {
      res.json({ ok: true, exists: true, nextRev: maxRev + 1, currentRev: maxRev });
    }
  } catch (err) {
    console.error('checkRev error:', err);
    res.status(500).json({ ok: false, message: 'Failed to check revision.' });
  }
}

// ── GET /api/linelist/line-data?jobNo=&lineNo= ────────────────────────────────
// Returns engineering data for a single line from the normalized line list.
// Matches: service-unit_no_numeric-line_no  vs  drawing lineNo (e.g. P-101-12453-B)
async function getLineData(req, res) {
  const { jobNo, lineNo } = req.query;
  if (!jobNo || !lineNo) return res.status(400).json({ ok: false, message: 'jobNo and lineNo required.' });

  try {
    const { rows } = await pool.query(
      `SELECT ll.service, ll.unit_no, ll.line_no,
              ll.design_temp,        ll.design_temp_unit,
              ll.oper_temp AS operating_temp, ll.oper_temp_unit AS operating_temp_unit,
              ll.min_design_temp,    ll.min_design_temp_unit,
              ll.design_press,       ll.design_press_unit,
              ll.oper_press AS operating_press, ll.oper_press_unit AS operating_press_unit,
              ll.insulation,         ll.insulation_thickness,
              ll.fluid_state,        ll.line_class,
              ll.service             AS svc
       FROM line_list ll
       WHERE ll.project_id = $1
         AND (
           $2 = ll.service || '-' || REGEXP_REPLACE(ll.unit_no, '\\s.*$', '') || '-' || ll.line_no
           OR $2 ILIKE ll.service || '-' || REGEXP_REPLACE(ll.unit_no, '\\s.*$', '') || '-' || ll.line_no || '-%'
         )
       LIMIT 1`,
      [jobNo, lineNo]
    );
    res.json({ ok: true, data: rows[0] || null });
  } catch (err) {
    console.error('getLineData error:', err);
    res.status(500).json({ ok: false, message: 'Failed to fetch line data.' });
  }
}

// ── GET /api/linelist/line-history?jobNo=&service=&lineNo= ───────────────────
// Every line-list revision of one line, newest first (from line_list_history)
async function getLineHistory(req, res) {
  const { jobNo, service, lineNo } = req.query;
  if (!jobNo || !service || !lineNo) return res.status(400).json({ ok: false, message: 'jobNo, service and lineNo required.' });
  try {
    const { rows } = await pool.query(
      `SELECT u.id AS upload_id, u.rev_no, u.uploaded_at, u.uploaded_by, u.source_files,
              h.unit_no, h.pid_no, h.line_size, h.line_class, h.insulation, h.insulation_thickness,
              h.oper_press, h.oper_press_unit, h.oper_temp, h.oper_temp_unit,
              h.design_press, h.design_press_unit, h.design_temp, h.design_temp_unit,
              h.min_operating_temp, h.min_operating_temp_unit, h.min_design_temp, h.min_design_temp_unit
       FROM line_list_history h JOIN linelist_uploads u ON u.id = h.upload_id
       WHERE h.project_id = $1 AND h.service = $2 AND h.line_no = $3
       ORDER BY u.rev_no DESC, u.id DESC`,
      [jobNo, service, lineNo]
    );
    res.json({ ok: true, revisions: rows });
  } catch (err) {
    console.error('getLineHistory error:', err);
    res.status(500).json({ ok: false, message: 'Failed to fetch line history.' });
  }
}

module.exports = { saveLinelist, getJobsSummary, checkRev, getLineData, getLineHistory };
