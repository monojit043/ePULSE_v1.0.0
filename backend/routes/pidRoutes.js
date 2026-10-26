const path = require("path");
const fs = require("fs");
const multer = require("multer");
const router = require("express").Router();
const { requireLogin, requireAnyRole } = require("../middleware/auth");
const ctrl = require("../controllers/pidIndexController");
const docCtrl = require("../controllers/pidDocumentController");
const consolCtrl = require("../controllers/pidConsolidationController");

// Declaring/managing P&IDs (Master Index + Document Upload) is a GL / ISO
// Manager tool only — requireAnyRole already covers the auth check (401 if
// not logged in) as well as the role gate.
const requirePidAccess = requireAnyRole("GL", "ISO Manager");

router.get("/pid/scope", requirePidAccess, ctrl.getScope);
router.get("/pid/master-index/template", requirePidAccess, ctrl.downloadTemplate);
router.get("/pid/master-index", requirePidAccess, ctrl.getMasterIndex);
// Read-only P&ID data is open to any logged-in user, any job — the standalone
// "P&IDs" browse page (pid-view.html) is for everyone, not just GL/ISO
// Manager, since P&IDs are reference material. Only the write endpoints below
// (add/import/retire/upload) stay gated to requirePidAccess.
router.get("/pid/master-index/with-status", requireLogin, ctrl.getMasterIndexWithStatus);
router.post("/pid/master-index/import/preview", requirePidAccess, ctrl.previewMasterIndexImport);
// Uploaded index files — anyone signed in can see and download them, as uploaded
router.get("/pid/index-issues", requireLogin, ctrl.listIndexIssues);
router.get("/pid/index-issues/:id/file", requireLogin, ctrl.downloadIndexIssueFile);
router.post("/pid/master-index/import", requirePidAccess, ctrl.importMasterIndex);
router.post("/pid/master-index/:id/retire", requirePidAccess, ctrl.retireMasterIndexRow);
router.post("/pid/master-index", requirePidAccess, ctrl.addMasterIndexRow);
router.get("/pid/master-index/:id/documents", requireLogin, docCtrl.getDocumentHistory);
router.get("/pid/lines", requireLogin, docCtrl.getLinesByJobUnit);
router.get("/pid/consolidated-lines", requireLogin, consolCtrl.getConsolidatedLines);

// Multer only stages files into a generic temp folder here — it deliberately
// does NOT parse the filename to pick a per-P&ID destination, because a
// storage-engine callback error aborts multer's entire batch, not just the
// one bad file. The controller does real per-file parsing/validation/move
// afterward, in application code, where one bad name can be skipped without
// losing the rest of the batch.
const PID_STAGING_DIR = path.join(__dirname, "..", "uploads", "_pid_staging");
const pidDocStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(PID_STAGING_DIR, { recursive: true });
    cb(null, PID_STAGING_DIR);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]/g, "_");
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`);
  },
});
const uploadPidDocs = multer({
  storage: pidDocStorage,
  fileFilter: (_req, file, cb) => {
    if (!/\.pdf$/i.test(file.originalname)) return cb(new Error(`"${file.originalname}" is not a PDF`));
    cb(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024, files: 30 },
});

router.post("/pid/documents/upload", requirePidAccess, (req, res, next) => {
  uploadPidDocs.array("files", 30)(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    docCtrl.uploadPidDocuments(req, res).catch(next);
  });
});
router.post("/pid/documents/:id/resolve", requirePidAccess, docCtrl.resolvePendingDocument);

module.exports = router;
