const express = require('express');
const multer = require('multer');
const { protect } = require('../middleware/auth.middleware');
const { uploadReceipt } = require('../controllers/receipt.controller');

const router = express.Router();

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Silently drops the file (no thrown error) rather than rejecting —
    // the controller checks req.file itself for this case.
    cb(null, ALLOWED_MIMETYPES.includes(file.mimetype));
  },
});

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
    next();
  });
};

router.post('/upload', protect, handleUpload, uploadReceipt);

module.exports = router;
