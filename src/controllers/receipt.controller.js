const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');
const { bufferMatchesDeclaredType, extractReceiptData } = require('../services/receipt.service');

/**
 * POST /api/receipts/upload — OCR a receipt image into a proposed expense
 * entry. Never writes to the database: the caller reviews/edits the
 * returned fields and POSTs /api/transactions themselves to actually save it.
 */
const uploadReceipt = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: [{ field: 'receipt', message: 'A receipt image file is required (jpeg, png, or webp)' }],
    });
  }

  if (!bufferMatchesDeclaredType(req.file.buffer, req.file.mimetype)) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: [{ field: 'receipt', message: 'File content does not match its declared type' }],
    });
  }

  let extracted;
  try {
    extracted = await extractReceiptData(req.file.buffer, req.file.mimetype);
  } catch (err) {
    logger.error(`Receipt OCR failed for user ${req.userId}: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Receipt processing is temporarily unavailable',
      errors: [],
    });
  }

  res.status(200).json({ success: true, data: extracted, message: 'Receipt processed' });
});

module.exports = { uploadReceipt };
