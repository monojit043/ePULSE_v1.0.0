const { pool } = require("../pool");

// Self-migrating, same convention as the P&ID tables — see pidLineQueries.js.
//
// A staging record: "this line has been identified (from P&ID and/or the
// Line List Normalizer) and assigned a zone" — it does NOT mean an ISO
// drawing exists yet. The Modeller later uploads a drawing against
// (job_no, unit_no, zone, line_no), which is a separate row in the existing
// `drawings` table. Kept deliberately simple/staging-only rather than
// inserted straight into `drawings`, since `drawings` carries a lot of
// upload/claim/status columns that don't apply before a drawing exists.
pool.query(`
  CREATE TABLE IF NOT EXISTS piping_line_list (
    id           SERIAL PRIMARY KEY,
    job_no       VARCHAR(50)  NOT NULL,
    unit_no      VARCHAR(50)  NOT NULL,
    zone         VARCHAR(20)  NOT NULL,
    line_no      VARCHAR(200) NOT NULL,
    seq_no       VARCHAR(50),
    size_in      VARCHAR(20),
    service      VARCHAR(20),
    piping_spec  VARCHAR(20),
    source       VARCHAR(20),
    created_by   VARCHAR(20),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (job_no, unit_no, zone, line_no)
  );
  CREATE INDEX IF NOT EXISTS idx_piping_line_list_job_unit ON piping_line_list(job_no, unit_no);
`).catch((err) => console.error("piping_line_list self-migrate error:", err));

// Bulk-inserts zoned lines for a Job/Unit. ON CONFLICT DO NOTHING — a line
// already staged here (same job/unit/zone/line_no) is left untouched rather
// than overwritten, so a re-run after re-loading the same Job/Unit doesn't
// clobber anything. RETURNING id means only the rows that were genuinely new
// come back, so the caller can report created vs already-existed counts from
// one round trip instead of a separate existence check first.
async function insertLines(jobNo, unitNo, rows, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const insertedIds = [];
    for (const r of rows) {
      const { rows: ret } = await client.query(
        `INSERT INTO piping_line_list
           (job_no, unit_no, zone, line_no, seq_no, size_in, service, piping_spec, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (job_no, unit_no, zone, line_no) DO NOTHING
         RETURNING id`,
        [jobNo, unitNo, r.zone, r.lineNo, r.seqNo, r.size, r.service, r.spec, r.source, userId]
      );
      if (ret.length) insertedIds.push(ret[0].id);
    }
    await client.query("COMMIT");
    return insertedIds;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getLinesForJobUnit(jobNo, unitNo) {
  const { rows } = await pool.query(
    `SELECT * FROM piping_line_list WHERE job_no=$1 AND unit_no=$2 ORDER BY zone, line_no`,
    [jobNo, unitNo]
  );
  return rows;
}

module.exports = { insertLines, getLinesForJobUnit };
