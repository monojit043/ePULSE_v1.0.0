const router = require("express").Router();
const ctrl = require("../controllers/notificationController");
const { requireLogin } = require("../middleware/auth");

// Live notification SSE + CRUD (the notification bell on the gateway and GAD).
// The ISO-workflow routes moved with PIMS to D:\PIMS_APP (2026-10-21).
router.get("/notif/stream",     requireLogin, ctrl.sseStream);
router.get("/notif",            requireLogin, ctrl.getNotifList);
router.put("/notif/read-all",   requireLogin, ctrl.markAllRead);
router.put("/notif/:id/read",   requireLogin, ctrl.markOneRead);

module.exports = router;
