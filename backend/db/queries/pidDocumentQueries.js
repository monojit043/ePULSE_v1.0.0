const { pool } = require("../pool");

// Self-migrating, same convention as pid_master_index (see pidQueries.js) and
// iso_special_items — standalone *_schema.sql files go stale silently in this
// app since nothing auto-runs them.
//
// One row per revision (not a separate "current" + "history" table split) —
// every revision carries its own status/audit metadata, not just a filename.
// The partial unique index enforces the real invariant directly in the DB:
// at most one 'current' row per P&ID, no application-level race possible.
//
// parsed_pid_name / parsed_rev_label / parse_confidence: what Step 4's
// title-block extraction actually found inside the PDF content, independent
// of what the filename declared — stored even when it matched (for
// transparency), and always stored when it didn't (status='pending_review'
// rows use these to show the declared-vs-parsed comparison for a human to
// resolve). parse_confidence is 'matched' | 'mismatch' | 'unrecognized'.
pool.query(`
  CREATE TABLE IF NOT EXISTS pid_documents (
    id               SERIAL PRIMARY KEY,
    master_index_id  INTEGER NOT NULL REFERENCES pid_master_index(id) ON DELETE CASCADE,
    rev_label        VARCHAR(10) NOT NULL,
    rev_sort_key     INTEGER NOT NULL,
    file_name        VARCHAR(500) NOT NULL,
    file_path        VARCHAR(1000) NOT NULL,
    file_hash        VARCHAR(64) NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'current',
    superseded_by    INTEGER REFERENCES pid_documents(id),
    uploaded_by      VARCHAR(20) REFERENCES users(id),
    uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_by      VARCHAR(20) REFERENCES users(id),
    resolved_at      TIMESTAMPTZ,
    override_reason  TEXT,
    parsed_pid_name  VARCHAR(200),
    parsed_rev_label VARCHAR(10),
    parse_confidence VARCHAR(20)
  );
  CREATE INDEX IF NOT EXISTS idx_pid_documents_master ON pid_documents(master_index_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pid_documents_current_unique
    ON pid_documents(master_index_id) WHERE status = 'current';
`).catch((err) => console.error("pid_documents self-migrate error:", err));

// Columns added after the table's first release — ALTER ... ADD COLUMN IF NOT
// EXISTS is safe to re-run and heals any DB that already had the table from
// before these fields existed, same self-migrating philosophy as the table.
pool.query(`
  ALTER TABLE pid_documents ADD COLUMN IF NOT EXISTS parsed_pid_name  VARCHAR(200);
  ALTER TABLE pid_documents ADD COLUMN IF NOT EXISTS parsed_rev_label VARCHAR(10);
  ALTER TABLE pid_documents ADD COLUMN IF NOT EXISTS parse_confidence VARCHAR(20);
`).catch((err) => console.error("pid_documents column backfill error:", err));

async function getCurrentDocument(masterIndexId) {
  const { rows } = await pool.query(
    `SELECT * FROM pid_documents WHERE master_index_id=$1 AND status='current'`,
    [masterIndexId]
  );
  return rows[0] || null;
}

async function getDocumentById(id) {
  const { rows } = await pool.query(`SELECT * FROM pid_documents WHERE id=$1`, [id]);
  return rows[0] || null;
}

async function getDocumentsForMasterIndex(masterIndexId) {
  const { rows } = await pool.query(
    `SELECT d.*, u.name AS uploaded_by_name, r.name AS resolved_by_name
     FROM pid_documents d
     LEFT JOIN users u ON u.id = d.uploaded_by
     LEFT JOIN users r ON r.id = d.resolved_by
     WHERE d.master_index_id=$1
     ORDER BY d.rev_sort_key DESC, d.uploaded_at DESC`,
    [masterIndexId]
  );
  return rows;
}

// First upload for a P&ID — no existing current row to touch.
async function insertAsCurrent({ masterIndexId, revLabel, revSortKey, fileName, filePath, fileHash, uploadedBy, parsedPidName, parsedRevLabel, parseConfidence }) {
  const { rows } = await pool.query(
    `INSERT INTO pid_documents (master_index_id, rev_label, rev_sort_key, file_name, file_path, file_hash, status, uploaded_by, parsed_pid_name, parsed_rev_label, parse_confidence)
     VALUES ($1,$2,$3,$4,$5,$6,'current',$7,$8,$9,$10)
     RETURNING *`,
    [masterIndexId, revLabel, revSortKey, fileName, filePath, fileHash, uploadedBy, parsedPidName || null, parsedRevLabel || null, parseConfidence || null]
  );
  return rows[0];
}

// Newer revision (or an explicitly-overridden older one) replaces the current
// row — old flips to 'superseded' and links forward, new becomes 'current'.
// Done inside one transaction so the "exactly one current row" invariant is
// never even briefly violated from another connection's point of view.
async function supersedeCurrent({ masterIndexId, oldDocId, revLabel, revSortKey, fileName, filePath, fileHash, uploadedBy, overrideReason, parsedPidName, parsedRevLabel, parseConfidence }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE pid_documents SET status='superseded' WHERE id=$1`, [oldDocId]);
    const { rows } = await client.query(
      `INSERT INTO pid_documents (master_index_id, rev_label, rev_sort_key, file_name, file_path, file_hash, status, uploaded_by, override_reason, parsed_pid_name, parsed_rev_label, parse_confidence)
       VALUES ($1,$2,$3,$4,$5,$6,'current',$7,$8,$9,$10,$11)
       RETURNING *`,
      [masterIndexId, revLabel, revSortKey, fileName, filePath, fileHash, uploadedBy, overrideReason || null, parsedPidName || null, parsedRevLabel || null, parseConfidence || null]
    );
    const newDoc = rows[0];
    await client.query(`UPDATE pid_documents SET superseded_by=$1 WHERE id=$2`, [newDoc.id, oldDocId]);
    await client.query("COMMIT");
    return newDoc;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Same revision label as current, but different file content — parked for a
// human to resolve, current row is left untouched.
async function insertAsConflict({ masterIndexId, revLabel, revSortKey, fileName, filePath, fileHash, uploadedBy, parsedPidName, parsedRevLabel, parseConfidence }) {
  const { rows } = await pool.query(
    `INSERT INTO pid_documents (master_index_id, rev_label, rev_sort_key, file_name, file_path, file_hash, status, uploaded_by, parsed_pid_name, parsed_rev_label, parse_confidence)
     VALUES ($1,$2,$3,$4,$5,$6,'conflict',$7,$8,$9,$10)
     RETURNING *`,
    [masterIndexId, revLabel, revSortKey, fileName, filePath, fileHash, uploadedBy, parsedPidName || null, parsedRevLabel || null, parseConfidence || null]
  );
  return rows[0];
}

// Step 5: the PDF's own content didn't match what the filename declared (or
// nothing could be extracted at all) — parked, untouched from every other
// document's point of view, waiting for a human to accept or reject via
// resolvePendingReview below.
async function insertAsPendingReview({ masterIndexId, revLabel, revSortKey, fileName, filePath, fileHash, uploadedBy, parsedPidName, parsedRevLabel, parseConfidence }) {
  const { rows } = await pool.query(
    `INSERT INTO pid_documents (master_index_id, rev_label, rev_sort_key, file_name, file_path, file_hash, status, uploaded_by, parsed_pid_name, parsed_rev_label, parse_confidence)
     VALUES ($1,$2,$3,$4,$5,$6,'pending_review',$7,$8,$9,$10)
     RETURNING *`,
    [masterIndexId, revLabel, revSortKey, fileName, filePath, fileHash, uploadedBy, parsedPidName || null, parsedRevLabel || null, parseConfidence || null]
  );
  return rows[0];
}

// Resolve accept — promotes an existing pending_review row in place (no new
// row created) to whatever the normal lifecycle would have produced, given
// whatever is current *right now* (re-checked fresh, not assumed from
// upload time, in case something else became current while this was
// pending). oldCurrentDocId is null when there's nothing to supersede.
async function promotePendingToCurrent(pendingDocId, oldCurrentDocId, resolvedBy, overrideReason) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (oldCurrentDocId) {
      await client.query(`UPDATE pid_documents SET status='superseded' WHERE id=$1`, [oldCurrentDocId]);
    }
    const { rows } = await client.query(
      `UPDATE pid_documents
       SET status='current', resolved_by=$2, resolved_at=NOW(),
           override_reason=COALESCE($3, override_reason)
       WHERE id=$1 RETURNING *`,
      [pendingDocId, resolvedBy, overrideReason || null]
    );
    if (oldCurrentDocId) {
      await client.query(`UPDATE pid_documents SET superseded_by=$1 WHERE id=$2`, [pendingDocId, oldCurrentDocId]);
    }
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Resolve accept landed on a genuine conflict (something else took the
// 'current' slot with different content while this was pending) — same
// parked-for-later-resolution state as an upload-time conflict.
async function markPendingAsConflict(pendingDocId, resolvedBy) {
  const { rows } = await pool.query(
    `UPDATE pid_documents SET status='conflict', resolved_by=$2, resolved_at=NOW() WHERE id=$1 RETURNING *`,
    [pendingDocId, resolvedBy]
  );
  return rows[0];
}

// Resolve reject — the upload was genuinely wrong (mislabeled or misfiled).
// The file and row stay (never delete, matching the rest of this system),
// just excluded from ever being 'current'.
async function rejectDocument(docId, resolvedBy, reason) {
  const { rows } = await pool.query(
    `UPDATE pid_documents SET status='rejected', resolved_by=$2, resolved_at=NOW(), override_reason=$3
     WHERE id=$1 AND status='pending_review' RETURNING *`,
    [docId, resolvedBy, reason || null]
  );
  return rows[0] || null;
}

module.exports = {
  getCurrentDocument,
  getDocumentById,
  getDocumentsForMasterIndex,
  insertAsCurrent,
  supersedeCurrent,
  insertAsConflict,
  insertAsPendingReview,
  promotePendingToCurrent,
  markPendingAsConflict,
  rejectDocument,
};
