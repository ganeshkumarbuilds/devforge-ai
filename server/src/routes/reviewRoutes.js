const router = require('express').Router();
const multer = require('multer');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { reviewLimiter } = require('../middleware/rateLimiter');
const { upload, list, get, remove, exportPdf } = require('../controllers/reviewController');

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 200 },
});

router.use(authRequired);

router.get('/', asyncHandler(list));
router.post('/upload', reviewLimiter, uploadMiddleware.array('files', 200), asyncHandler(upload));
router.get('/:id', asyncHandler(get));
router.get('/:id/export/pdf', asyncHandler(exportPdf));
router.delete('/:id', asyncHandler(remove));

module.exports = router;
