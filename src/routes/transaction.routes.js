const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth.middleware');
const {
  createTransaction,
  listTransactions,
  getTransaction,
  updateTransaction,
  deleteTransaction,
  bulkImportTransactions,
  approveTransaction,
} = require('../controllers/transaction.controller');

const router = express.Router();

// Auth has landed — every transaction route now requires it. Falls back to
// DEMO_USER_ID only if req.userId is somehow unset (see effectiveUserId in
// the controller), which shouldn't happen with protect in place.
router.use(protect);

const SOURCES = ['uber', 'swiggy', 'zomato', 'ola', 'manual', 'other'];
const TYPES = ['income', 'expense'];
const STATUSES = ['pending', 'categorized', 'reconciled'];

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

router.post(
  '/',
  [
    body('source').optional().isIn(SOURCES),
    body('type').isIn(TYPES),
    body('amount').isFloat({ min: 0 }),
    body('currency').optional().isString().isLength({ min: 3, max: 3 }),
    body('date').isISO8601(),
    body('rawDescription').optional().trim(),
    body('category').optional().isMongoId(),
    body('categoryConfidence').optional().isFloat({ min: 0, max: 1 }),
    body('sourceDocRef').optional().isString(),
    body('notes').optional().trim(),
  ],
  checkValidation,
  createTransaction,
);

router.get(
  '/',
  [
    query('status').optional().isIn(STATUSES),
    query('type').optional().isIn(TYPES),
    query('source').optional().isIn(SOURCES),
    query('dateFrom').optional().isISO8601(),
    query('dateTo').optional().isISO8601(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  checkValidation,
  listTransactions,
);

router.post(
  '/bulk',
  [body('transactions').isArray({ min: 1, max: 200 })],
  checkValidation,
  bulkImportTransactions,
);

router.get('/:id', [param('id').isMongoId()], checkValidation, getTransaction);

router.put(
  '/:id',
  [
    param('id').isMongoId(),
    body('source').optional().isIn(SOURCES),
    body('type').optional().isIn(TYPES),
    body('amount').optional().isFloat({ min: 0 }),
    body('currency').optional().isString().isLength({ min: 3, max: 3 }),
    body('date').optional().isISO8601(),
    body('rawDescription').optional().trim(),
    body('category').optional({ nullable: true }).isMongoId(),
    body('categoryConfidence').optional().isFloat({ min: 0, max: 1 }),
    body('status').optional().isIn(STATUSES),
    body('sourceDocRef').optional().isString(),
    body('notes').optional().trim(),
  ],
  checkValidation,
  updateTransaction,
);

router.delete('/:id', [param('id').isMongoId()], checkValidation, deleteTransaction);

router.patch('/:id/approve', [param('id').isMongoId()], checkValidation, approveTransaction);

module.exports = router;
