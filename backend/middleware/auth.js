const { pool } = require("../db/pool");
const userQ = require("../db/queries/userQueries");
const sso = require("../utils/sso");

// Runs on every API request:
//  1. WHO is signed in comes from the shared single sign-on cookie (utils/sso.js),
//     so signing in/out in ePULSE or MRCS applies to both. No cookie → signed out.
//  2. Their HOD / SGL / roles are re-read live from PC-2, so role changes in PIMS
//     apply immediately. A user deactivated in eil_employees is signed out.
async function refreshLiveUser(req, res, next) {
  if (req.path === "/login" || req.path === "/logout") return next();

  const ssoId = sso.currentUserId(req);
  if (!ssoId) {
    if (!req.session?.user) return next(); // not signed in anywhere — requireLogin decides
    return req.session.destroy(() =>
      res.status(401).json({ message: "Signed out. Please sign in again." }));
  }

  try {
    const live = await userQ.loadLiveUser(ssoId);
    if (!live) {
      sso.clearCookie(res);
      return req.session.destroy(() =>
        res.status(401).json({ message: "Your account is no longer active. Please contact ITS." }));
    }
    req.session.user = live; // also adopts a sign-in made in another app (single sign-on)
    next();
  } catch (err) {
    console.error("❌ refreshLiveUser: PC-2 unreachable:", err.message);
    res.status(503).json({ message: "Role server (PC-2) is unreachable. Please try again shortly." });
  }
}

function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ message: "Not authenticated" });
}

function requireHOD(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ message: "Not authenticated" });
  if (!req.session.user.isHod) return res.status(403).json({ message: "HOD access required" });
  next();
}

// Session-based role guard factory — HOD always passes.
// Usage: requireAnyRole('GL', 'SGL') returns middleware that passes if user holds at least one of those roles.
function requireAnyRole(...roles) {
  return function (req, res, next) {
    if (!req.session?.user) return res.status(401).json({ message: "Not authenticated" });
    if (req.session.user.isHod) return next();
    const userRoles = req.session.user.roles || [];
    if (roles.some(r => userRoles.includes(r))) return next();
    return res.status(403).json({ message: `Access requires one of: ${roles.join(', ')}` });
  };
}

const CHECKER_ROLES = ['Process Checker', 'Material Checker', 'Stress Checker'];
const requireModellerRole = requireAnyRole('Modeller');

async function requireSGL(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ message: "Not authenticated" });
  const { user } = req.session;
  if (user.isHod) return next();

  const { projectId, units } = req.body;

  // Check if user is in project_sgls
  if (projectId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM project_sgls WHERE project_id=$1 AND user_id=$2`,
      [projectId, user.id]
    );
    if (rows.length) return next();
  }

  // Check if user has SGL role on any of the target units
  if (projectId && Array.isArray(units) && units.length) {
    const { rows } = await pool.query(
      `SELECT 1 FROM user_role_assignments
       WHERE user_id=$1 AND project_id=$2 AND unit_no=ANY($3) AND role='SGL'`,
      [user.id, projectId, units]
    );
    if (rows.length) return next();
  }

  return res.status(403).json({ message: "SGL access required" });
}

module.exports = {
  refreshLiveUser,
  requireLogin,
  requireHOD,
  requireSGL,
  requireAnyRole,
  requireModellerRole,
};
