const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { authRequired } = require('../middleware/auth');
const {
  getStatus,
  start,
  stop,
  getLogs,
  previewTokenRequired,
  proxy,
} = require('../controllers/previewController');

// Authenticated control endpoints (called by the app UI with the JWT).
router.get('/:id/preview/status', authRequired, asyncHandler(getStatus));
router.post('/:id/preview/start', authRequired, asyncHandler(start));
router.post('/:id/preview/stop', authRequired, asyncHandler(stop));
router.get('/:id/preview/logs', authRequired, asyncHandler(getLogs));

// Unauthenticated proxy for the iframe — authorized via a short-lived,
// project-scoped preview token (cookie or ?token= query on first load).
router.use('/:id/preview', previewTokenRequired);
router.get('/:id/preview', proxy);
router.get('/:id/preview/*', proxy);
router.head('/:id/preview', proxy);
router.head('/:id/preview/*', proxy);

module.exports = router;
