const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const Deadline = require('../src/models/Deadline');
const AgentTask = require('../src/models/AgentTask');
const AuditLog = require('../src/models/AuditLog');
const TaxEstimate = require('../src/models/TaxEstimate');
const Transaction = require('../src/models/Transaction');
const { syncDeadlines, checkAndNotify, currentFinancialYear } = require('../src/services/deadlineAgent.service');
const { applyApprovedTask } = require('../src/services/agent.service');
const deadlineRoutes = require('../src/routes/deadline.routes');

/** Minimal app: just the deadline routes, no db.js/app.js dependency. */
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/deadlines', deadlineRoutes);
  return app;
};

const authHeader = (userId) => `Bearer ${jwt.sign({ userId: userId.toString() }, process.env.JWT_SECRET)}`;

test('currentFinancialYear crosses the Dec-Jan and Mar-Apr boundaries correctly', () => {
  assert.equal(currentFinancialYear(new Date('2026-08-21')), '2026-27');
  assert.equal(currentFinancialYear(new Date('2027-01-05')), '2026-27');
  assert.equal(currentFinancialYear(new Date('2027-03-31')), '2026-27');
  assert.equal(currentFinancialYear(new Date('2027-04-01')), '2027-28');
});

test('syncDeadlines never recomputes status for a deadline already marked completed', async () => {
  const userId = new mongoose.Types.ObjectId();
  const completedDeadline = {
    status: 'completed',
    save: async function save() {},
  };

  Deadline.findOneAndUpdate = async () => completedDeadline;
  let taxEstimateQueried = false;
  TaxEstimate.findOne = async () => {
    taxEstimateQueried = true;
    return null;
  };

  await syncDeadlines(userId);

  assert.equal(completedDeadline.status, 'completed');
  assert.equal(taxEstimateQueried, false, 'a completed deadline should skip the TaxEstimate lookup entirely');
});

test('syncDeadlines pulls estimatedAmount from the correctly-shaped TaxEstimate period string', async () => {
  const userId = new mongoose.Types.ObjectId();
  const deadlineDoc = { status: 'upcoming', save: async function save() {} };
  let queriedPeriod;

  Deadline.findOneAndUpdate = async (filter) => {
    if (filter.label === 'Q1 Advance Tax') return deadlineDoc;
    return { status: 'upcoming', save: async function save() {} };
  };
  TaxEstimate.findOne = async (filter) => {
    if (filter.period && filter.period.startsWith('Q1')) queriedPeriod = filter.period;
    return null;
  };

  await syncDeadlines(userId);

  assert.match(queriedPeriod, /^Q1-\d{4}-\d{2}$/, 'period must be built as `${quarter}-${financialYear}`, not a bare quarter');
});

test('checkAndNotify skips a deadline that already has an unresolved deadline_check task (dedup guard)', async () => {
  const userId = new mongoose.Types.ObjectId();
  const deadlineId = new mongoose.Types.ObjectId();

  Deadline.find = async () => [{ _id: deadlineId, dueDate: new Date(), estimatedAmount: 100, label: 'Q1 Advance Tax', notified: false }];
  AgentTask.exists = async () => true; // already proposed
  let createCalled = false;
  AgentTask.create = async () => {
    createCalled = true;
  };

  const created = await checkAndNotify(userId);

  assert.deepEqual(created, []);
  assert.equal(createCalled, false);
});

test('checkAndNotify proposes a deadline_check task and marks the deadline notified', async () => {
  const userId = new mongoose.Types.ObjectId();
  const deadlineId = new mongoose.Types.ObjectId();
  const deadlineDoc = {
    _id: deadlineId,
    dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    estimatedAmount: 4200,
    label: 'Q2 Advance Tax',
    notified: false,
    save: async function save() {
      this.notified = true;
    },
  };

  Deadline.find = async () => [deadlineDoc];
  AgentTask.exists = async () => false;
  let insertedTask;
  AgentTask.create = async (doc) => {
    insertedTask = doc;
    return { ...doc, _id: new mongoose.Types.ObjectId() };
  };

  const created = await checkAndNotify(userId);

  assert.equal(created.length, 1);
  assert.equal(insertedTask.type, 'deadline_check');
  assert.deepEqual(insertedTask.inputRefs, []);
  assert.equal(insertedTask.proposedChange.deadlineId, deadlineId);
  assert.match(insertedTask.reasoning, /Q2 Advance Tax/);
  assert.equal(deadlineDoc.notified, true);
});

test('applyApprovedTask resolves a deadline_check task via AuditLog without touching any Transaction', async () => {
  const userId = new mongoose.Types.ObjectId();
  const taskId = new mongoose.Types.ObjectId();
  const deadlineId = new mongoose.Types.ObjectId();

  const task = {
    _id: taskId,
    userId,
    status: 'proposed',
    type: 'deadline_check',
    inputRefs: [],
    proposedChange: { deadlineId, action: 'acknowledge' },
  };

  let auditLogCreated;
  let transactionQueried = false;
  Deadline.findOne = () => ({ session: () => Promise.resolve({ _id: deadlineId, userId }) });
  AuditLog.create = async (docs) => {
    auditLogCreated = docs[0];
    return [{ ...docs[0], _id: new mongoose.Types.ObjectId() }];
  };
  Transaction.findOne = () => {
    transactionQueried = true;
    return { session: () => Promise.resolve(null) };
  };

  const result = await applyApprovedTask(task, {});

  assert.equal(result.transaction, null);
  assert.equal(auditLogCreated.actionType, 'deadline.acknowledge');
  assert.equal(auditLogCreated.targetModel, 'Deadline');
  assert.equal(auditLogCreated.targetId, deadlineId);
  assert.equal(transactionQueried, false, 'a deadline_check approval must never query Transaction');
});

test('applyApprovedTask rejects a deadline_check task whose Deadline no longer exists', async () => {
  const userId = new mongoose.Types.ObjectId();
  const taskId = new mongoose.Types.ObjectId();
  const deadlineId = new mongoose.Types.ObjectId();

  const task = {
    _id: taskId,
    userId,
    status: 'proposed',
    type: 'deadline_check',
    inputRefs: [],
    proposedChange: { deadlineId, action: 'acknowledge' },
  };

  Deadline.findOne = () => ({ session: () => Promise.resolve(null) });
  let auditLogCreated = false;
  AuditLog.create = async () => {
    auditLogCreated = true;
    return [{}];
  };

  await assert.rejects(() => applyApprovedTask(task, {}), /Deadline referenced by this task no longer exists/);
  assert.equal(auditLogCreated, false, 'no AuditLog should be written when the Deadline is gone');
});

test('GET /api/deadlines/:id returns 404 for a non-owned or nonexistent deadline', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const deadlineId = new mongoose.Types.ObjectId();

  Deadline.findOne = async () => null;

  const res = await request(app).get(`/api/deadlines/${deadlineId}`).set('Authorization', authHeader(userId));

  assert.equal(res.status, 404);
});

test('PATCH /api/deadlines/:id/complete returns 409 when already completed or not found', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const deadlineId = new mongoose.Types.ObjectId();

  Deadline.findOneAndUpdate = async () => null;

  const res = await request(app)
    .patch(`/api/deadlines/${deadlineId}/complete`)
    .set('Authorization', authHeader(userId));

  assert.equal(res.status, 409);
});

test('PATCH /api/deadlines/:id/complete marks a deadline completed', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const deadlineId = new mongoose.Types.ObjectId();

  Deadline.findOneAndUpdate = async () => ({ _id: deadlineId, status: 'completed' });

  const res = await request(app)
    .patch(`/api/deadlines/${deadlineId}/complete`)
    .set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'completed');
});

test('GET /api/deadlines rejects a request with no Authorization header', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/deadlines');
  assert.equal(res.status, 401);
});
