const router = require("express").Router();
const ctrl = require("../controllers/pipingLineListController");
const { requireLogin } = require("../middleware/auth");

// Same access model as the closely-related Line List Normalizer save
// endpoint (linelistNormRoutes.js) — requireLogin only, no extra role gate.
router.post("/piping-line-list", requireLogin, ctrl.createLineList);
router.get("/piping-line-list", requireLogin, ctrl.getLineList);

module.exports = router;
