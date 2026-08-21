// Receipt routes
// POST /api/receipts/upload — upload image → OCR (Gemini) → proposed expense entry
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth.middleware');
const { ALLOWED_MIME_TYPES } = require('../services/receipt.service');
const { uploadReceipt } = require('../controllers/receipt.controller');

const router = express.Router();

// Gemini OCR is slow and billed, same rationale as the tax rate limit —
// keyed per-user since every caller here is already authenticated.
const receiptUploadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.userId,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many receipt uploads — please wait a moment and try again.',
    errors: [],
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB — generous for a phone-camera receipt photo
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_MIME_TYPES.includes(file.mimetype));
  },
});

router.post('/upload', protect, receiptUploadRateLimit, upload.single('receipt'), uploadReceipt);

module.exports = router;
