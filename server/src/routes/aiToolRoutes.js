const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { run: runValidation, aiToolRunRules } = require('../middleware/validate');
const { chatLimiter } = require('../middleware/rateLimiter');
const { getTools, run } = require('../controllers/aiToolController');

router.use(authRequired);

router.get('/', asyncHandler(getTools));
router.post('/run', chatLimiter, aiToolRunRules, runValidation, asyncHandler(run));

module.exports = router;
