const { pool } = require("../pool");

// Self-migrating, same convention as the other P&ID tables — see pidQueries.js
// for why (a standalone *_schema.sql file goes stale, nothing auto-runs it).
//
// Lines read off EVERY revision of a P&ID are kept, one set per document
// (decided with the user 2026-10-25, for backtracking: an MTO's basis names
// the P&ID revision it came from). When a new revision becomes current, the
// older revision's lines stay, tied to its (now superseded) document.
// Readers that want "what's approved now" join pid_documents status='current'.
pool.query(`
  CREATE TABLE IF NOT EXISTS pid_extracted_lines (
    id               SERIAL PRIMARY KEY,
    master_index_id  INTEGER NOT NULL REFERENCES pid_master_index(id) ON DELETE CASCADE,
    document_id      INTEGER NOT NULL REFERENCES pid_documents(id) ON DELETE CASCADE,
    full_line_no     VARCHAR(200) NOT NULL,
    size_in          VARCHAR(20),
    service          VARCHAR(20),
    unit_no          VARCHAR(50),
    seq_no           VARCHAR(20),
    piping_spec      VARCHAR(20),
    insul_type       VARCHAR(20),
    page_no          INTEGER,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_pid_extracted_lines_master ON pid_extracted_lines(master_index_id);
  CREATE INDEX IF NOT EXISTS idx_pid_extracted_lines_document ON pid_extracted_lines(document_id);
  -- 05341-01 → seq_no 05341, sub_line 01 (see services/pidLineExtractor.js)
  ALTER TABLE pid_extracted_lines ADD COLUMN IF NOT EXISTS sub_line VARCHAR(10);
`).catch((err) => console.error("pid_extracted_lines self-migrate error:", err));

// Store the lines read off ONE document (revision). Re-reading the same
// document replaces only its own set; other revisions' lines are kept. One
// transaction, so a reader never sees a half-updated set.
async function replaceExtractedLines(masterIndexId, documentId, lines) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM pid_extracted_lines WHERE document_id=$1`, [documentId]);
    for (const l of lines) {
      await client.query(
        `INSERT INTO pid_extracted_lines
           (master_index_id, document_id, full_line_no, size_in, service, unit_no, seq_no, sub_line, piping_spec, insul_type, page_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [masterIndexId, documentId, l.fullLineNo, l.size, l.service, l.unitNo, l.seqNo, l.subLine || null, l.spec, l.insulType, l.pageNo]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// GL/ISO Manager assignment is intentionally NOT checked here — line lists
// are read-only reference data pulled from already-approved current P&IDs,
// same "any logged-in user, any job" visibility already established for
// pid-view.html. Only active (non-retired) master index entries are
// considered, matching every other read path in this feature.
async function getLinesForJobUnit(jobNo, unitNo) {
  const { rows } = await pool.query(
    `SELECT el.*, m.pid_name, m.zone
     FROM pid_extracted_lines el
     JOIN pid_master_index m ON m.id = el.master_index_id
     JOIN pid_documents d ON d.id = el.document_id AND d.status = 'current'
     WHERE m.job_no = $1 AND m.unit_no = $2 AND m.status = 'active'
     ORDER BY el.full_line_no`,
    [jobNo, unitNo]
  );
  return rows;
}

module.exports = { replaceExtractedLines, getLinesForJobUnit };
