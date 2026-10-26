const router = require('express').Router();
const ctrl   = require('../controllers/linelistNormController');
const { requireLogin } = require('../middleware/auth');

router.post('/linelist/save',              requireLogin, ctrl.saveLinelist);
router.get('/linelist/jobs',               requireLogin, ctrl.getJobsSummary);
router.get('/linelist/check-rev/:jobNo',   requireLogin, ctrl.checkRev);
router.get('/linelist/line-data',          requireLogin, ctrl.getLineData);
router.get('/linelist/line-history',       requireLogin, ctrl.getLineHistory);

module.exports = router;
