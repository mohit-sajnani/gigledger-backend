const Category = require('../models/Category');
const ocr = require('../services/ocr.service');
const logger = require('../utils/logger');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Validates a raw LLM-extracted amount into either a trustworthy positive
 * number or null — never passes through a string, negative, or NaN as if
 * it were real data.
 */
const validateAmount = (rawAmount) => {
  if (typeof rawAmount !== 'number' || !Number.isFinite(rawAmount) || rawAmount <= 0) return null;
  return rawAmount;
};

/** A missing/illegible/unparseable date defaults to today — never an LLM guess passed through as fact. */
const validateDate = (rawDate) => {
  if (typeof rawDate !== 'string') return new Date();
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

/** Only a category that actually exists gets suggested — an invented name is dropped, not force-matched. */
const matchCategory = (rawCategoryName, categories) => {
  if (typeof rawCategoryName !== 'string') return null;
  const match = categories.find((c) => c.name.toLowerCase() === rawCategoryName.toLowerCase());
  return match ? { id: match._id, name: match.name } : null;
};

/**
 * POST /api/receipts/upload — extracts a suggested transaction from a
 * receipt photo. Never writes a Transaction: the client reviews/edits the
 * suggestion and submits it themselves via the existing POST /api/transactions.
 */
const uploadReceipt = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: [{ field: 'receipt', message: 'A receipt image file is required (jpeg, png, or webp)' }],
    });
  }

  const categories = await Category.find({ deleted: false }).select('name').lean();

  let extracted;
  try {
    extracted = await ocr.extractReceiptData(req.file.buffer, req.file.mimetype, categories.map((c) => c.name));
  } catch (err) {
    logger.error(`Receipt OCR failed: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Receipt processing is temporarily unavailable', errors: [] });
  }

  const amount = validateAmount(extracted.amount);
  const category = matchCategory(extracted.category, categories);
  const confidence = amount !== null && category !== null ? 'high' : 'low';

  res.status(200).json({
    success: true,
    data: {
      amount,
      date: validateDate(extracted.date),
      rawDescription: typeof extracted.description === 'string' ? extracted.description.slice(0, 500) : '',
      category,
      confidence,
    },
    message: '',
  });
});

module.exports = { uploadReceipt };
