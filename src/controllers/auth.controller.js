const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');

const PASSWORD_SALT_ROUNDS = 10;

const signToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

/**
 * Creates the account and hands back the user, never the hash. Duplicate
 * emails are left for errorHandler.js to turn into a 409 (Mongo's 11000).
 */
const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);

  const user = await User.create({ name, email, passwordHash });

  res.status(201).json({
    success: true,
    data: {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
    },
    message: 'Registered',
  });
});

/**
 * One generic 401 for both "no such email" and "wrong password" — don't
 * give an attacker a way to enumerate registered accounts.
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');

  const passwordMatches = user
    ? await bcrypt.compare(password, user.passwordHash)
    : false;

  if (!user || !passwordMatches) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials',
      errors: [],
    });
  }

  res.status(200).json({
    success: true,
    data: {
      token: signToken(user._id),
      user: { _id: user._id, name: user.name, email: user.email },
    },
    message: 'Logged in',
  });
});

/**
 * Reissues an access token from a still-valid one. No refresh-token
 * store yet — this is a minimal reissue, not full rotation.
 */
const refresh = asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
      errors: [],
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.status(200).json({
      success: true,
      data: { token: signToken(decoded.userId) },
      message: 'Token refreshed',
    });
  } catch (err) {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
      errors: [],
    });
  }
});

module.exports = { register, login, refresh };
