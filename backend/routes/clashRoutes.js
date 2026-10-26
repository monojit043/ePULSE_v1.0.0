const router = require('express').Router();
const ctrl   = require('../controllers/clashController');
const { requireLogin } = require('../middleware/auth');

router.post('/clash/upload',  requireLogin, ctrl.uploadClashReport);
router.get('/clash/data',     requireLogin, ctrl.getClashData);
router.get('/clash/summary',  requireLogin, ctrl.getClashSummary);
router.get('/clash/files',    requireLogin, ctrl.getClashFiles);
router.get('/clash/files/:id/download', requireLogin, ctrl.downloadClashFile);

module.exports = router;
