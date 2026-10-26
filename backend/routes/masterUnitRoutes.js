const router = require("express").Router();
const { requireLogin } = require("../middleware/auth");
const ctrl = require("../controllers/masterUnitController");

// resolve must be before the plain GET to avoid path collision
router.get("/master-units/resolve", requireLogin, ctrl.resolveMasterUnit);
router.get("/master-units",         requireLogin, ctrl.getMasterUnits);
// Master-unit groups come live from PIMS (units.parent_unit) — they can only be changed in PIMS
function managedInPims(req, res) {
  res.status(403).json({ ok: false, error: "Master units are managed in PIMS (unit parent). Changes made there appear here immediately." });
}
router.post("/master-units",        requireLogin, managedInPims);
router.delete("/master-units",      requireLogin, managedInPims);

module.exports = router;
