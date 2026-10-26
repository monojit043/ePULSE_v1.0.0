const { pool } = require("../pool");

// Self-migrating, same convention as pid_master_index / pid_documents — a
// standalone *_schema.sql file would go stale the same way iso_prechecks_schema.sql
// did, since nothing in this app runs those automatically.
//
// Logs every meaningful state-changing P&ID action (declare/retire/upload
// outcomes) — not failed/rejected attempts, which never changed any state.
pool.query(`
  CREATE TABLE IF NOT EXISTS pid_audit_log (
    id               SERIAL PRIMARY KEY,
    action           VARCHAR(50) NOT NULL,
    master_index_id  INTEGER REFERENCES pid_master_index(id) ON DELETE CASCADE,
    document_id      INTEGER REFERENCES pid_documents(id) ON DELETE CASCADE,
    performed_by     VARCHAR(20) REFERENCES users(id),
    performed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason           TEXT,
    details          JSONB
  );
  CREATE INDEX IF NOT EXISTS idx_pid_audit_log_master ON pid_audit_log(master_index_id);
`).catch((err) => console.error("pid_audit_log self-migrate error:", err));

async function logAction({ action, masterIndexId, documentId, performedBy, reason, details }) {
  try {
    await pool.query(
      `INSERT INTO pid_audit_log (action, master_index_id, document_id, performed_by, reason, details)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [action, masterIndexId || null, documentId || null, performedBy || null, reason || null, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    // Never let an audit-log write failure break the real action it's
    // logging — log the failure itself and move on.
    console.error("pid_audit_log write error:", err);
  }
}

async function getAuditLog(masterIndexId) {
  const { rows } = await pool.query(
    `SELECT a.id, a.action, a.master_index_id, a.document_id, a.performed_by,
            u.name AS performed_by_name, a.performed_at, a.reason, a.details
     FROM pid_audit_log a
     LEFT JOIN users u ON u.id = a.performed_by
     WHERE a.master_index_id = $1
     ORDER BY a.performed_at DESC`,
    [masterIndexId]
  );
  return rows;
}

module.exports = { logAction, getAuditLog };
