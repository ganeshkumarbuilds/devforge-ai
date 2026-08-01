const rateLimit = require('express-rate-limit');
const { rateLimitWindowMs, rateLimitMax } = require('../config');

const authLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const generateLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: Math.max(5, Math.floor(rateLimitMax / 10)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Build limit reached, please wait a moment before generating again.' },
});

module.exports = { authLimiter, generateLimiter };
