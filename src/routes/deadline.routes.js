const express = require('express');
const { query, body, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth.middleware');
const { listDeadlines, notifyDueDeadlines } = require('../controllers/deadline.controller');

const router = express.Router();

/** Short-circuits to a 400 with the express-validator error list if any rule failed. */
function checkValidation(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: result.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

router.get(
  '/',
  protect,
  [
    query('status').optional().isIn(['upcoming', 'due', 'overdue', 'completed']),
    query('withinDays').optional().isInt({ min: 1 }),
  ],
  checkValidation,
  listDeadlines,
);

router.post(
  '/notify',
  protect,
  [body('windowDays').optional().isInt({ min: 1, max: 30 }).withMessage('windowDays must be between 1 and 30')],
  checkValidation,
  notifyDueDeadlines,
);

module.exports = router;
