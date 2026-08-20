require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Category = require('../models/Category');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');

const DEMO_EMAIL = 'demo@gigledger.dev';

const INCOME_CATEGORIES = [
  'Uber', 'Ola', 'Rapido', 'Zomato', 'Swiggy', 'Zepto', 'Blinkit', 'Instamart',
  'Dunzo', 'Porter', 'Urban Company', 'Amazon Flex', 'Bigbasket', 'Flipkart Delivery',
  'Freelance/Direct Client', 'Other Income',
];

const EXPENSE_CATEGORIES = [
  { name: 'Fuel', taxDeductible: true },
  { name: 'Vehicle Maintenance', taxDeductible: true },
  { name: 'Vehicle Insurance', taxDeductible: true },
  { name: 'Toll & Parking', taxDeductible: true },
  { name: 'Mobile/Internet Recharge', taxDeductible: true },
  { name: 'Platform Commission', taxDeductible: true },
  { name: 'Vehicle EMI', taxDeductible: true },
  { name: 'Protective Gear', taxDeductible: true },
  { name: 'Food & Refreshment', taxDeductible: false },
  { name: 'Rent', taxDeductible: false },
  { name: 'Subscription', taxDeductible: false },
  { name: 'Cash Withdrawal', taxDeductible: false },
  { name: 'Bank Charges', taxDeductible: false },
  { name: 'Loan Repayment', taxDeductible: false },
  { name: 'Miscellaneous', taxDeductible: false },
  { name: 'Other Expense', taxDeductible: false },
];

/** Deterministic day offset from "now" so re-running seed produces identical demo data. */
function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function seed() {
  await connectDB();

  const demoUser = await User.findOneAndUpdate(
    { email: DEMO_EMAIL },
    {
      $setOnInsert: {
        firstName: 'Demo',
        lastName: 'Rider',
        email: DEMO_EMAIL,
        emailVerified: true,
      },
    },
    { upsert: true, new: true },
  );
  const demoUserId = demoUser._id;

  await Category.deleteMany({});
  await Transaction.deleteMany({ userId: demoUserId });

  const categoryDocs = [
    ...INCOME_CATEGORIES.map((name) => ({ name, type: 'income', taxDeductible: false, isDefault: true })),
    ...EXPENSE_CATEGORIES.map((c) => ({ name: c.name, type: 'expense', taxDeductible: c.taxDeductible, isDefault: true })),
  ];
  const categories = await Category.insertMany(categoryDocs);

  const byName = Object.fromEntries(categories.map((c) => [c.name, c]));
  const zomato = byName['Zomato'];
  const uber = byName['Uber'];
  const fuel = byName['Fuel'];
  const food = byName['Food & Refreshment'];
  const commission = byName['Platform Commission'];

  const transactions = [];
  for (let i = 0; i < 19; i += 1) {
    const isPending = i % 5 < 2; // 8 pending, 12 categorized
    const isIncome = i % 3 !== 0;

    transactions.push({
      userId: demoUserId,
      source: isIncome ? (i % 2 === 0 ? 'zomato' : 'uber') : 'manual',
      type: isIncome ? 'income' : 'expense',
      amount: isIncome ? 300 + i * 25 : 100 + i * 10,
      date: daysAgo(i * 4 + 1),
      rawDescription: isIncome ? (isPending ? `PAYOUT-${8800 + i}` : 'Trip earnings') : 'Fuel top-up',
      category: isPending ? null : isIncome ? (i % 2 === 0 ? zomato._id : uber._id) : (i % 2 === 0 ? fuel._id : food._id),
      categoryConfidence: isPending ? null : 0.9,
      status: isPending ? 'pending' : 'categorized',
      createdBy: 'user',
    });
  }
  // One deliberately messy row for the "Run Agent" demo.
  transactions.push({
    userId: demoUserId,
    source: 'manual',
    type: 'expense',
    amount: 220,
    date: daysAgo(2),
    rawDescription: 'PAYOUT-8823',
    category: commission._id,
    categoryConfidence: 0.4,
    status: 'pending',
    createdBy: 'user',
  });

  await Transaction.insertMany(transactions);

  logger.info(`Seed complete: ${categories.length} categories, ${transactions.length} transactions for ${DEMO_EMAIL} (${demoUserId}).`);
  logger.info(`Log in as this user via POST /api/auth/login with email "${DEMO_EMAIL}" — the OTP code prints to the running server's console (no SMTP configured).`);
  await mongoose.connection.close();
  process.exit(0);
}

seed().catch((err) => {
  logger.error(`Seed failed: ${err.message}`);
  process.exit(1);
});
