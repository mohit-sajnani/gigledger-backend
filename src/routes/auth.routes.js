const express = require('express');
const { body, validationResult } = require('express-validator');
const { register, login, refresh } = require('../controllers/auth.controller');

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

router.post('/register', validateRegister, register);
router.post('/login', validateLogin, login);
router.post('/refresh', refresh);

module.exports = router;
