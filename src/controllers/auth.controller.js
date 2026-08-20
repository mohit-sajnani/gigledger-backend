const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OtpSession = require('../models/OtpSession');
const asyncHandler = require('../utils/asyncHandler');
const mailer = require('../services/mailer.service');

const PASSWORD_SALT_ROUNDS = 10;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const INVALID_OTP_RESPONSE = {
  success: false,
  message: 'Invalid or expired code',
  errors: [],
};

// Fixed hash to compare against when no user is found, so a login attempt
// for a non-existent email takes the same time as a wrong password —
// closes the timing side-channel that would otherwise leak account existence.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-password', PASSWORD_SALT_ROUNDS);

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
  const passwordMatches = await bcrypt.compare(
    password,
    user ? user.passwordHash : DUMMY_PASSWORD_HASH
  );

  if (!user || !passwordMatches) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials',
      errors: [],
    });
  }

  // Password checked out, but 2FA users don't get a token yet — they get
  // an emailed code and a pending session to redeem it against.
  if (user.twoFactorEnabled) {
    const code = crypto.randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, PASSWORD_SALT_ROUNDS);

    const otpSession = await OtpSession.create({
      userId: user._id,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    await mailer.sendOtpEmail(user.email, code);

    return res.status(200).json({
      success: true,
      data: { pendingSessionId: otpSession._id, twoFactorRequired: true },
      message: 'Enter the code sent to your email',
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
 * Lets a logged-in user turn their own 2FA on or off — never anyone
 * else's, since the target is always req.userId from the verified JWT.
 */
const toggleTwoFactor = asyncHandler(async (req, res) => {
  const { enabled } = req.body;
  await User.findByIdAndUpdate(req.userId, { twoFactorEnabled: enabled });

  res.status(200).json({
    success: true,
    data: { twoFactorEnabled: enabled },
    message: 'Two-factor authentication updated',
  });
});

/**
 * Redeems the emailed code for the real JWT. One generic 401 for every
 * failure mode (wrong code, unknown session, expired, already used) so
 * nothing here becomes a fresh enumeration vector.
 */
const verifyTwoFactor = asyncHandler(async (req, res) => {
  const { pendingSessionId, code } = req.body;
  const otpSession = await OtpSession.findById(pendingSessionId);

  const isUsable =
    otpSession &&
    !otpSession.used &&
    otpSession.expiresAt > new Date() &&
    otpSession.attempts < OTP_MAX_ATTEMPTS;

  // Always run bcrypt, even on a dead session, so response time can't be
  // used to tell "wrong code" apart from "expired/used/locked session".
  const codeMatches = await bcrypt.compare(
    code,
    isUsable ? otpSession.codeHash : DUMMY_PASSWORD_HASH
  );

  if (!isUsable || !codeMatches) {
    // Count the guess against a still-live session so repeated wrong
    // codes lock it out well before the 5-minute TTL would.
    if (otpSession && !otpSession.used && otpSession.expiresAt > new Date()) {
      otpSession.attempts += 1;
      if (otpSession.attempts >= OTP_MAX_ATTEMPTS) otpSession.used = true;
      await otpSession.save();
    }
    return res.status(401).json(INVALID_OTP_RESPONSE);
  }

  otpSession.used = true;
  await otpSession.save();

  const user = await User.findById(otpSession.userId);

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

module.exports = { register, login, refresh, toggleTwoFactor, verifyTwoFactor };
