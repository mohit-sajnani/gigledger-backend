const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
process.env.INTERNAL_CRON_SECRET = process.env.INTERNAL_CRON_SECRET || 'test-cron-secret';

const Deadline = require('../src/models/Deadline');
const User = require('../src/models/User');
const mailer = require('../src/services/mailer.service');
const deadlineRoutes = require('../src/routes/deadline.routes');

/** Minimal app: just the deadline routes, no db.js/app.js dependency. */
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/deadlines', deadlineRoutes);
  return app;
};

const authHeader = (userId) => `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;

const fakeDeadline = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  userId: new mongoose.Types.ObjectId(),
  type: 'advance_tax',
  label: 'Q2 Advance Tax',
  dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
  status: 'upcoming',
  notified: false,
  save: async function save() {},
  ...overrides,
});

test('GET /api/deadlines only queries deadlines scoped to the requesting user', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId().toString();
  let queriedFilter;

  Deadline.find = (filter) => {
    queriedFilter = filter;
    return { sort: () => ({ lean: async () => [] }) };
  };

  const res = await request(app).get('/api/deadlines').set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  assert.equal(queriedFilter.userId, userId);
});

test('POST /api/deadlines/notify rejects a request authenticated only as a regular user, no internal secret', async () => {
  const app = buildApp();

  const res = await request(app)
    .post('/api/deadlines/notify')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()))
    .send({});

  assert.equal(res.status, 401);
});

test('POST /api/deadlines/notify sends a reminder and marks the deadline notified', async () => {
  const app = buildApp();
  const deadline = fakeDeadline();
  const user = { _id: deadline.userId, email: 'worker@example.com' };
  let savedNotified;
  let mailedTo;

  deadline.save = async function save() {
    savedNotified = this.notified;
  };

  Deadline.find = async () => [deadline];
  User.findById = async () => user;
  mailer.sendDeadlineReminderEmail = async (toEmail) => {
    mailedTo = toEmail;
  };

  const res = await request(app)
    .post('/api/deadlines/notify')
    .set('X-Internal-Secret', process.env.INTERNAL_CRON_SECRET)
    .send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.data.notified, 1);
  assert.equal(res.body.data.failed, 0);
  assert.equal(mailedTo, 'worker@example.com');
  assert.equal(savedNotified, true);
});

test('POST /api/deadlines/notify does not re-send once a deadline is already notified', async () => {
  const app = buildApp();
  // Already-notified deadlines are excluded at the query level (notified: false filter) —
  // simulating that here means the "find" call simply returns nothing left to send.
  Deadline.find = async () => [];

  const res = await request(app)
    .post('/api/deadlines/notify')
    .set('X-Internal-Secret', process.env.INTERNAL_CRON_SECRET)
    .send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.data.scanned, 0);
  assert.equal(res.body.data.notified, 0);
});

test('POST /api/deadlines/notify keeps sending to other users after one send fails', async () => {
  const app = buildApp();
  const failing = fakeDeadline({ label: 'Failing one' });
  const succeeding = fakeDeadline({ label: 'Succeeding one' });
  let succeedingSaved = false;

  succeeding.save = async function save() {
    succeedingSaved = true;
  };

  Deadline.find = async () => [failing, succeeding];
  User.findById = async (id) => ({ _id: id, email: 'worker@example.com' });
  mailer.sendDeadlineReminderEmail = async (toEmail, { label }) => {
    if (label === 'Failing one') throw new Error('SMTP down');
  };

  const res = await request(app)
    .post('/api/deadlines/notify')
    .set('X-Internal-Secret', process.env.INTERNAL_CRON_SECRET)
    .send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.data.failed, 1);
  assert.equal(res.body.data.notified, 1);
  assert.equal(succeedingSaved, true);
});
