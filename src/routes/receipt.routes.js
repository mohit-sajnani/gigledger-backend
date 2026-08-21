// Receipt routes
// POST /api/receipts/upload — upload image → OCR (Gemini) → proposed expense entry
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth.middleware');
const { ALLOWED_MIME_TYPES } = require('../services/receipt.service');
const { uploadReceipt } = require('../controllers/receipt.controller');

const router = express.Router();

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Calls the same Gemini plumbing as /api/tax/estimate — slow, billed, and
 * prone to multi-minute hangs under rapid repeated calls once Google's own
 * rate limit kicks in. Unlike tax/estimate there's no cache-first fallback
 * possible here (every upload is a distinct image), so this is the primary
 * defense, not optional hardening.
 */
const receiptOcrRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.userId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many receipt uploads — please wait a moment and try again.', errors: [] },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Silently drops the file (no thrown error) rather than rejecting —
    // the controller checks req.file itself for this case.
    cb(null, ALLOWED_MIMETYPES.includes(file.mimetype));
  },
});

// Client-supplied Content-Type is just a claim — verify the actual bytes
// before trusting the file is really what it says it is.
const MAGIC_BYTES = [
  { mimetype: 'image/jpeg', signature: [0xff, 0xd8, 0xff] },
  { mimetype: 'image/png', signature: [0x89, 0x50, 0x4e, 0x47] },
];

/** WebP is RIFF....WEBP — the "WEBP" tag sits at offset 8, not the start. */
const isRealWebp = (buffer) =>
  buffer.length >= 12 &&
  buffer.toString('ascii', 0, 4) === 'RIFF' &&
  buffer.toString('ascii', 8, 12) === 'WEBP';

const matchesDeclaredFileType = (buffer, mimetype) => {
  if (mimetype === 'image/webp') return isRealWebp(buffer);
  const known = MAGIC_BYTES.find((m) => m.mimetype === mimetype);
  if (!known) return false;
  return known.signature.every((byte, i) => buffer[i] === byte);
};

/**
 * multer's own errors (e.g. file too large) arrive via a callback, not a
 * throw — wrapping it here maps that into the shared 400 envelope instead
 * of an unhandled 500, and instead of a bare "false" fileFilter rejection
 * silently falling through with no explanation.
 */
const handleUpload = (req, res, next) => {
  upload.single('receipt')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: [{ field: 'receipt', message: err.message }],
      });
    }
    if (req.file && !matchesDeclaredFileType(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: [{ field: 'receipt', message: 'File content does not match its declared type' }],
      });
    }
    next();
  });
};

router.post('/upload', protect, receiptOcrRateLimit, handleUpload, uploadReceipt);

module.exports = router;
