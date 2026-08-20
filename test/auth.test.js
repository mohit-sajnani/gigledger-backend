const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
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

test('POST /api/auth/register creates a user and hides the password hash', async () => {
  const app = buildApp();
  let created;
  User.create = async (doc) => {
    created = { _id: new mongoose.Types.ObjectId(), createdAt: new Date(), ...doc };
    return created;
  };

  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Asha Rao', email: 'asha@example.com', password: 'longenough' });

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.user.email, 'asha@example.com');
  assert.equal(res.body.data.user.passwordHash, undefined);
});

test('POST /api/auth/register rejects a short password', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Asha Rao', email: 'asha@example.com', password: 'short' });

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('POST /api/auth/login rejects a wrong password with a generic 401', async () => {
  const app = buildApp();
  const bcrypt = require('bcryptjs');
  User.findOne = () => ({
    select: async () => ({
      _id: new mongoose.Types.ObjectId(),
      name: 'Asha Rao',
      email: 'asha@example.com',
      passwordHash: await bcrypt.hash('correct-password', 10),
    }),
  });

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'asha@example.com', password: 'wrong-password' });

  assert.equal(res.status, 401);
  assert.equal(res.body.message, 'Invalid credentials');
});

test('POST /api/auth/login issues a token immediately when 2FA is off (unchanged behaviour)', async () => {
  const app = buildApp();
  const bcrypt = require('bcryptjs');
  const userId = new mongoose.Types.ObjectId();
  User.findOne = () => ({
    select: async () => ({
      _id: userId,
      name: 'Asha Rao',
      email: 'asha@example.com',
      passwordHash: await bcrypt.hash('correct-password', 10),
      twoFactorEnabled: false,
    }),
  });

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'asha@example.com', password: 'correct-password' });

  assert.equal(res.status, 200);
  assert.ok(res.body.data.token);
  assert.equal(res.body.data.user.email, 'asha@example.com');
});

test('POST /api/auth/login withholds the token and emails a code when 2FA is on', async () => {
  const app = buildApp();
  const bcrypt = require('bcryptjs');
  const userId = new mongoose.Types.ObjectId();
  const otpSessionId = new mongoose.Types.ObjectId();
  let mailedTo;
  let mailedCode;

  User.findOne = () => ({
    select: async () => ({
      _id: userId,
      name: 'Asha Rao',
      email: 'asha@example.com',
      passwordHash: await bcrypt.hash('correct-password', 10),
      twoFactorEnabled: true,
    }),
  });
  OtpSession.create = async (doc) => ({ _id: otpSessionId, ...doc });
  mailer.sendOtpEmail = async (toEmail, code) => {
    mailedTo = toEmail;
    mailedCode = code;
  };

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'asha@example.com', password: 'correct-password' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.pendingSessionId, otpSessionId.toString());
  assert.equal(res.body.data.twoFactorRequired, true);
  assert.equal(res.body.data.token, undefined);
  assert.equal(mailedTo, 'asha@example.com');
  assert.match(mailedCode, /^\d{6}$/);
});

test('PATCH /api/auth/2fa requires authentication', async () => {
  const app = buildApp();
  const res = await request(app).patch('/api/auth/2fa').send({ enabled: true });
  assert.equal(res.status, 401);
});

test('PATCH /api/auth/2fa updates the caller\'s own account', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId().toString();
  const token = jwt.sign({ userId }, process.env.JWT_SECRET);
  let updatedId;
  let updatedDoc;
  User.findByIdAndUpdate = async (id, doc) => {
    updatedId = id;
    updatedDoc = doc;
  };

  const res = await request(app)
    .patch('/api/auth/2fa')
    .set('Authorization', `Bearer ${token}`)
    .send({ enabled: true });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.twoFactorEnabled, true);
  assert.equal(updatedId, userId);
  assert.equal(updatedDoc.twoFactorEnabled, true);
});

test('POST /api/auth/2fa/verify issues a token for a correct, unused, unexpired code', async () => {
  const app = buildApp();
  const bcrypt = require('bcryptjs');
  const userId = new mongoose.Types.ObjectId();
  const sessionId = new mongoose.Types.ObjectId();
  const codeHash = await bcrypt.hash('123456', 10);
  const session = {
    _id: sessionId,
    userId,
    codeHash,
    used: false,
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
    save: async function save() {},
  };
  OtpSession.findById = async () => session;
  User.findById = async () => ({ _id: userId, name: 'Asha Rao', email: 'asha@example.com' });

  const res = await request(app)
    .post('/api/auth/2fa/verify')
    .send({ pendingSessionId: sessionId.toString(), code: '123456' });

  assert.equal(res.status, 200);
  assert.ok(res.body.data.token);
  assert.equal(session.used, true);
});

test('POST /api/auth/2fa/verify rejects a wrong code with a generic 401', async () => {
  const app = buildApp();
  const bcrypt = require('bcryptjs');
  const sessionId = new mongoose.Types.ObjectId();
  OtpSession.findById = async () => ({
    _id: sessionId,
    userId: new mongoose.Types.ObjectId(),
    codeHash: await bcrypt.hash('123456', 10),
    used: false,
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
    save: async function save() {},
  });

  const res = await request(app)
    .post('/api/auth/2fa/verify')
    .send({ pendingSessionId: sessionId.toString(), code: '000000' });

  assert.equal(res.status, 401);
  assert.equal(res.body.message, 'Invalid or expired code');
});

test('POST /api/auth/2fa/verify rejects even the correct code once attempts are exhausted', async () => {
  const app = buildApp();
  const bcrypt = require('bcryptjs');
  const sessionId = new mongoose.Types.ObjectId();
  const session = {
    _id: sessionId,
    userId: new mongoose.Types.ObjectId(),
    codeHash: await bcrypt.hash('123456', 10),
    used: false,
    attempts: 5,
    expiresAt: new Date(Date.now() + 60_000),
    save: async function save() {},
  };
  OtpSession.findById = async () => session;

  const res = await request(app)
    .post('/api/auth/2fa/verify')
    .send({ pendingSessionId: sessionId.toString(), code: '123456' });

  assert.equal(res.status, 401);
});

test('POST /api/auth/2fa/verify locks the session out on the 5th wrong guess', async () => {
  const app = buildApp();
  const bcrypt = require('bcryptjs');
  const sessionId = new mongoose.Types.ObjectId();
  const session = {
    _id: sessionId,
    userId: new mongoose.Types.ObjectId(),
    codeHash: await bcrypt.hash('123456', 10),
    used: false,
    attempts: 4,
    expiresAt: new Date(Date.now() + 60_000),
    save: async function save() {},
  };
  OtpSession.findById = async () => session;

  const res = await request(app)
    .post('/api/auth/2fa/verify')
    .send({ pendingSessionId: sessionId.toString(), code: '000000' });

  assert.equal(res.status, 401);
  assert.equal(session.attempts, 5);
  assert.equal(session.used, true);
});

test('POST /api/auth/2fa/verify rejects an already-used code', async () => {
  const app = buildApp();
  const bcrypt = require('bcryptjs');
  const sessionId = new mongoose.Types.ObjectId();
  OtpSession.findById = async () => ({
    _id: sessionId,
    userId: new mongoose.Types.ObjectId(),
    codeHash: await bcrypt.hash('123456', 10),
    used: true,
    expiresAt: new Date(Date.now() + 60_000),
    save: async function save() {},
  });

  const res = await request(app)
    .post('/api/auth/2fa/verify')
    .send({ pendingSessionId: sessionId.toString(), code: '123456' });

  assert.equal(res.status, 401);
  assert.equal(res.body.message, 'Invalid or expired code');
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
