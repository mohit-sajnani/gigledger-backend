/**
 * Wraps an async Express handler so any rejected promise is forwarded to
 * next() instead of crashing the process — avoids repeating try/catch in
 * every controller.
 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
