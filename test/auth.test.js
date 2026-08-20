const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

const User = require('../src/models/User');
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
