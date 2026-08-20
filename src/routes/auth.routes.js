const express = require('express');
const { body, validationResult } = require('express-validator');
const {
  register,
  login,
  refresh,
  toggleTwoFactor,
  verifyTwoFactor,
} = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

/** Turns express-validator's error bag into the shared error envelope. */
const runValidation = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: result.array().map((err) => ({ field: err.path, message: err.msg })),
  });
};

const validateRegister = [
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  runValidation,
];

const validateLogin = [
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
  runValidation,
];

const validateToggleTwoFactor = [
  body('enabled').isBoolean().withMessage('enabled must be a boolean'),
  runValidation,
];

const validateVerifyTwoFactor = [
  body('pendingSessionId').isMongoId().withMessage('pendingSessionId must be a valid id'),
  body('code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('code must be a 6-digit number'),
  runValidation,
];

router.post('/register', validateRegister, register);
router.post('/login', validateLogin, login);
router.post('/refresh', refresh);
router.patch('/2fa', protect, validateToggleTwoFactor, toggleTwoFactor);
router.post('/2fa/verify', validateVerifyTwoFactor, verifyTwoFactor);

module.exports = router;
