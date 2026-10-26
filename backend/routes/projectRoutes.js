const router = require("express").Router();
const ctrl = require("../controllers/projectController");
const { requireLogin, requireHOD, requireSGL } = require("../middleware/auth");

// Projects, units, SGLs and role assignments are owned by PIMS (cmp_pims_1014 on PC-2)
// and read live through read-only views — they can only be changed in PIMS.
function managedInPims(req, res) {
  res.status(403).json({ success: false, message: "Projects, units and role assignments are managed in PIMS. Changes made there appear here immediately." });
}

router.post("/create", requireHOD, managedInPims);
router.get("/", requireLogin, ctrl.getAllProjects);
router.get("/assigned", requireLogin, ctrl.getAssignedProjects);
router.get("/modeller-projects", requireLogin, ctrl.getModellerProjects);
router.get("/:projectId/modeller-units", requireLogin, ctrl.getModellerUnits);
router.post("/assign-sgls", requireHOD, managedInPims);
router.post("/remove-sgls", requireHOD, managedInPims);
router.get("/:projectId/sgls", requireLogin, ctrl.getProjectSGLs);
router.post("/add-units", requireSGL, managedInPims);
router.get("/:projectId/units", requireLogin, ctrl.getProjectUnits);
router.post("/assign-roles", requireSGL, managedInPims);
router.post("/remove-roles", requireSGL, managedInPims);
router.get("/:projectId/assignments", requireLogin, ctrl.getAssignments);

module.exports = router;
