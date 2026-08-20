const express = require('express');
const { body, validationResult } = require('express-validator');
const {
  register,
  verifyRegistration,
  login,
  verifyLogin,
  refresh,
} = require('../controllers/auth.controller');

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

const otpCodeValidator = () =>
  body('code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('code must be a 6-digit number');

const pendingSessionIdValidator = () =>
  body('pendingSessionId').isMongoId().withMessage('pendingSessionId must be a valid id');

const validateRegister = [
  body('firstName').trim().isLength({ min: 2 }).withMessage('First name must be at least 2 characters'),
  body('lastName').trim().isLength({ min: 2 }).withMessage('Last name must be at least 2 characters'),
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  runValidation,
];

const validateRegisterVerify = [pendingSessionIdValidator(), otpCodeValidator(), runValidation];

const validateLogin = [
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  runValidation,
];

const validateLoginVerify = [pendingSessionIdValidator(), otpCodeValidator(), runValidation];

router.post('/register', validateRegister, register);
router.post('/register/verify', validateRegisterVerify, verifyRegistration);
router.post('/login', validateLogin, login);
router.post('/login/verify', validateLoginVerify, verifyLogin);
router.post('/refresh', refresh);

module.exports = router;
