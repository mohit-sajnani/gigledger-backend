const jwt = require('jsonwebtoken');

/**
 * Gate for every protected route: no token, no req.userId, no access.
 * Fails fast with a plain 401 — there's no user context yet to route
 * through the shared errorHandler in any richer way.
 */
const protect = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized',
      errors: [],
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized',
      errors: [],
    });
  }
};

module.exports = { protect };
