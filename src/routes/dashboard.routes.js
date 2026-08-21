const express = require('express');
const { query, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth.middleware');
const {
  getSummary,
  getIncomeBySource,
  getExpenseByCategory,
  getMonthlyTrend,
  getTaxSavings,
} = require('../controllers/dashboard.controller');

const router = express.Router();

router.use(protect);

/** Short-circuits to a 400 with the express-validator error list if any rule failed. */
function checkValidation(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: result.array().map((e) => e.msg),
    });
  }
  next();
}

const monthValidator = query('month').optional().matches(/^\d{4}-(0[1-9]|1[0-2])$/);
const monthsValidator = query('months').optional().isInt({ min: 1, max: 24 }).toInt();

router.get('/summary', [monthValidator], checkValidation, getSummary);
router.get('/income-by-source', [monthValidator], checkValidation, getIncomeBySource);
router.get('/expense-by-category', [monthValidator], checkValidation, getExpenseByCategory);
router.get('/monthly-trend', [monthsValidator], checkValidation, getMonthlyTrend);
router.get('/tax-savings', getTaxSavings);

module.exports = router;
