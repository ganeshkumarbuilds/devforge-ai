const { body, validationResult } = require('express-validator');
const HttpError = require('../utils/httpError');

function run(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const message = result
    .array()
    .map((e) => e.msg)
    .join(', ');
  return next(new HttpError(400, message));
}

const registerRules = [
  body('name').trim().isLength({ min: 1, max: 80 }).withMessage('Name is required (max 80 chars)'),
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password').isLength({ min: 8, max: 128 }).withMessage('Password must be 8-128 characters'),
];

const loginRules = [
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password').isLength({ min: 1 }).withMessage('Password is required'),
];

const updateSettingsRules = [
  body('settings').optional({ values: 'falsy' }).isObject().withMessage('Settings must be an object'),
];

const generateRules = [
  body('prompt')
    .trim()
    .isLength({ min: 10, max: 8000 })
    .withMessage('Project description must be 10-8000 characters'),
  body('stack').optional({ values: 'falsy' }).trim().isLength({ min: 1, max: 100 }).withMessage('Stack name too long'),
];

module.exports = {
  run,
  registerRules,
  loginRules,
  updateSettingsRules,
  generateRules,
};
