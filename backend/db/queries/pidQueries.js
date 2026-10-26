const { pool } = require("../pool");

// Self-migrating (same pattern as inch_data in inchController.js / iso_special_items
// in isoPreCheckQueries.js) rather than a standalone pid_schema.sql — nothing in this
// app runs *_schema.sql files automatically, which caused a real "relation does not
// exist" incident with iso_prechecks_schema.sql. This table heals itself on every
// server start instead.
// One multi-statement call on a single connection — three separate pool.query()
// calls would each grab their own connection from the pool and could race
// (index creation reaching the DB before the table exists), which is exactly
// what happened here during testing. Keeping it as one string guarantees order.
pool.query(`
  CREATE TABLE IF NOT EXISTS pid_master_index (
    id            SERIAL PRIMARY KEY,
    job_no        VARCHAR(50)  NOT NULL,
    unit_no       VARCHAR(50)  NOT NULL,
    zone          VARCHAR(20),
    pid_name      VARCHAR(200) NOT NULL,
    status        VARCHAR(20)  NOT NULL DEFAULT 'active',
    created_by    VARCHAR(20)  REFERENCES users(id),
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    retired_by    VARCHAR(20)  REFERENCES users(id),
    retired_at    TIMESTAMPTZ,
    retire_reason TEXT
  );
  -- Partial unique index (not a table-level UNIQUE) so a retired row never blocks
  -- re-adding the same P&ID name later — only one *active* row per (job, unit, name).
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pid_master_index_active_unique
    ON pid_master_index (job_no, unit_no, pid_name) WHERE status = 'active';
  CREATE INDEX IF NOT EXISTS idx_pid_master_index_job_unit ON pid_master_index(job_no, unit_no);

  -- 2026-10-22: what the Process P&ID index says about each P&ID (description, revision history)
  -- and which uploaded index issue last set it. rev_history = [{ "rev": "4", "date": "2025-08-27" }, …]
  -- in revision order; index_rev / index_rev_date = the latest of those.
  ALTER TABLE pid_master_index ADD COLUMN IF NOT EXISTS description    TEXT;
  ALTER TABLE pid_master_index ADD COLUMN IF NOT EXISTS index_rev      VARCHAR(10);
  ALTER TABLE pid_master_index ADD COLUMN IF NOT EXISTS index_rev_date DATE;
  ALTER TABLE pid_master_index ADD COLUMN IF NOT EXISTS rev_history    JSONB NOT NULL DEFAULT '[]';
  ALTER TABLE pid_master_index ADD COLUMN IF NOT EXISTS index_issue_id INTEGER;
  ALTER TABLE pid_master_index ADD COLUMN IF NOT EXISTS updated_by     VARCHAR(20);
  ALTER TABLE pid_master_index ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ;

  -- One row per uploaded index file (Process PDF or Excel). No FK to users: users is a live view of PC-2.
  CREATE TABLE IF NOT EXISTS pid_index_issues (
    id            SERIAL PRIMARY KEY,
    job_no        VARCHAR(50)  NOT NULL,
    unit_no       VARCHAR(50)  NOT NULL,
    source_type   VARCHAR(10)  NOT NULL,          -- 'pdf' | 'excel'
    file_name     TEXT,
    document_no   VARCHAR(100),                   -- from the PDF header, e.g. B862-79-41-208--DI-1001A
    document_rev  VARCHAR(20),
    unit_label    VARCHAR(100),                   -- e.g. "101 (1130 Section)"
    date_of_issue DATE,
    page_count    INTEGER,
    rows_in_file  INTEGER NOT NULL DEFAULT 0,
    added         INTEGER NOT NULL DEFAULT 0,
    updated       INTEGER NOT NULL DEFAULT 0,
    unchanged     INTEGER NOT NULL DEFAULT 0,
    skipped       INTEGER NOT NULL DEFAULT 0,
    uploaded_by   VARCHAR(20),
    uploaded_at   TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_pid_index_issues_job_unit ON pid_index_issues(job_no, unit_no);
  -- the uploaded file itself, kept byte-for-byte (relative to backend/uploads) — 2026-10-22
  ALTER TABLE pid_index_issues ADD COLUMN IF NOT EXISTS stored_path TEXT;
  ALTER TABLE pid_index_issues ADD COLUMN IF NOT EXISTS file_hash   VARCHAR(64);
  ALTER TABLE pid_index_issues ADD COLUMN IF NOT EXISTS file_size   INTEGER;
`).catch((err) => console.error("pid_master_index self-migrate error:", err));

// Job/Unit combinations this user is allowed to declare P&IDs for — HOD sees
// every job/unit in PIMS, everyone else only what they hold GL or ISO Manager
// on (matches the route-level requireAnyRole('GL','ISO Manager') guard).
async function getAssignedScope(userId, isHod) {
  if (isHod) {
    const { rows } = await pool.query(
      `SELECT p.id AS job_no, p.name AS job_name, pu.unit_no
       FROM project_units pu
       JOIN projects p ON p.id = pu.project_id
       ORDER BY p.name, pu.unit_no`
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT DISTINCT p.id AS job_no, p.name AS job_name, ura.unit_no
     FROM user_role_assignments ura
     JOIN projects p ON p.id = ura.project_id
     WHERE ura.user_id = $1 AND ura.role IN ('GL', 'ISO Manager')
     ORDER BY p.name, ura.unit_no`,
    [userId]
  );
  return rows;
}

async function isUserAssigned(userId, isHod, jobNo, unitNo) {
  if (isHod) return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM user_role_assignments
     WHERE user_id=$1 AND project_id=$2 AND unit_no=$3 AND role IN ('GL','ISO Manager')`,
    [userId, jobNo, unitNo]
  );
  return rows.length > 0;
}

async function jobUnitExists(jobNo, unitNo) {
  const { rows } = await pool.query(
    `SELECT 1 FROM project_units WHERE project_id=$1 AND unit_no=$2`,
    [jobNo, unitNo]
  );
  return rows.length > 0;
}

async function getMasterIndexRows({ jobNo, unitNo, status }) {
  const clauses = [];
  const params = [];
  if (jobNo)  { params.push(jobNo);  clauses.push(`m.job_no = $${params.length}`); }
  if (unitNo) { params.push(unitNo); clauses.push(`m.unit_no = $${params.length}`); }
  if (status) { params.push(status); clauses.push(`m.status = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT m.id, m.job_no, m.unit_no, m.zone, m.pid_name, m.status,
            m.description, m.index_rev, m.index_rev_date, m.rev_history,
            m.created_by, cu.name AS created_by_name, m.created_at,
            m.retired_by, ru.name AS retired_by_name, m.retired_at, m.retire_reason
     FROM pid_master_index m
     LEFT JOIN users cu ON cu.id = m.created_by
     LEFT JOIN users ru ON ru.id = m.retired_by
     ${where}
     ORDER BY m.job_no, m.unit_no, m.pid_name`,
    params
  );
  return rows;
}

async function insertMasterIndexRow({ jobNo, unitNo, zone, pidName, createdBy, description, revHistory, indexIssueId }, db = pool) {
  const hist = revHistory || [];
  const latest = hist[hist.length - 1] || null;
  const { rows } = await db.query(
    `INSERT INTO pid_master_index (job_no, unit_no, zone, pid_name, created_by,
                                   description, rev_history, index_rev, index_rev_date, index_issue_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, job_no, unit_no, zone, pid_name, status, created_at, description, index_rev, index_rev_date`,
    [jobNo, unitNo, zone || null, pidName, createdBy,
     description || null, JSON.stringify(hist), latest?.rev || null, latest?.date || null, indexIssueId || null]
  );
  return rows[0];
}

// Active rows of one Job/Unit, keyed by P&ID name — used to compare an uploaded index against
async function getActiveRowsByName(jobNo, unitNo, db = pool) {
  const { rows } = await db.query(
    `SELECT id, pid_name, zone, description, index_rev, index_rev_date, rev_history
     FROM pid_master_index WHERE job_no=$1 AND unit_no=$2 AND status='active'`,
    [jobNo, unitNo]
  );
  return new Map(rows.map((r) => [r.pid_name, r]));
}

async function updateMasterIndexFromIndex(id, { zone, description, revHistory, indexIssueId, updatedBy }, db = pool) {
  const latest = revHistory[revHistory.length - 1] || null;
  await db.query(
    `UPDATE pid_master_index
     SET zone = COALESCE($2, zone), description = COALESCE($3, description),
         rev_history = $4, index_rev = $5, index_rev_date = $6,
         index_issue_id = $7, updated_by = $8, updated_at = NOW()
     WHERE id = $1`,
    [id, zone || null, description || null, JSON.stringify(revHistory), latest?.rev || null, latest?.date || null, indexIssueId, updatedBy]
  );
}

async function insertIndexIssue(i, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO pid_index_issues (job_no, unit_no, source_type, file_name, document_no, document_rev, unit_label,
                                   date_of_issue, page_count, rows_in_file, added, updated, unchanged, skipped, uploaded_by,
                                   file_hash, file_size)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [i.jobNo, i.unitNo, i.sourceType, i.fileName, i.documentNo || null, i.documentRev || null, i.unitLabel || null,
     i.dateOfIssue || null, i.pageCount || null, i.rowsInFile, i.added, i.updated, i.unchanged, i.skipped, i.uploadedBy,
     i.fileHash || null, i.fileSize || null]
  );
  return rows[0].id;
}

// Uploaded index files of one Job/Unit, newest first
async function listIndexIssues(jobNo, unitNo) {
  const { rows } = await pool.query(
    `SELECT i.id, i.job_no, i.unit_no, i.source_type, i.file_name, i.document_no, i.document_rev, i.unit_label,
            i.date_of_issue, i.page_count, i.rows_in_file, i.added, i.updated, i.unchanged, i.skipped,
            i.uploaded_by, u.name AS uploaded_by_name, i.uploaded_at, i.file_size,
            (i.stored_path IS NOT NULL) AS has_file
     FROM pid_index_issues i LEFT JOIN users u ON u.id = i.uploaded_by
     WHERE i.job_no = $1 AND i.unit_no = $2
     ORDER BY i.uploaded_at DESC, i.id DESC`,
    [jobNo, unitNo]
  );
  return rows;
}

async function getIndexIssue(id) {
  const { rows } = await pool.query(`SELECT * FROM pid_index_issues WHERE id = $1`, [id]);
  return rows[0] || null;
}

// The same file (by content) already kept for this Job/Unit?
async function findIndexIssueByHash(jobNo, unitNo, hash, db = pool) {
  const { rows } = await db.query(
    `SELECT i.id, i.uploaded_at, i.uploaded_by, u.name AS uploaded_by_name
     FROM pid_index_issues i LEFT JOIN users u ON u.id = i.uploaded_by
     WHERE i.job_no = $1 AND i.unit_no = $2 AND i.file_hash = $3 AND i.stored_path IS NOT NULL
     ORDER BY i.id LIMIT 1`,
    [jobNo, unitNo, hash]
  );
  return rows[0] || null;
}

// An earlier upload of this same index whose file wasn't kept (uploaded before files were stored)
async function findIndexIssueWithoutFile(jobNo, unitNo, fileName, documentNo, documentRev, db = pool) {
  const { rows } = await db.query(
    `SELECT i.id, i.uploaded_at, i.uploaded_by, u.name AS uploaded_by_name
     FROM pid_index_issues i LEFT JOIN users u ON u.id = i.uploaded_by
     WHERE i.job_no = $1 AND i.unit_no = $2 AND i.stored_path IS NULL AND i.file_name = $3
       AND i.document_no IS NOT DISTINCT FROM $4 AND i.document_rev IS NOT DISTINCT FROM $5
     ORDER BY i.id DESC LIMIT 1`,
    [jobNo, unitNo, fileName, documentNo || null, documentRev || null]
  );
  return rows[0] || null;
}

async function setIndexIssueFile(id, { storedPath, fileHash, fileSize }, db = pool) {
  await db.query(`UPDATE pid_index_issues SET stored_path = $2, file_hash = $3, file_size = $4 WHERE id = $1`,
    [id, storedPath, fileHash, fileSize]);
}

// Same as getMasterIndexRows, but with each row's current-revision document
// (if any) joined in one query — avoids an N+1 fetch when the upload page's
// table needs to show "Not Uploaded" vs "Rev X" at a glance for every row.
async function getMasterIndexWithCurrentDoc({ jobNo, unitNo, status }) {
  const clauses = [];
  const params = [];
  if (jobNo)  { params.push(jobNo);  clauses.push(`m.job_no = $${params.length}`); }
  if (unitNo) { params.push(unitNo); clauses.push(`m.unit_no = $${params.length}`); }
  if (status) { params.push(status); clauses.push(`m.status = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT m.id, m.job_no, m.unit_no, m.zone, m.pid_name, m.status,
            m.description, m.index_rev, m.index_rev_date, m.rev_history,
            m.created_by, cu.name AS created_by_name, m.created_at,
            d.id AS current_doc_id, d.rev_label AS current_rev_label,
            d.uploaded_at AS current_uploaded_at, d.file_name AS current_file_name,
            d.file_path AS current_file_path,
            pr.pending_count
     FROM pid_master_index m
     LEFT JOIN users cu ON cu.id = m.created_by
     LEFT JOIN pid_documents d ON d.master_index_id = m.id AND d.status = 'current'
     LEFT JOIN (
       SELECT master_index_id, COUNT(*) AS pending_count
       FROM pid_documents WHERE status = 'pending_review'
       GROUP BY master_index_id
     ) pr ON pr.master_index_id = m.id
     ${where}
     ORDER BY m.job_no, m.unit_no, m.pid_name`,
    params
  );
  return rows;
}

// Looked up during P&ID document upload — the filename declares (job, unit,
// pidName), and this confirms it's a real, still-active master index entry
// before any file gets stored against it.
async function findActiveMasterIndexRow(jobNo, unitNo, pidName) {
  const { rows } = await pool.query(
    `SELECT id, job_no, unit_no, pid_name, index_rev, index_rev_date FROM pid_master_index
     WHERE job_no=$1 AND unit_no=$2 AND pid_name=$3 AND status='active'`,
    [jobNo, unitNo, pidName]
  );
  return rows[0] || null;
}

async function retireMasterIndexRow(id, userId, reason) {
  const { rows } = await pool.query(
    `UPDATE pid_master_index
     SET status='retired', retired_by=$2, retired_at=NOW(), retire_reason=$3
     WHERE id=$1 AND status='active'
     RETURNING id`,
    [id, userId, reason || null]
  );
  return rows.length > 0;
}

module.exports = {
  getAssignedScope,
  isUserAssigned,
  jobUnitExists,
  getMasterIndexRows,
  getMasterIndexWithCurrentDoc,
  insertMasterIndexRow,
  getActiveRowsByName,
  updateMasterIndexFromIndex,
  insertIndexIssue,
  listIndexIssues,
  getIndexIssue,
  findIndexIssueByHash,
  findIndexIssueWithoutFile,
  setIndexIssueFile,
  findActiveMasterIndexRow,
  retireMasterIndexRow,
};
