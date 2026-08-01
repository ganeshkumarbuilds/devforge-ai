const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { register, login, me, updateSettings, updateProfile, changePassword, listSessions, logout } = require('../controllers/authController');
const { authRequired } = require('../middleware/auth');
const { run, registerRules, loginRules, updateSettingsRules } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimiter');

router.post('/register', authLimiter, registerRules, run, asyncHandler(register));
router.post('/login', authLimiter, loginRules, run, asyncHandler(login));
router.post('/logout', asyncHandler(logout));

router.get('/me', authRequired, asyncHandler(me));
router.patch('/settings', authRequired, updateSettingsRules, run, asyncHandler(updateSettings));
router.patch('/profile', authRequired, asyncHandler(updateProfile));
router.post('/change-password', authRequired, asyncHandler(changePassword));
router.get('/sessions', authRequired, asyncHandler(listSessions));

module.exports = router;
