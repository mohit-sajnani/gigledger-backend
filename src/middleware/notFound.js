/**
 * Catches any request that didn't match a mounted route and forwards a 404
 * to errorHandler, which normalizes it into the shared response envelope.
 */
function notFound(req, res, next) {
  res.status(404);
  next(new Error(`Route not found: ${req.method} ${req.originalUrl}`));
}

module.exports = notFound;
