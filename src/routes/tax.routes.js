const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth.middleware');
const { getTaxEstimate, searchTaxRules, exportTaxReport } = require('../controllers/tax.controller');

const router = express.Router();

/**
 * Both routes below call Gemini (embedding + generation), which is slow,
 * billed, and — demonstrated during this feature's own testing — prone to
 * multi-minute hangs under rapid repeated calls on the same API key once
 * Google's own rate limit kicks in. Keyed per-user (not per-IP) since every
 * caller here is already authenticated.
 */
const taxLlmRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.userId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many tax estimation requests — please wait a moment and try again.', errors: [] },
});

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
  taxLlmRateLimit,
  [
    query('period').notEmpty().matches(/^Q[1-4]-\d{4}-\d{2}$/).withMessage('period must look like Q2-2024-25'),
    query('refresh').optional().isBoolean().withMessage('refresh must be a boolean'),
  ],
  checkValidation,
  getTaxEstimate,
);

router.get(
  '/rules/search',
  protect,
  taxLlmRateLimit,
  [
    query('q').notEmpty().trim().withMessage('q is required'),
    query('topK').optional().isInt({ min: 1, max: 10 }).withMessage('topK must be between 1 and 10'),
  ],
  checkValidation,
  searchTaxRules,
);

// No LLM/RAG call on this path (it only reads an already-computed
// TaxEstimate), so it's deliberately not wrapped in taxLlmRateLimit — that
// limiter's max:5/min is sized for Gemini cost, which doesn't apply here.
router.get(
  '/export',
  protect,
  [
    query('period').notEmpty().matches(/^Q[1-4]-\d{4}-\d{2}$/).withMessage('period must look like Q2-2024-25'),
    query('format').optional().isIn(['pdf', 'excel']).withMessage('format must be pdf or excel'),
  ],
  checkValidation,
  exportTaxReport,
);

module.exports = router;
