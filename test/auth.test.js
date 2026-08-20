const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

const User = require('../src/models/User');
const OtpSession = require('../src/models/OtpSession');
const mailer = require('../src/services/mailer.service');
const authRoutes = require('../src/routes/auth.routes');
const { protect } = require('../src/middleware/auth.middleware');

/** Minimal app: just the auth routes, no db.js/app.js dependency. */
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.get('/api/protected', protect, (req, res) => {
    res.status(200).json({ success: true, data: { userId: req.userId }, message: '' });
  });
  return app;
};

const fakeSession = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  userId: new mongoose.Types.ObjectId(),
  purpose: 'register',
  used: false,
  attempts: 0,
  expiresAt: new Date(Date.now() + 60_000),
  save: async function save() {},
  ...overrides,
});

test('POST /api/auth/register creates an unverified user and emails a code', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const sessionId = new mongoose.Types.ObjectId();
  let createdUser;
  let createdSession;
  let mailedTo;
  let mailedPurpose;

  User.findOne = async () => null;
  User.create = async (doc) => {
    createdUser = { _id: userId, createdAt: new Date(), ...doc };
    return createdUser;
  };
  OtpSession.create = async (doc) => {
    createdSession = { _id: sessionId, ...doc };
    return createdSession;
  };
  mailer.sendOtpEmail = async (toEmail, code, purpose) => {
    mailedTo = toEmail;
    mailedPurpose = purpose;
  };

  const res = await request(app)
    .post('/api/auth/register')
    .send({ firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com' });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.pendingSessionId, sessionId.toString());
  assert.equal(res.body.data.token, undefined);
  assert.equal(createdUser.emailVerified, false);
  assert.equal(createdUser.passwordHash, undefined);
  assert.equal(mailedTo, 'asha@example.com');
  assert.equal(mailedPurpose, 'register');
  assert.equal(createdSession.purpose, 'register');
});

test('POST /api/auth/register rejects a request with no password field required, but does reject a bad name', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/api/auth/register')
    .send({ firstName: 'A', lastName: 'Rao', email: 'asha@example.com' });

  assert.equal(res.status, 400);
});

test('POST /api/auth/register rejects a duplicate email with 409', async () => {
  const app = buildApp();
  User.findOne = async () => ({ _id: new mongoose.Types.ObjectId(), email: 'asha@example.com' });

  const res = await request(app)
    .post('/api/auth/register')
    .send({ firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com' });

  assert.equal(res.status, 409);
});

test('POST /api/auth/register/verify activates the account and issues a token', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const codeHash = await bcrypt.hash('123456', 10);
  const session = fakeSession({ userId, purpose: 'register', codeHash });
  OtpSession.findOne = async () => session;
  User.findByIdAndUpdate = async (id, update) => ({
    _id: id,
    firstName: 'Asha',
    lastName: 'Rao',
    email: 'asha@example.com',
    ...update,
  });

  const res = await request(app)
    .post('/api/auth/register/verify')
    .send({ pendingSessionId: session._id.toString(), code: '123456' });

  assert.equal(res.status, 200);
  assert.ok(res.body.data.token);
  assert.equal(res.body.data.user.email, 'asha@example.com');
  assert.equal(session.used, true);
});

test('POST /api/auth/register/verify rejects a wrong code with a generic 401', async () => {
  const app = buildApp();
  const codeHash = await bcrypt.hash('123456', 10);
  const session = fakeSession({ purpose: 'register', codeHash });
  OtpSession.findOne = async () => session;

  const res = await request(app)
    .post('/api/auth/register/verify')
    .send({ pendingSessionId: session._id.toString(), code: '000000' });

  assert.equal(res.status, 401);
  assert.equal(res.body.message, 'Invalid or expired code');
});

test('POST /api/auth/login returns the same response shape for an unknown email (no user created)', async () => {
  const app = buildApp();
  User.findOne = async () => null;
  let mailed = false;
  mailer.sendOtpEmail = async () => {
    mailed = true;
  };

  const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com' });

  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'If an account exists for that email, a code has been sent');
  assert.ok(res.body.data.pendingSessionId);
  assert.equal(mailed, false);
});

test('POST /api/auth/login returns the same response shape for an unverified email (no code sent)', async () => {
  const app = buildApp();
  User.findOne = async () => ({
    _id: new mongoose.Types.ObjectId(),
    email: 'asha@example.com',
    emailVerified: false,
  });
  let mailed = false;
  mailer.sendOtpEmail = async () => {
    mailed = true;
  };

  const res = await request(app).post('/api/auth/login').send({ email: 'asha@example.com' });

  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'If an account exists for that email, a code has been sent');
  assert.ok(res.body.data.pendingSessionId);
  assert.equal(mailed, false);
});

test('POST /api/auth/login sends a code for a verified email', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const sessionId = new mongoose.Types.ObjectId();
  User.findOne = async () => ({ _id: userId, email: 'asha@example.com', emailVerified: true });
  OtpSession.create = async (doc) => ({ _id: sessionId, ...doc });
  let mailedPurpose;
  mailer.sendOtpEmail = async (toEmail, code, purpose) => {
    mailedPurpose = purpose;
  };

  const res = await request(app).post('/api/auth/login').send({ email: 'asha@example.com' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.pendingSessionId, sessionId.toString());
  assert.equal(mailedPurpose, 'login');
});

test('POST /api/auth/login/verify issues a token for a correct, unused, unexpired code', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const codeHash = await bcrypt.hash('654321', 10);
  const session = fakeSession({ userId, purpose: 'login', codeHash });
  OtpSession.findOne = async () => session;
  User.findById = async () => ({
    _id: userId,
    firstName: 'Asha',
    lastName: 'Rao',
    email: 'asha@example.com',
  });

  const res = await request(app)
    .post('/api/auth/login/verify')
    .send({ pendingSessionId: session._id.toString(), code: '654321' });

  assert.equal(res.status, 200);
  assert.ok(res.body.data.token);
  assert.equal(session.used, true);
});

test('POST /api/auth/login/verify locks the session after too many wrong guesses', async () => {
  const app = buildApp();
  const codeHash = await bcrypt.hash('654321', 10);
  const session = fakeSession({ purpose: 'login', codeHash, attempts: 4 });
  OtpSession.findOne = async () => session;

  const res = await request(app)
    .post('/api/auth/login/verify')
    .send({ pendingSessionId: session._id.toString(), code: '000000' });

  assert.equal(res.status, 401);
  assert.equal(session.attempts, 5);
  assert.equal(session.used, true);
});

test('a register-purpose code cannot be redeemed at /login/verify', async () => {
  const app = buildApp();
  const codeHash = await bcrypt.hash('111111', 10);
  // OtpSession.findOne is purpose-filtered in the real model; a mock that
  // honours the filter proves the controller actually passes it through.
  OtpSession.findOne = async (query) => {
    // The real query is { _id, purpose: 'login' }; the stored session is
    // purpose: 'register', so a real DB filter would never match it.
    if (query.purpose === 'login') return null;
    return fakeSession({ purpose: 'register', codeHash });
  };

  const res = await request(app).post('/api/auth/login/verify').send({
    pendingSessionId: new mongoose.Types.ObjectId().toString(),
    code: '111111',
  });

  assert.equal(res.status, 401);
});

test('protect rejects requests with no Authorization header', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/protected');
  assert.equal(res.status, 401);
});

test('protect attaches req.userId for a valid token', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId().toString();
  const token = jwt.sign({ userId }, process.env.JWT_SECRET);

  const res = await request(app)
    .get('/api/protected')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.userId, userId);
});
