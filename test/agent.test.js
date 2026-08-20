const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';

const AgentTask = require('../src/models/AgentTask');
const Transaction = require('../src/models/Transaction');
const Category = require('../src/models/Category');
const AuditLog = require('../src/models/AuditLog');
const llm = require('../src/config/gemini');
const agentRoutes = require('../src/routes/agent.routes');

/** Minimal app: just the agent routes, no db.js/app.js dependency. */
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentRoutes);
  return app;
};

const authHeader = (userId) => `Bearer ${jwt.sign({ userId: userId.toString() }, process.env.JWT_SECRET)}`;

/** A fake mongoose session whose lifecycle methods are no-ops, so
 * approve-flow tests never touch a real MongoDB deployment. */
const fakeSession = () => ({
  startTransaction() {},
  commitTransaction: async function commitTransaction() {},
  abortTransaction: async function abortTransaction() {},
  endSession() {},
});

/** A findOne-style mock result that is both awaitable and chainable with
 * .session(), matching how agent.service.js queries inside a transaction. */
const chainable = (value) => {
  const promise = Promise.resolve(value);
  promise.session = () => promise;
  return promise;
};

test('POST /api/agent/run rejects a request with no Authorization header', async () => {
  const app = buildApp();
  const res = await request(app).post('/api/agent/run');
  assert.equal(res.status, 401);
});

test('POST /api/agent/run returns an empty result when there are no pending transactions', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  Transaction.find = () => ({ sort: () => ({ limit: async () => [] }) });

  const res = await request(app).post('/api/agent/run').set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, { tasks: [], count: 0 });
  assert.equal(res.body.message, 'Nothing to process');
});

test('POST /api/agent/run degrades gracefully when the LLM call fails, never a 500', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const txn = { _id: new mongoose.Types.ObjectId(), amount: 500, date: new Date(), rawDescription: 'Trip', source: 'uber' };

  Transaction.find = () => ({ sort: () => ({ limit: async () => [txn] }) });
  AgentTask.find = () => ({ distinct: async () => [] });
  Category.find = async () => [];
  llm.chatJSON = async () => {
    throw new Error('simulated OpenAI outage');
  };

  const res = await request(app).post('/api/agent/run').set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.tasks, []);
});

test('POST /api/agent/run skips a transaction that already has an unresolved proposal (dedup guard)', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const txnId = new mongoose.Types.ObjectId();
  const txn = { _id: txnId, amount: 500, date: new Date(), rawDescription: 'Trip', source: 'uber' };

  Transaction.find = () => ({ sort: () => ({ limit: async () => [txn] }) });
  AgentTask.find = () => ({ distinct: async () => [txnId] }); // already proposed

  const res = await request(app).post('/api/agent/run').set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.tasks, []);
  assert.equal(res.body.message, 'Nothing to process');
});

test('POST /api/agent/run drops an LLM proposal that references a category never offered to it', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const txnId = new mongoose.Types.ObjectId();
  const realCategoryId = new mongoose.Types.ObjectId().toString();
  const hallucinatedCategoryId = new mongoose.Types.ObjectId().toString();
  const txn = { _id: txnId, amount: 500, date: new Date(), rawDescription: 'Trip', source: 'uber' };
  const category = { _id: realCategoryId, name: 'Uber', type: 'income' };

  Transaction.find = () => ({ sort: () => ({ limit: async () => [txn] }) });
  AgentTask.find = () => ({ distinct: async () => [] });
  Category.find = async () => [category];
  llm.chatJSON = async () =>
    JSON.stringify({
      tasks: [
        {
          type: 'categorize',
          inputRefs: [txnId.toString()],
          proposedChange: { categoryId: hallucinatedCategoryId, confidence: 0.9 },
          reasoning: 'Looks like a ride payout.',
          priority: 2,
        },
      ],
    });
  let insertManyCalled = false;
  AgentTask.insertMany = async () => {
    insertManyCalled = true;
    return [];
  };

  const res = await request(app).post('/api/agent/run').set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.tasks, []);
  assert.equal(insertManyCalled, false, 'a proposal with a hallucinated categoryId must never reach insertMany');
});

test('POST /api/agent/run persists a valid LLM proposal as a proposed AgentTask', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const txnId = new mongoose.Types.ObjectId();
  const categoryId = new mongoose.Types.ObjectId().toString();
  const txn = { _id: txnId, amount: 500, date: new Date(), rawDescription: 'Trip', source: 'uber' };
  const category = { _id: categoryId, name: 'Uber', type: 'income' };

  Transaction.find = () => ({ sort: () => ({ limit: async () => [txn] }) });
  AgentTask.find = () => ({ distinct: async () => [] });
  Category.find = async () => [category];
  llm.chatJSON = async () =>
    JSON.stringify({
      tasks: [
        {
          type: 'categorize',
          inputRefs: [txnId.toString()],
          proposedChange: { categoryId, confidence: 0.92 },
          reasoning: 'Matches Uber trip payout pattern.',
          priority: 2,
        },
      ],
    });
  let insertedDocs;
  AgentTask.insertMany = async (docs) => {
    insertedDocs = docs;
    return docs.map((d, i) => ({ ...d, _id: new mongoose.Types.ObjectId() }));
  };

  const res = await request(app).post('/api/agent/run').set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  assert.equal(res.body.data.count, 1);
  assert.equal(insertedDocs.length, 1);
  assert.equal(insertedDocs[0].status, 'proposed');
  assert.equal(insertedDocs[0].proposedChange.categoryId, categoryId);
});

test('GET /api/agent/tasks defaults to status=proposed and returns the pagination envelope', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  let queriedFilter;
  AgentTask.find = (filter) => {
    queriedFilter = filter;
    return { sort: () => ({ skip: () => ({ limit: async () => [] }) }) };
  };
  AgentTask.countDocuments = async () => 0;

  const res = await request(app).get('/api/agent/tasks').set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  assert.equal(queriedFilter.status, 'proposed');
  assert.deepEqual(Object.keys(res.body.data).sort(), ['items', 'limit', 'page', 'total', 'totalPages'].sort());
});

test('PATCH /api/agent/tasks/:id/approve applies the change and writes an AuditLog inside one session', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const taskId = new mongoose.Types.ObjectId();
  const txnId = new mongoose.Types.ObjectId();
  const categoryId = new mongoose.Types.ObjectId().toString();

  const task = {
    _id: taskId,
    userId,
    status: 'proposed',
    type: 'categorize',
    inputRefs: [txnId],
    proposedChange: { categoryId, confidence: 0.8 },
  };
  const txnDoc = {
    _id: txnId,
    category: null,
    categoryConfidence: null,
    status: 'pending',
    save: async function save() {
      this.status = 'categorized';
    },
  };

  mongoose.startSession = async () => fakeSession();
  AgentTask.findOneAndUpdate = async (filter) => {
    assert.equal(filter.status, 'proposed');
    return task;
  };
  Transaction.findOne = () => chainable(txnDoc);
  let auditLogCreated;
  AuditLog.create = async (docs) => {
    auditLogCreated = docs[0];
    return [{ ...docs[0], _id: new mongoose.Types.ObjectId() }];
  };

  const res = await request(app)
    .patch(`/api/agent/tasks/${taskId}/approve`)
    .set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  assert.equal(res.body.data.transaction.status, 'categorized');
  assert.equal(auditLogCreated.actionType, 'transaction.categorize');
  assert.equal(auditLogCreated.before.status, 'pending');
  assert.equal(auditLogCreated.after.status, 'categorized');
});

test('PATCH /api/agent/tasks/:id/approve returns 409 when the task is not currently proposed', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const taskId = new mongoose.Types.ObjectId();

  mongoose.startSession = async () => fakeSession();
  AgentTask.findOneAndUpdate = async () => null; // no match — already resolved or not owned

  const res = await request(app)
    .patch(`/api/agent/tasks/${taskId}/approve`)
    .set('Authorization', authHeader(userId));

  assert.equal(res.status, 409);
});

test('PATCH /api/agent/tasks/:id/approve rolls back the AgentTask flip when applying the change fails', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const taskId = new mongoose.Types.ObjectId();

  const task = {
    _id: taskId,
    userId,
    status: 'proposed',
    type: 'categorize',
    inputRefs: [new mongoose.Types.ObjectId()],
    proposedChange: { categoryId: new mongoose.Types.ObjectId().toString(), confidence: 0.5 },
  };

  let aborted = false;
  mongoose.startSession = async () => ({
    startTransaction() {},
    commitTransaction: async () => {
      throw new Error('should not commit when apply fails');
    },
    abortTransaction: async () => {
      aborted = true;
    },
    endSession() {},
  });
  AgentTask.findOneAndUpdate = async () => task;
  Transaction.findOne = () => chainable(null); // referenced transaction no longer exists -> applyApprovedTask throws

  const res = await request(app)
    .patch(`/api/agent/tasks/${taskId}/approve`)
    .set('Authorization', authHeader(userId));

  assert.equal(res.status, 500);
  assert.equal(aborted, true);
});

test('PATCH /api/agent/tasks/:id/reject marks the task rejected and never touches Transaction', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId();
  const taskId = new mongoose.Types.ObjectId();

  AgentTask.findOneAndUpdate = async (filter, update) => {
    assert.equal(update.status, 'rejected');
    return { _id: taskId, status: 'rejected' };
  };
  let transactionTouched = false;
  Transaction.findOne = () => {
    transactionTouched = true;
    return chainable(null);
  };

  const res = await request(app)
    .patch(`/api/agent/tasks/${taskId}/reject`)
    .set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'rejected');
  assert.equal(transactionTouched, false);
});

test('AuditLog is append-only — updateOne, deleteOne, and replaceOne all throw', async () => {
  // Exercises the pre-hooks directly against the schema — no DB connection
  // needed, since Mongoose runs pre-hooks before dispatching to the driver.
  await assert.rejects(() => AuditLog.updateOne({}, {}).exec(), /append-only/);
  await assert.rejects(() => AuditLog.deleteOne({}).exec(), /append-only/);
  await assert.rejects(() => AuditLog.replaceOne({}, {}).exec(), /append-only/);
});
