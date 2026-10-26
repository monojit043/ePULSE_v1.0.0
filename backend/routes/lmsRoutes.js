const router = require('express').Router();
const ctrl   = require('../controllers/lmsController');
const { requireLogin } = require('../middleware/auth');

router.get('/lms/categories', requireLogin, ctrl.getLmsCategories);
router.post('/lms/preview', requireLogin, ctrl.previewLmsData);
router.post('/lms/apply',   requireLogin, ctrl.uploadLmsData);
// Old name kept so a cached page still goes through the same unit rules
router.post('/lms/upload',  requireLogin, ctrl.uploadLmsData);
router.get('/lms/line',     requireLogin, ctrl.getLmsByLine);
router.get('/lms/data',     requireLogin, ctrl.getLmsData);
router.get('/lms/summary',  requireLogin, ctrl.getLmsSummary);
router.get('/lms/original',  requireLogin, ctrl.downloadLmsOriginal);
router.get('/lms/export',   requireLogin, ctrl.exportLmsData);

module.exports = router;
