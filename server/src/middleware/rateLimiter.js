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

const chatLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: Math.max(20, Math.floor(rateLimitMax / 4)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Message limit reached, please wait a moment before sending another message.' },
});

const reviewLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: Math.max(10, Math.floor(rateLimitMax / 8)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Review limit reached, please wait a moment before requesting another review.' },
});

module.exports = { authLimiter, generateLimiter, chatLimiter, reviewLimiter };
