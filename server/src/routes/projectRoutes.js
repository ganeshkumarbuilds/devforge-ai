const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { run, generateRules } = require('../middleware/validate');
const { generateLimiter } = require('../middleware/rateLimiter');
const {
  generate,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  rebuildProject,
  downloadZip,
  exportLogs,
  exportDocs,
  getLogs,
  getStatus,
} = require('../controllers/projectController');

router.use(authRequired);

router.get('/status', asyncHandler(getStatus));
router.get('/', asyncHandler(listProjects));
router.post('/generate', generateLimiter, generateRules, run, asyncHandler(generate));
router.get('/:id', asyncHandler(getProject));
router.patch('/:id', asyncHandler(updateProject));
router.delete('/:id', asyncHandler(deleteProject));
router.post('/:id/rebuild', asyncHandler(rebuildProject));
router.get('/:id/download', asyncHandler(downloadZip));
router.get('/:id/logs', asyncHandler(getLogs));
router.get('/:id/export/logs', asyncHandler(exportLogs));
router.get('/:id/export/docs', asyncHandler(exportDocs));

module.exports = router;
