const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

const Transaction = require('../src/models/Transaction');
const TaxEstimate = require('../src/models/TaxEstimate');
const dashboardRoutes = require('../src/routes/dashboard.routes');

/** Minimal app: just the dashboard routes, no db.js/app.js dependency. */
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/dashboard', dashboardRoutes);
  return app;
};

const authHeader = (userId) => `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;

test.afterEach(() => {
  // node:test doesn't auto-restore stubbed methods between tests, so each
  // test that stubs a model method must be independent of leftover state.
});

test('GET /api/dashboard/summary requires auth', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/dashboard/summary');
  assert.equal(res.status, 401);
});

test('GET /api/dashboard/summary computes correct totals for the requested month', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId().toString();
  const seenFilters = [];

  Transaction.aggregate = async (pipeline) => {
    seenFilters.push(pipeline[0].$match);
    return pipeline[0].$match.type === 'income' ? [{ _id: null, total: 48500 }] : [{ _id: null, total: 12300 }];
  };
  Transaction.countDocuments = async (filter) => (filter.status === 'pending' ? 7 : 23);

  const res = await request(app).get('/api/dashboard/summary?month=2024-08').set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, {
    period: '2024-08',
    totalIncome: 48500,
    totalExpenses: 12300,
    netIncome: 36200,
    pendingTransactions: 7,
    categorizedTransactions: 23,
  });
  assert.ok(seenFilters.every((f) => f.userId.toString() === userId && f.deleted === false));
});

test('GET /api/dashboard/summary rejects a malformed month with a 400', async () => {
  const app = buildApp();
  const res = await request(app)
    .get('/api/dashboard/summary?month=not-a-month')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 400);
});

test('GET /api/dashboard/income-by-source scopes the aggregation to the requesting user only', async () => {
  const app = buildApp();
  const userA = new mongoose.Types.ObjectId().toString();
  let capturedMatch;

  Transaction.aggregate = async (pipeline) => {
    capturedMatch = pipeline[0].$match;
    return [
      { _id: 'uber', total: 22000, count: 18 },
      { _id: 'swiggy', total: 18500, count: 24 },
      { _id: 'manual', total: 8000, count: 4 },
    ];
  };

  const res = await request(app)
    .get('/api/dashboard/income-by-source?month=2024-08')
    .set('Authorization', authHeader(userA));

  assert.equal(res.status, 200);
  assert.equal(capturedMatch.userId.toString(), userA);
  assert.ok(capturedMatch.userId instanceof mongoose.Types.ObjectId, '$match.userId must be a real ObjectId, not a raw string — aggregate() pipelines are not auto-cast by Mongoose the way find()/countDocuments() are');
  assert.equal(res.body.data.breakdown[0].percentage, 45.4);
  assert.equal(res.body.data.breakdown.length, 3);
});

test('GET /api/dashboard/income-by-source returns an empty breakdown for a month with no income', async () => {
  const app = buildApp();
  Transaction.aggregate = async () => [];

  const res = await request(app)
    .get('/api/dashboard/income-by-source?month=2024-08')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.breakdown, []);
});

test('GET /api/dashboard/expense-by-category joins Category and buckets an uncategorized transaction', async () => {
  const app = buildApp();

  Transaction.aggregate = async () => [
    { _id: 'cat1', total: 5200, count: 3, categoryDoc: [{ name: 'Fuel', taxDeductible: true }] },
    { _id: null, total: 3000, count: 2, categoryDoc: [] },
  ];

  const res = await request(app)
    .get('/api/dashboard/expense-by-category?month=2024-08')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 200);
  const [fuel, uncategorized] = res.body.data.breakdown;
  assert.equal(fuel.categoryName, 'Fuel');
  assert.equal(fuel.taxDeductible, true);
  assert.equal(uncategorized.categoryName, 'Uncategorized');
  assert.equal(uncategorized.taxDeductible, false);
});

test('GET /api/dashboard/monthly-trend returns exactly N parallel-array entries, zero-filling months with no data', async () => {
  const app = buildApp();
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1; // 1-indexed, matches $month

  Transaction.aggregate = async () => [
    { _id: { year: currentYear, month: currentMonth, type: 'income' }, total: 48500 },
  ];

  const res = await request(app)
    .get('/api/dashboard/monthly-trend?months=3')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 200);
  assert.equal(res.body.data.months.length, 3);
  assert.equal(res.body.data.income.length, 3);
  assert.equal(res.body.data.expenses.length, 3);
  assert.equal(res.body.data.net.length, 3);
  assert.equal(res.body.data.income[2], 48500);
  assert.equal(res.body.data.expenses[2], 0);
  assert.equal(res.body.data.net[0], 0);
});

test('GET /api/dashboard/monthly-trend rejects a malformed months value with a 400', async () => {
  const app = buildApp();
  const res = await request(app)
    .get('/api/dashboard/monthly-trend?months=abc')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 400);
});

test('GET /api/dashboard/tax-savings splits deductible vs non-deductible and falls back to the 5% stub with no TaxEstimate', async () => {
  const app = buildApp();

  Transaction.find = () => ({
    populate: () => ({
      lean: async () => [
        { amount: 35000, category: { name: 'Fuel', taxDeductible: true } },
        { amount: 26000, category: { name: 'Platform Commission', taxDeductible: true } },
        { amount: 34000, category: { name: 'Food', taxDeductible: false } },
      ],
    }),
  });
  TaxEstimate.findOne = () => ({ sort: () => ({ lean: async () => null }) });

  const res = await request(app)
    .get('/api/dashboard/tax-savings')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 200);
  assert.equal(res.body.data.deductibleExpenses, 61000);
  assert.equal(res.body.data.nonDeductibleExpenses, 34000);
  assert.equal(res.body.data.totalExpenses, 95000);
  assert.equal(res.body.data.estimatedTaxSaving, Math.round(61000 * 0.05));
  assert.equal(res.body.data.deductibleBreakdown.length, 2);
});

test('GET /api/dashboard/tax-savings derives the rate from the latest TaxEstimate when one exists', async () => {
  const app = buildApp();

  Transaction.find = () => ({
    populate: () => ({
      lean: async () => [{ amount: 10000, category: { name: 'Fuel', taxDeductible: true } }],
    }),
  });
  TaxEstimate.findOne = () => ({
    sort: () => ({ lean: async () => ({ estimatedTax: 20000, taxableIncome: 400000 }) }),
  });

  const res = await request(app)
    .get('/api/dashboard/tax-savings')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 200);
  assert.equal(res.body.data.estimatedTaxSaving, Math.round(10000 * (20000 / 400000)));
});
