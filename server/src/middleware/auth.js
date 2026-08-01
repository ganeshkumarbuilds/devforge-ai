const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config');
const HttpError = require('../utils/httpError');
const { validateSession, createSession } = require('../services/sessionService');

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' });
}

async function establishSession(req, res, user) {
  const token = signToken(user);
  const sessionToken = await createSession({
    userId: user.id,
    ip: req.ip || null,
    userAgent: req.get('user-agent') || null,
  });
  res.set('X-Session-Token', sessionToken);
  return token;
}

async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return next(new HttpError(401, 'Authentication required'));
  }

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch (err) {
    return next(new HttpError(401, 'Invalid or expired token'));
  }

  const sessionToken = req.get('x-session-token');
  if (sessionToken) {
    const session = await validateSession(sessionToken);
    if (!session) {
      return next(new HttpError(401, 'Session expired, please log in again'));
    }
  }

  req.userId = payload.sub;
  req.userEmail = payload.email;
  return next();
}

module.exports = { signToken, authRequired, establishSession };
