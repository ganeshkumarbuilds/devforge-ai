const HttpError = require('../utils/httpError');
const logger = require('../utils/logger');

function notFound(req, res, next) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message;

  if (err.name === 'PrismaClientKnownRequestError') {
    status = 400;
    message = 'Database request failed';
    logger.error('[DB]', err.code, err.meta && err.meta.target, err.message);
  } else if (err.name === 'PrismaClientValidationError') {
    status = 400;
    message = 'Invalid data sent to the database';
  } else if (err.name === 'MulterError') {
    status = 400;
    if (err.code === 'LIMIT_FILE_SIZE') message = 'File too large (max 25 MB per file)';
    else if (err.code === 'LIMIT_FILE_COUNT') message = 'Too many files uploaded';
    else message = `Upload error: ${err.code || err.message}`;
    logger.warn(`[Upload ${err.code}] ${req.method} ${req.originalUrl}`);
  } else if (status >= 500) {
    message = 'Internal server error';
  }

  if (status >= 500) {
    logger.error('[Server Error]', err);
  } else {
    logger.warn(`[HTTP ${status}] ${req.method} ${req.originalUrl} -> ${err.message}`);
  }

  res.status(status).json({
    error: message,
  });
}

module.exports = { notFound, errorHandler };
