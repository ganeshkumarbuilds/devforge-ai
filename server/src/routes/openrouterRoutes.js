const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { status } = require('../controllers/openrouterController');

router.get('/status', asyncHandler(status));

module.exports = router;
