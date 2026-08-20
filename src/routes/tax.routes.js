const express = require('express');
const { query, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth.middleware');
const { getTaxEstimate, searchTaxRules } = require('../controllers/tax.controller');

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
  '/estimate',
  protect,
  [query('period').notEmpty().matches(/^Q[1-4]-\d{4}-\d{2}$/).withMessage('period must look like Q2-2024-25')],
  checkValidation,
  getTaxEstimate,
);

router.get(
  '/rules/search',
  protect,
  [
    query('q').notEmpty().trim().withMessage('q is required'),
    query('topK').optional().isInt({ min: 1, max: 10 }).withMessage('topK must be between 1 and 10'),
  ],
  checkValidation,
  searchTaxRules,
);

module.exports = router;
