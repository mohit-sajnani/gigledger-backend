const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

const Category = require('../src/models/Category');
const Transaction = require('../src/models/Transaction');
const ocr = require('../src/services/ocr.service');
const receiptRoutes = require('../src/routes/receipt.routes');

/** Minimal app: just the receipt routes, no db.js/app.js dependency. */
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/receipts', receiptRoutes);
  return app;
};

const authHeader = (userId) => `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;

const FAKE_CATEGORIES = [
  { _id: new mongoose.Types.ObjectId(), name: 'Fuel' },
  { _id: new mongoose.Types.ObjectId(), name: 'Vehicle Maintenance' },
];

const tinyJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

/** Fails the test if a Transaction is ever written — the core no-DB-write guarantee. */
const guardAgainstTransactionWrites = () => {
  let called = false;
  Transaction.create = async () => {
    called = true;
    throw new Error('Transaction.create should never be called by the receipt upload endpoint');
  };
  Transaction.insertMany = async () => {
    called = true;
    throw new Error('Transaction.insertMany should never be called by the receipt upload endpoint');
  };
  return () => called;
};

test('POST /api/receipts/upload requires auth', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/api/receipts/upload')
    .attach('receipt', tinyJpegBuffer, { filename: 'r.jpg', contentType: 'image/jpeg' });
  assert.equal(res.status, 401);
});

test('POST /api/receipts/upload rejects a request with no file', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/api/receipts/upload')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()));
  assert.equal(res.status, 400);
});

test('POST /api/receipts/upload rejects a disallowed mimetype', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/api/receipts/upload')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()))
    .attach('receipt', Buffer.from('not an image'), { filename: 'r.txt', contentType: 'text/plain' });
  assert.equal(res.status, 400);
});

test('POST /api/receipts/upload rejects an oversized file', async () => {
  const app = buildApp();
  const oversized = Buffer.alloc(6 * 1024 * 1024, 0xff);
  const res = await request(app)
    .post('/api/receipts/upload')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()))
    .attach('receipt', oversized, { filename: 'big.jpg', contentType: 'image/jpeg' });
  assert.equal(res.status, 400);
});

test('POST /api/receipts/upload returns high confidence for a valid amount and matched category', async () => {
  const app = buildApp();
  const checkNoWrites = guardAgainstTransactionWrites();
  Category.find = () => ({ select: () => ({ lean: async () => FAKE_CATEGORIES }) });
  ocr.extractReceiptData = async () => ({ amount: 450, date: '2026-08-01', description: 'Fuel top-up', category: 'Fuel' });

  const res = await request(app)
    .post('/api/receipts/upload')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()))
    .attach('receipt', tinyJpegBuffer, { filename: 'r.jpg', contentType: 'image/jpeg' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.amount, 450);
  assert.equal(res.body.data.category.name, 'Fuel');
  assert.equal(res.body.data.confidence, 'high');
  assert.equal(checkNoWrites(), false);
});

test('POST /api/receipts/upload drops an invalid amount to null with low confidence', async () => {
  const app = buildApp();
  Category.find = () => ({ select: () => ({ lean: async () => FAKE_CATEGORIES }) });
  ocr.extractReceiptData = async () => ({ amount: 'not-a-number', description: 'Fuel top-up', category: 'Fuel' });

  const res = await request(app)
    .post('/api/receipts/upload')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()))
    .attach('receipt', tinyJpegBuffer, { filename: 'r.jpg', contentType: 'image/jpeg' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.amount, null);
  assert.equal(res.body.data.confidence, 'low');
});

test('POST /api/receipts/upload drops a category the LLM invented that is not a real Category', async () => {
  const app = buildApp();
  Category.find = () => ({ select: () => ({ lean: async () => FAKE_CATEGORIES }) });
  ocr.extractReceiptData = async () => ({ amount: 200, description: 'Something', category: 'Made Up Category' });

  const res = await request(app)
    .post('/api/receipts/upload')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()))
    .attach('receipt', tinyJpegBuffer, { filename: 'r.jpg', contentType: 'image/jpeg' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.category, null);
  assert.equal(res.body.data.confidence, 'low');
});

test('POST /api/receipts/upload defaults an unparseable date to today rather than trusting the LLM', async () => {
  const app = buildApp();
  Category.find = () => ({ select: () => ({ lean: async () => FAKE_CATEGORIES }) });
  ocr.extractReceiptData = async () => ({ amount: 100, date: 'not-a-real-date', description: 'x', category: 'Fuel' });

  const res = await request(app)
    .post('/api/receipts/upload')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()))
    .attach('receipt', tinyJpegBuffer, { filename: 'r.jpg', contentType: 'image/jpeg' });

  assert.equal(res.status, 200);
  const returnedDate = new Date(res.body.data.date);
  const today = new Date();
  assert.equal(returnedDate.toDateString(), today.toDateString());
});

test('POST /api/receipts/upload returns a clean 500 without leaking the raw provider error', async () => {
  const app = buildApp();
  Category.find = () => ({ select: () => ({ lean: async () => FAKE_CATEGORIES }) });
  ocr.extractReceiptData = async () => {
    throw new Error('GoogleGenerativeAI Error: some internal provider detail');
  };

  const res = await request(app)
    .post('/api/receipts/upload')
    .set('Authorization', authHeader(new mongoose.Types.ObjectId().toString()))
    .attach('receipt', tinyJpegBuffer, { filename: 'r.jpg', contentType: 'image/jpeg' });

  assert.equal(res.status, 500);
  assert.equal(res.body.message, 'Receipt processing is temporarily unavailable');
  assert.ok(!JSON.stringify(res.body).includes('GoogleGenerativeAI'));
});
