// Notification bell shared by the gateway and GAD (live_notifications + server-sent events).
// The ISO-workflow endpoints that used to live here moved with PIMS to D:\PIMS_APP (2026-10-21).
const { pool } = require("../db/pool");
const sse = require("../utils/sse");

// Ensure table exists on startup (GAD adds its own gad_id column — see gadController)
pool.query(`
  CREATE TABLE IF NOT EXISTS live_notifications (
    id          SERIAL PRIMARY KEY,
    user_id     VARCHAR(50) NOT NULL,
    drawing_id  INTEGER,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    type        VARCHAR(50) DEFAULT 'task',
    is_read     BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_ln_user ON live_notifications(user_id, is_read);
`).catch(console.error);

// GET /api/notif/stream — SSE endpoint
async function sseStream(req, res) {
  const userId = req.session.user.id;
  console.log(`[SSE] Client connected: userId=${userId}`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  sse.addClient(userId, res);

  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM live_notifications WHERE user_id=$1 AND is_read=FALSE`,
      [userId]
    );
    const unread = rows[0].cnt;
    console.log(`[SSE] Init for ${userId}: ${unread} unread`);
    res.write(`event: init\ndata: ${JSON.stringify({ unread })}\n\n`);
  } catch (e) { console.error('[SSE] init query error:', e.message); }

  const hb = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(hb); }
  }, 25000);

  req.on('close', () => {
    clearInterval(hb);
    sse.removeClient(userId, res);
    console.log(`[SSE] Client disconnected: userId=${userId}`);
  });
}

// GET /api/notif
async function getNotifList(req, res) {
  const userId = req.session.user.id;
  try {
    const { rows } = await pool.query(
      `SELECT n.*
       FROM live_notifications n
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC LIMIT 50`,
      [userId]
    );
    res.json({ ok: true, notifications: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
}

// PUT /api/notif/read-all
async function markAllRead(req, res) {
  const userId = req.session.user.id;
  try {
    await pool.query(`UPDATE live_notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE`, [userId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
}

// PUT /api/notif/:id/read
async function markOneRead(req, res) {
  const userId = req.session.user.id;
  const id = parseInt(req.params.id);
  try {
    await pool.query(`UPDATE live_notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2`, [id, userId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
}

module.exports = { sseStream, getNotifList, markAllRead, markOneRead };
