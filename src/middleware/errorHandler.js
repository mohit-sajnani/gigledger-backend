const logger = require('../utils/logger');

/**
 * Normalizes every thrown/forwarded error into the project's shared
 * response envelope: { success: false, message, errors }.
 * Must be the last middleware mounted in app.js.
 */
function errorHandler(err, req, res, next) {
  let statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  let message = err.message || 'Internal Server Error';
  let errors = [];

  if (err.name === 'ValidationError') {
    statusCode = 400;
    errors = Object.values(err.errors).map((e) => e.message);
    message = 'Validation failed';
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for field "${err.path}"`;
  } else if (err.code === 11000) {
    statusCode = 409;
    message = 'Duplicate value violates a unique constraint';
  } else if (err.statusCode) {
    statusCode = err.statusCode;
  }

  logger.error(`${req.method} ${req.originalUrl} — ${statusCode} — ${message}`);

  res.status(statusCode).json({
    success: false,
    message,
    errors,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

module.exports = errorHandler;
