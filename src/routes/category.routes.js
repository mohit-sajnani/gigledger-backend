const express = require('express');
const { query, body, validationResult } = require('express-validator');
const { getCategories, createCategory } = require('../controllers/category.controller');

const router = express.Router();

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

router.get(
  '/',
  [query('type').optional().isIn(['income', 'expense'])],
  checkValidation,
  getCategories,
);

router.post(
  '/',
  [
    body('name').notEmpty().trim(),
    body('type').isIn(['income', 'expense']),
    body('taxDeductible').optional().isBoolean(),
    body('color').optional().isHexColor(),
    body('icon').optional().isString().trim(),
    body('isDefault').optional().isBoolean(),
  ],
  checkValidation,
  createCategory,
);

module.exports = router;
