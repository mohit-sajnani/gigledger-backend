const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const OtpSession = require('../models/OtpSession');
const asyncHandler = require('../utils/asyncHandler');
const mailer = require('../services/mailer.service');
const { hashOtpCode, compareOtpCode } = require('../utils/otpHash');

const OTP_SALT_ROUNDS = 10;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_RESENDS = 3;

const INVALID_OTP_RESPONSE = {
  success: false,
  message: 'Invalid or expired code',
  errors: [],
};

// Fixed hash to compare against when a session isn't usable, so response
// time never reveals whether a given pendingSessionId is currently live.
const DUMMY_CODE_HASH = bcrypt.hashSync('not-a-real-code', OTP_SALT_ROUNDS);

const signToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

const shapeUser = (user) => ({
  _id: user._id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
});

const createOtpSession = async ({ purpose, email, userId, firstName, lastName }) => {
  const code = crypto.randomInt(100000, 1000000).toString();
  const codeHash = await hashOtpCode(code);
  const otpSession = await OtpSession.create({
    purpose,
    email,
    userId,
    firstName,
    lastName,
    codeHash,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  return { otpSession, code };
};

/**
 * Redeems a code for a given purpose. Shared by register/verify and
 * login/verify — same usable-check, same constant-time compare, same
 * attempt-lockout; purpose keeps a registration code from verifying a
 * login (or vice versa). Returns the used session, or null on any
 * failure — caller doesn't get to know which failure it was.
 */
const redeemOtp = async (pendingSessionId, code, purpose) => {
  const otpSession = await OtpSession.findOne({ _id: pendingSessionId, purpose });

  const isUsable =
    otpSession &&
    !otpSession.used &&
    otpSession.expiresAt > new Date() &&
    otpSession.attempts < OTP_MAX_ATTEMPTS;

  const codeMatches = await compareOtpCode(
    code,
    isUsable ? otpSession.codeHash : DUMMY_CODE_HASH
  );

  if (!isUsable || !codeMatches) {
    if (otpSession && !otpSession.used && otpSession.expiresAt > new Date()) {
      otpSession.attempts += 1;
      if (otpSession.attempts >= OTP_MAX_ATTEMPTS) otpSession.used = true;
      await otpSession.save();
    }
    return null;
  }

  otpSession.used = true;
  await otpSession.save();
  return otpSession;
};

/**
 * No account is created here at all — an unverified signup that never
 * completes must not permanently occupy the email. firstName/lastName/
 * email live on the OtpSession until the code is actually redeemed.
 */
const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email } = req.body;

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: 'Email already registered',
      errors: [],
    });
  }

  const { otpSession, code } = await createOtpSession({
    purpose: 'register',
    email,
    firstName,
    lastName,
  });
  await mailer.sendOtpEmail(email, code, 'register');

  res.status(201).json({
    success: true,
    data: { pendingSessionId: otpSession._id },
    message: 'Check your email for a code to verify your account',
  });
});

/**
 * Creates the account — already verified, since it only exists once the
 * code is confirmed — and logs the user straight in. Two sessions racing
 * for the same email is handled explicitly: the loser hits the unique
 * index and gets a normal 409, not a crash.
 */
const verifyRegistration = asyncHandler(async (req, res) => {
  const { pendingSessionId, code } = req.body;
  const otpSession = await redeemOtp(pendingSessionId, code, 'register');

  if (!otpSession) {
    return res.status(401).json(INVALID_OTP_RESPONSE);
  }

  let user;
  try {
    user = await User.create({
      firstName: otpSession.firstName,
      lastName: otpSession.lastName,
      email: otpSession.email,
      emailVerified: true,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered',
        errors: [],
      });
    }
    throw err;
  }

  res.status(200).json({
    success: true,
    data: { token: signToken(user._id), user: shapeUser(user) },
    message: 'Account verified',
  });
});

/**
 * No password to fail on anymore, so the response has to be identical
 * whether the email is unknown, unverified, or verified — otherwise the
 * response itself becomes the enumeration vector. Only the verified
 * branch actually creates a session and sends mail; the others still
 * hand back a same-shaped (but dead) pendingSessionId.
 */
const login = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  let pendingSessionId = new mongoose.Types.ObjectId();

  if (user && user.emailVerified) {
    const { otpSession, code } = await createOtpSession({
      purpose: 'login',
      email: user.email,
      userId: user._id,
    });
    pendingSessionId = otpSession._id;
    await mailer.sendOtpEmail(user.email, code, 'login');
  }

  res.status(200).json({
    success: true,
    data: { pendingSessionId },
    message: 'If an account exists for that email, a code has been sent',
  });
});

/** Redeems the login code for a real JWT. */
const verifyLogin = asyncHandler(async (req, res) => {
  const { pendingSessionId, code } = req.body;
  const otpSession = await redeemOtp(pendingSessionId, code, 'login');

  if (!otpSession) {
    return res.status(401).json(INVALID_OTP_RESPONSE);
  }

  const user = await User.findById(otpSession.userId);

  res.status(200).json({
    success: true,
    data: { token: signToken(user._id), user: shapeUser(user) },
    message: 'Logged in',
  });
});

const RESEND_OTP_RESPONSE_MESSAGE = 'If that code is still valid, a new one has been sent';

/**
 * Silently no-ops on an unusable or resend-capped session instead of
 * telling the caller why — same enumeration-safe discipline as redeemOtp.
 * Never touches `attempts`: a resend isn't a guess, so it must not refresh
 * an otherwise near-exhausted brute-force budget.
 *
 * Always pays the same hashing cost on both branches (real code on the
 * resendable path, a throwaway one otherwise) so response timing can't be
 * used to tell a live pendingSessionId from a dead one — same idea as
 * redeemOtp's DUMMY_CODE_HASH compare, applied to the hash side here.
 */
const resendOtp = asyncHandler(async (req, res) => {
  const { pendingSessionId } = req.body;
  const otpSession = await OtpSession.findById(pendingSessionId);

  const isResendable =
    otpSession &&
    !otpSession.used &&
    otpSession.expiresAt > new Date() &&
    otpSession.attempts < OTP_MAX_ATTEMPTS &&
    otpSession.resendCount < OTP_MAX_RESENDS;

  const code = crypto.randomInt(100000, 1000000).toString();
  const codeHash = await hashOtpCode(code);

  if (isResendable) {
    otpSession.codeHash = codeHash;
    otpSession.expiresAt = new Date(Date.now() + OTP_TTL_MS);
    otpSession.resendCount += 1;
    await otpSession.save();
    await mailer.sendOtpEmail(otpSession.email, code, otpSession.purpose);
  }

  res.status(200).json({
    success: true,
    data: { pendingSessionId },
    message: RESEND_OTP_RESPONSE_MESSAGE,
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

module.exports = { register, verifyRegistration, login, verifyLogin, resendOtp, refresh };
