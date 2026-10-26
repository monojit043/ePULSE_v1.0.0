const userQ = require("../db/queries/userQueries");
const sso = require("../utils/sso");

async function login(req, res) {
  const { employeeId, password } = req.body || {};
  if (!employeeId || !password)
    return res.status(400).json({ success: false, message: "Employee ID and password required" });

  let user;
  try {
    const found = await userQ.findByCredentials(employeeId, password);
    user = found && await userQ.loadLiveUser(found.id);
  } catch (err) {
    console.error("❌ Login: PC-2 unreachable:", err.message);
    return res.status(503).json({ success: false, message: "Login server (employee database) is unreachable. Please try again later." });
  }
  if (!user) return res.status(401).json({ success: false, message: "Invalid Employee ID or Password" });

  // Roles stored here are refreshed live from PC-2 on every API request (middleware/auth.js → refreshLiveUser)
  req.session.user = user;
  sso.setCookie(res, user.id); // single sign-on: MRCS and other modules recognise this sign-in

  // The gateway and GAD login pages pick their own landing page; PIMS (user / hod / sgl pages)
  // is a separate app since 2026-10-21, so the suggestion is simply the gateway.
  res.json({ success: true, redirect: "/gateway.html" });
}

// Signs out of ePULSE and, via the shared cookie, every other module (MRCS…)
function logout(req, res) {
  sso.clearCookie(res);
  req.session.destroy(() => res.json({ success: true }));
}

function me(req, res) {
  res.json(req.session.user);
}

// Passwords are owned by the employee master DB (eil_employees on PC-2), not ePULSE.
function changePassword(req, res) {
  res.status(403).json({ message: 'Passwords are managed centrally. Please change your password in PIMS.' });
}

module.exports = { login, logout, me, changePassword };
