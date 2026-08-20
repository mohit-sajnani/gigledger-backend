const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

const TaxEstimate = require('../src/models/TaxEstimate');
const Category = require('../src/models/Category');
const Transaction = require('../src/models/Transaction');
const taxService = require('../src/services/tax.service');
const rag = require('../src/services/rag.service');
const taxRoutes = require('../src/routes/tax.routes');

/** Minimal app: just the tax routes, no db.js/app.js dependency. */
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/tax', taxRoutes);
  return app;
};

const authHeader = (userId) => `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;

test('tax.service.calculateTax clamps negative taxable income to zero tax', () => {
  const rateTable = [{ threshold: 300000, rate: 0 }, { threshold: Infinity, rate: 0.05 }];
  const result = taxService.calculateTax(-5000, rateTable);
  assert.equal(result.estimatedTax, 0);
  assert.deepEqual(result.slabBreakdown, []);
});

test('tax.service.aggregateIncomeAndDeductions uses the corrected two-step Category join, not a dot-path filter', async () => {
  const userId = new mongoose.Types.ObjectId().toString();
  let transactionFilters = [];

  Category.find = () => ({
    select: async () => [{ _id: 'catA' }, { _id: 'catB' }],
  });
  Transaction.find = (filter) => {
    transactionFilters.push(filter);
    const isIncome = filter.type === 'income';
    return { select: async () => (isIncome ? [{ amount: 1000 }] : [{ amount: 200 }, { amount: 50 }]) };
  };

  const result = await taxService.aggregateIncomeAndDeductions(userId, new Date('2024-07-01'), new Date('2024-09-30'));

  assert.equal(result.grossIncome, 1000);
  assert.equal(result.totalDeductions, 250);
  const deductionFilter = transactionFilters.find((f) => f.type === 'expense');
  assert.deepEqual(deductionFilter.category, { $in: ['catA', 'catB'] });
  assert.equal(deductionFilter['category.taxDeductible'], undefined);
});

test('GET /api/tax/estimate requires auth', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/tax/estimate?period=Q2-2024-25');
  assert.equal(res.status, 401);
});

test('GET /api/tax/estimate drops a citation the LLM invented that was never actually retrieved', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId().toString();

  taxService.aggregateIncomeAndDeductions = async () => ({ grossIncome: 500000, totalDeductions: 50000 });
  rag.searchTaxRules = async () => [{ id: 'rule_real', title: 'Real Rule', source_url: 'https://example.com' }];
  rag.generateJSONContent = async () =>
    JSON.stringify({
      citedRules: [
        { ruleId: 'rule_real', title: 'Real Rule', sourceUrl: 'https://example.com' },
        { ruleId: 'rule_hallucinated', title: 'Made Up', sourceUrl: 'https://fake.example.com' },
      ],
      rateTable: [{ threshold: 300000, rate: 0 }, { threshold: Infinity, rate: 0.05 }],
    });
  TaxEstimate.findOneAndUpdate = async (filter, doc) => doc;

  const res = await request(app).get('/api/tax/estimate?period=Q2-2024-25').set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  const ruleIds = res.body.data.rulesUsed.map((r) => r.ruleId);
  assert.ok(ruleIds.includes('rule_real'));
  assert.ok(!ruleIds.includes('rule_hallucinated'));
});

test('GET /api/tax/estimate clamps taxable income to zero when deductions exceed gross income', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId().toString();

  taxService.aggregateIncomeAndDeductions = async () => ({ grossIncome: 10000, totalDeductions: 50000 });
  rag.searchTaxRules = async () => [];
  rag.generateJSONContent = async () => JSON.stringify({ citedRules: [], rateTable: [] });
  TaxEstimate.findOneAndUpdate = async (filter, doc) => doc;

  const res = await request(app).get('/api/tax/estimate?period=Q2-2024-25').set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  assert.equal(res.body.data.taxableIncome, 0);
  assert.equal(res.body.data.estimatedTax, 0);
});

test('GET /api/tax/estimate rejects a malformed period before touching any service', async () => {
  const app = buildApp();
  const res = await request(app)
    .get('/api/tax/estimate?period=not-a-period')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 400);
});

test('GET /api/tax/estimate returns a clean 500 without leaking the raw provider error', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId().toString();

  taxService.aggregateIncomeAndDeductions = async () => ({ grossIncome: 100000, totalDeductions: 0 });
  rag.searchTaxRules = async () => {
    throw new Error('GoogleGenerativeAI Error: some internal provider detail');
  };

  const res = await request(app).get('/api/tax/estimate?period=Q2-2024-25').set('Authorization', authHeader(userId));

  assert.equal(res.status, 500);
  assert.equal(res.body.message, 'Tax estimation is temporarily unavailable');
  assert.ok(!JSON.stringify(res.body).includes('GoogleGenerativeAI'));
});

test('GET /api/tax/rules/search requires auth', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/tax/rules/search?q=fuel');
  assert.equal(res.status, 401);
});

test('GET /api/tax/rules/search returns retrieval results without a generation call', async () => {
  const app = buildApp();
  const userId = new mongoose.Types.ObjectId().toString();
  let generationCalled = false;

  rag.searchTaxRules = async (q, topK) => {
    assert.equal(q, 'fuel expenses');
    assert.equal(topK, 5);
    return [{ id: 'rule_fuel', title: 'Fuel Deduction', similarityScore: 0.8 }];
  };
  rag.generateJSONContent = async () => {
    generationCalled = true;
    return '{}';
  };

  const res = await request(app)
    .get('/api/tax/rules/search?q=fuel expenses&topK=5')
    .set('Authorization', authHeader(userId));

  assert.equal(res.status, 200);
  assert.equal(res.body.data.items.length, 1);
  assert.equal(generationCalled, false);
});
