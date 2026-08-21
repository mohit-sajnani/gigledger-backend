const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const TaxEstimate = require('../src/models/TaxEstimate');
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

const sampleEstimate = () => ({
  period: 'Q2-2024-25',
  regime: 'new',
  slabYear: '2024-25',
  grossIncome: 500000,
  totalDeductions: 50000,
  taxableIncome: 450000,
  estimatedTax: 10000,
  slabBreakdown: [{ threshold: 300000, rate: 0, amountInBand: 300000, taxForBand: 0 }],
  rulesUsed: [{ ruleId: 'r1', title: 'New Regime Slabs FY24-25', sourceUrl: 'https://incometax.gov.in' }],
});

test('GET /api/tax/export requires auth', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/tax/export?period=Q2-2024-25');
  assert.equal(res.status, 401);
});

test('GET /api/tax/export rejects a malformed period before touching any service', async () => {
  const app = buildApp();
  const res = await request(app)
    .get('/api/tax/export?period=not-a-period')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 400);
});

test('GET /api/tax/export rejects an invalid format', async () => {
  const app = buildApp();
  const res = await request(app)
    .get('/api/tax/export?period=Q2-2024-25&format=csv')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 400);
});

test('GET /api/tax/export returns 404 when no TaxEstimate exists for the period', async () => {
  const app = buildApp();
  TaxEstimate.findOne = async () => null;

  const res = await request(app)
    .get('/api/tax/export?period=Q2-2024-25')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 404);
  assert.match(res.body.message, /call GET \/api\/tax\/estimate first/);
});

test('GET /api/tax/export defaults to PDF and streams the correct headers', async () => {
  const app = buildApp();
  TaxEstimate.findOne = async () => sampleEstimate();

  const res = await request(app)
    .get('/api/tax/export?period=Q2-2024-25')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.match(res.headers['content-disposition'], /attachment; filename="gigledger-tax-report-Q2-2024-25\.pdf"/);
  assert.equal(res.body.slice(0, 4).toString(), '%PDF');
});

test('GET /api/tax/export?format=excel streams a valid xlsx with the correct headers', async () => {
  const app = buildApp();
  TaxEstimate.findOne = async () => sampleEstimate();

  const res = await request(app)
    .get('/api/tax/export?period=Q2-2024-25&format=excel')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 200);
  assert.equal(
    res.headers['content-type'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  assert.match(res.headers['content-disposition'], /attachment; filename="gigledger-tax-report-Q2-2024-25\.xlsx"/);
  assert.ok(Number(res.headers['content-length']) > 0, 'xlsx body must not be empty');
});

test('GET /api/tax/export never calls the LLM/RAG layer', async () => {
  const app = buildApp();
  TaxEstimate.findOne = async () => sampleEstimate();
  let ragCalled = false;
  rag.searchTaxRules = async () => {
    ragCalled = true;
    return [];
  };
  rag.generateJSONContent = async () => {
    ragCalled = true;
    return '{}';
  };

  const res = await request(app)
    .get('/api/tax/export?period=Q2-2024-25')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));

  assert.equal(res.status, 200);
  assert.equal(ragCalled, false, 'export must be a pure read of an existing TaxEstimate, never touching the LLM/RAG layer');
});

test('GET /api/tax/export scopes the estimate lookup to the caller — a different user with no estimate still gets 404', async () => {
  const app = buildApp();
  let queriedUserId;
  TaxEstimate.findOne = async (filter) => {
    queriedUserId = filter.userId;
    return null;
  };

  const userId = new mongoose.Types.ObjectId().toString();
  const res = await request(app).get('/api/tax/export?period=Q2-2024-25').set('Authorization', authHeader(userId));

  assert.equal(res.status, 404);
  assert.equal(queriedUserId, userId);
});
