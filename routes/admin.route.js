const router = require('express').Router();
const adminAuth = require('../middleware/adminAuth');
const c = require('../controllers/admin.controller');

router.use(adminAuth);
router.get('/ai/health', c.health);
router.get('/research/status', c.researchStatus);
router.post('/research/run', c.researchRun);
router.get('/providers', c.list);
router.post('/providers', c.create);
router.post('/providers/reset-cooldowns', c.resetCooldowns);
router.post('/providers/preview-models', c.previewModels);
router.post('/providers/:id/auto-model', c.autoModel);
router.post('/live/refresh', c.liveRefresh);
router.patch('/providers/:id', c.update);
router.delete('/providers/:id', c.remove);
router.post('/providers/:id/test', c.test);
router.get('/providers/:id/models', c.models);

module.exports = router;
