const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { run, generateRules } = require('../middleware/validate');
const { generateLimiter } = require('../middleware/rateLimiter');
const {
  generate,
  listProjects,
  getStats,
  toggleFavorite,
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
const {
  list: listVersions,
  getOne: getVersion,
  createManual: createManualVersion,
  restore: restoreVersion,
  diff: diffVersions,
  migration: generateMigration,
} = require('../controllers/versionController');
const {
  getDeployment,
  exportDeployment,
} = require('../controllers/deploymentController');

router.use(authRequired);

router.get('/status', asyncHandler(getStatus));
router.get('/stats', asyncHandler(getStats));
router.get('/', asyncHandler(listProjects));
router.post('/generate', generateLimiter, generateRules, run, asyncHandler(generate));
router.patch('/:id/favorite', asyncHandler(toggleFavorite));
router.get('/:id', asyncHandler(getProject));
router.patch('/:id', asyncHandler(updateProject));
router.delete('/:id', asyncHandler(deleteProject));
router.post('/:id/rebuild', asyncHandler(rebuildProject));
router.get('/:id/download', asyncHandler(downloadZip));
router.get('/:id/logs', asyncHandler(getLogs));
router.get('/:id/export/logs', asyncHandler(exportLogs));
router.get('/:id/export/docs', asyncHandler(exportDocs));
router.get('/:id/deployment', asyncHandler(getDeployment));
router.get('/:id/export/deployment', asyncHandler(exportDeployment));

router.get('/:id/versions', asyncHandler(listVersions));
router.post('/:id/versions', asyncHandler(createManualVersion));
router.get('/:id/versions/:versionId', asyncHandler(getVersion));
router.post('/:id/versions/:versionId/restore', asyncHandler(restoreVersion));
router.get('/:id/versions/:versionId/diff/:compareId', asyncHandler(diffVersions));
router.get('/:id/versions/:versionId/migration', asyncHandler(generateMigration));

module.exports = router;
