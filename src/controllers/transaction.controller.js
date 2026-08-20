const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const asyncHandler = require('../utils/asyncHandler');

const UPDATABLE_FIELDS = [
  'source',
  'type',
  'amount',
  'currency',
  'date',
  'rawDescription',
  'category',
  'categoryConfidence',
  'status',
  'sourceDocRef',
  'notes',
];

/** Confirms a category id resolves to an existing, non-deleted Category doc. */
async function categoryExists(categoryId) {
  if (!categoryId) return true;
  const category = await Category.findOne({ _id: categoryId, deleted: false });
  return Boolean(category);
}

/**
 * POST /api/transactions — manual entry. userId/createdBy/status are always
 * server-set, never taken from the request body.
 */
const createTransaction = asyncHandler(async (req, res) => {
  const { source, type, amount, currency, date, rawDescription, category, categoryConfidence, sourceDocRef, notes } =
    req.body;

  if (category && !(await categoryExists(category))) {
    return res.status(400).json({ success: false, message: 'category does not reference an existing category', errors: [] });
  }

  const transaction = await Transaction.create({
    userId: req.userId,
    source,
    type,
    amount,
    currency,
    date,
    rawDescription,
    category: category || null,
    categoryConfidence,
    sourceDocRef,
    notes,
    createdBy: 'user',
  });

  res.status(201).json({ success: true, data: transaction, message: 'Transaction created' });
});

/**
 * GET /api/transactions — paginated, filtered list scoped to the requester.
 */
const listTransactions = asyncHandler(async (req, res) => {
  const { status, type, source, dateFrom, dateTo } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);

  if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
    return res.status(400).json({ success: false, message: 'dateFrom must be before dateTo', errors: [] });
  }

  const filter = { userId: req.userId, deleted: false };
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (source) filter.source = source;
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = new Date(dateFrom);
    if (dateTo) filter.date.$lte = new Date(dateTo);
  }

  const [items, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { items, page, limit, total, totalPages: Math.ceil(total / limit) },
    message: '',
  });
});

/**
 * GET /api/transactions/:id — returns 404 (not 403) for a transaction the
 * requester doesn't own, so existence isn't confirmed to a non-owner.
 */
const getTransaction = asyncHandler(async (req, res) => {
  const transaction = await Transaction.findOne({
    _id: req.params.id,
    userId: req.userId,
    deleted: false,
  });

  if (!transaction) {
    return res.status(404).json({ success: false, message: 'Transaction not found', errors: [] });
  }

  res.status(200).json({ success: true, data: transaction, message: '' });
});

/**
 * PUT /api/transactions/:id — whitelisted field update. userId/_id are
 * never accepted from the body even if present.
 */
const updateTransaction = asyncHandler(async (req, res) => {
  const transaction = await Transaction.findOne({
    _id: req.params.id,
    userId: req.userId,
    deleted: false,
  });

  if (!transaction) {
    return res.status(404).json({ success: false, message: 'Transaction not found', errors: [] });
  }

  if (req.body.category && !(await categoryExists(req.body.category))) {
    return res.status(400).json({ success: false, message: 'category does not reference an existing category', errors: [] });
  }

  UPDATABLE_FIELDS.forEach((field) => {
    if (req.body[field] !== undefined) transaction[field] = req.body[field];
  });

  await transaction.save();
  res.status(200).json({ success: true, data: transaction, message: 'Transaction updated' });
});

/**
 * DELETE /api/transactions/:id — soft delete only, document stays in the DB.
 */
const deleteTransaction = asyncHandler(async (req, res) => {
  const transaction = await Transaction.findOne({
    _id: req.params.id,
    userId: req.userId,
    deleted: false,
  });

  if (!transaction) {
    return res.status(404).json({ success: false, message: 'Transaction not found', errors: [] });
  }

  transaction.deleted = true;
  await transaction.save();

  res.status(200).json({ success: true, data: { _id: transaction._id, deleted: true }, message: 'Transaction deleted' });
});

/**
 * POST /api/transactions/bulk — simulated platform import. Row-level
 * failures are counted, not rejected — a partial import is expected behavior.
 */
const bulkImportTransactions = asyncHandler(async (req, res) => {
  const { transactions } = req.body;
  const userId = req.userId;

  const rows = [];
  const errors = [];

  transactions.forEach((row, index) => {
    if (!row.type || !['income', 'expense'].includes(row.type)) {
      errors.push({ index, message: 'type is required and must be income or expense' });
      return;
    }
    if (typeof row.amount !== 'number' || row.amount < 0) {
      errors.push({ index, message: 'amount must be a number >= 0' });
      return;
    }
    if (!row.date || Number.isNaN(new Date(row.date).getTime())) {
      errors.push({ index, message: 'date is required and must be a valid date' });
      return;
    }
    if (row.category && !mongoose.Types.ObjectId.isValid(row.category)) {
      errors.push({ index, message: 'category must be a valid id' });
      return;
    }

    rows.push({
      userId,
      source: row.source || 'manual',
      type: row.type,
      amount: row.amount,
      date: row.date,
      category: row.category || null,
      rawDescription: row.rawDescription,
      notes: row.notes,
      sourceDocRef: row.sourceDocRef,
      createdBy: 'user',
    });
  });

  let inserted = 0;
  if (rows.length > 0) {
    const result = await Transaction.insertMany(rows, { ordered: false });
    inserted = result.length;
  }

  res.status(201).json({
    success: true,
    data: { inserted, failed: errors.length, errors },
    message: 'Bulk transaction import processed',
  });
});

/**
 * PATCH /api/transactions/:id/approve — pure state transition, pending -> categorized.
 */
const approveTransaction = asyncHandler(async (req, res) => {
  const transaction = await Transaction.findOne({
    _id: req.params.id,
    userId: req.userId,
    deleted: false,
  });

  if (!transaction) {
    return res.status(404).json({ success: false, message: 'Transaction not found', errors: [] });
  }

  if (transaction.status !== 'pending') {
    return res.status(409).json({
      success: false,
      message: `Cannot approve a transaction with status "${transaction.status}"`,
      errors: [],
    });
  }

  transaction.status = 'categorized';
  await transaction.save();

  res.status(200).json({ success: true, data: { _id: transaction._id, status: transaction.status }, message: 'Transaction approved' });
});

module.exports = {
  createTransaction,
  listTransactions,
  getTransaction,
  updateTransaction,
  deleteTransaction,
  bulkImportTransactions,
  approveTransaction,
};
