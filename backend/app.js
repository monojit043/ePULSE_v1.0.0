require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const { pool } = require("./db/pool");
const PgSessionStore = require("./db/pgSessionStore");

const noCache = require("./middleware/noCache");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const projectRoutes = require("./routes/projectRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const linelistNormRoutes = require("./routes/linelistNormRoutes");
const inchRoutes         = require("./routes/inchRoutes");
const clashRoutes        = require("./routes/clashRoutes");
const lmsRoutes          = require("./routes/lmsRoutes");
const gadRoutes          = require("./routes/gadRoutes");
const masterUnitRoutes   = require("./routes/masterUnitRoutes");
const pidRoutes          = require("./routes/pidRoutes");
const pipingLineListRoutes = require("./routes/pipingLineListRoutes");

const app = express();

// ---------- BASIC MIDDLEWARE ----------
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ---------- SESSION ----------
app.use(
  session({
    secret: process.env.SESSION_SECRET || "pims-secret",
    resave: false,
    saveUninitialized: false,
    store: new PgSessionStore(pool),
    cookie: { maxAge: 8 * 60 * 60 * 1000 },
  })
);

// ---------- NO-CACHE FOR API ----------
app.use("/api", noCache);
// Roles / HOD / SGL come live from PC-2 on every request — never trusted from login time
app.use("/api", require("./middleware/auth").refreshLiveUser);

// ---------- ROOT ----------
// dashboard.html is being phased out as an entry point (kept on disk, not
// deleted). The Gateway is now the sole front door: "/" -> its login ->
// gateway.html, from which every module/tool is launched.
app.get("/", (req, res) => res.redirect("/gateway-login.html"));

// ---------- STATIC FILES ----------
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const UPLOADS_DIR = path.join(__dirname, "uploads");
// index:false so express.static doesn't auto-serve public/index.html for
// "/" behind the redirect above — the route above is the single source of
// truth for what "/" does now.
app.use(express.static(PUBLIC_DIR, { index: false }));
app.use("/uploads", express.static(UPLOADS_DIR));

// ---------- API ROUTES ----------
// PIMS (ISO drawings, lots, reports, ISO pre-checks, batch upload) is a separate app
// since 2026-10-21 — D:\PIMS_APP on :3400.
app.use("/api", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api", notificationRoutes);
app.use("/api", linelistNormRoutes);
app.use("/api", inchRoutes);
app.use("/api", clashRoutes);
app.use("/api", lmsRoutes);
app.use("/api", gadRoutes);
app.use("/api", masterUnitRoutes);
app.use("/api", pidRoutes);
app.use("/api", pipingLineListRoutes);

// ---------- HEALTH CHECK ----------
app.get("/api/health", (req, res) => res.json({ status: "OK", db: "PostgreSQL" }));

// ---------- GLOBAL ERROR HANDLER ----------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ ok: false, error: err.message || "Internal server error" });
});

module.exports = app;
