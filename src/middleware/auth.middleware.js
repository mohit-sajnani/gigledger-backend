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

/**
 * Gate for system/cron-triggered actions that affect every user, not just
 * the caller — a valid user JWT isn't the right check here, since any
 * logged-in user would otherwise be able to trigger it. Requires a shared
 * secret only the trusted caller (e.g. an external cron) knows.
 */
const requireInternalSecret = (req, res, next) => {
  const provided = req.headers['x-internal-secret'];

  if (!process.env.INTERNAL_CRON_SECRET || provided !== process.env.INTERNAL_CRON_SECRET) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized',
      errors: [],
    });
  }

  next();
};

module.exports = { protect, requireInternalSecret };
