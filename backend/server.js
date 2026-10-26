require("dotenv").config();
const app = require("./app");
const os = require("os");
const { testConnection } = require("./db/pool");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

async function start() {
  try {
    const dbInfo = await testConnection();
    console.log(`✅ PostgreSQL connected — DB: ${dbInfo.db} | Time: ${dbInfo.time}`);
  } catch (err) {
    console.error("❌ PostgreSQL connection FAILED:", err.message);
    console.error("   Check .env — DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD");
    process.exit(1);
  }

  // Users / projects / units / roles are live views over PC-2 (postgres_fdw) — warn but keep running if it's down
  try {
    const { pool } = require("./db/pool");
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM projects)::int AS projects`
    );
    console.log(`✅ PC-2 live link OK — Users: ${rows[0].users} | Projects: ${rows[0].projects}`);
  } catch (err) {
    console.error("⚠️  PC-2 live link FAILED (login, projects and roles will not work):", err.message);
    console.error("   Check PC-2 is reachable, then re-run: npm run db:link-pc2");
  }

  // ISO lots, batch upload and the S3D export scheduler moved with PIMS to D:\PIMS_APP (2026-10-21).

  app.listen(PORT, HOST, () => {
    console.log("🚀 ePULSE Server started");
    console.log(`👉 Local:   http://localhost:${PORT}`);
    console.log(`👉 Network: http://${getLocalIP()}:${PORT}`);
  });
}

start();
