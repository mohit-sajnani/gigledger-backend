const Transaction = require('../models/Transaction');
const TaxEstimate = require('../models/TaxEstimate');
const asyncHandler = require('../utils/asyncHandler');

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Turns a `YYYY-MM` query param (or nothing) into a concrete [start, end) date range for a single calendar month. */
function resolveMonthRange(monthParam) {
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth(); // 0-indexed

  if (monthParam && MONTH_PATTERN.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number);
    year = y;
    month = m - 1;
  }

  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  const period = `${year}-${String(month + 1).padStart(2, '0')}`;

  return { start, end, period };
}

/** India's tax year runs Apr 1 -> Mar 31, not the calendar year — dashboard's tax-savings card is always "this FY". */
function resolveFinancialYear(now) {
  const calendarYear = now.getUTCFullYear();
  const isBeforeApril = now.getUTCMonth() < 3; // Jan-Mar still belongs to the FY that started last April
  const startYear = isBeforeApril ? calendarYear - 1 : calendarYear;

  const start = new Date(Date.UTC(startYear, 3, 1));
  const end = new Date(Date.UTC(startYear + 1, 2, 31, 23, 59, 59, 999));
  const label = `FY-${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;

  return { start, end, label };
}

async function sumAmount(userId, type, start, end) {
  const [result] = await Transaction.aggregate([
    { $match: { userId, type, deleted: false, date: { $gte: start, $lt: end } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return result ? result.total : 0;
}

/** GET /api/dashboard/summary — the header-card totals for one month. */
const getSummary = asyncHandler(async (req, res) => {
  const { start, end, period } = resolveMonthRange(req.query.month);
  const userId = req.userId;

  const [totalIncome, totalExpenses, pendingTransactions, categorizedTransactions] = await Promise.all([
    sumAmount(userId, 'income', start, end),
    sumAmount(userId, 'expense', start, end),
    Transaction.countDocuments({ userId, deleted: false, status: 'pending', date: { $gte: start, $lt: end } }),
    Transaction.countDocuments({ userId, deleted: false, status: 'categorized', date: { $gte: start, $lt: end } }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      period,
      totalIncome,
      totalExpenses,
      netIncome: totalIncome - totalExpenses,
      pendingTransactions,
      categorizedTransactions,
    },
    message: '',
  });
});

/** GET /api/dashboard/income-by-source — income split by platform, for the donut chart. */
const getIncomeBySource = asyncHandler(async (req, res) => {
  const { start, end, period } = resolveMonthRange(req.query.month);

  const grouped = await Transaction.aggregate([
    { $match: { userId: req.userId, type: 'income', deleted: false, date: { $gte: start, $lt: end } } },
    { $group: { _id: '$source', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]);

  const grandTotal = grouped.reduce((sum, row) => sum + row.total, 0);
  const breakdown = grouped.map((row) => ({
    source: row._id,
    total: row.total,
    count: row.count,
    percentage: grandTotal > 0 ? Math.round((row.total / grandTotal) * 1000) / 10 : 0,
  }));

  res.status(200).json({ success: true, data: { period, breakdown }, message: '' });
});

/** GET /api/dashboard/expense-by-category — expense split by category, joined for name + tax-deductible flag. */
const getExpenseByCategory = asyncHandler(async (req, res) => {
  const { start, end, period } = resolveMonthRange(req.query.month);

  const grouped = await Transaction.aggregate([
    { $match: { userId: req.userId, type: 'expense', deleted: false, date: { $gte: start, $lt: end } } },
    { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'categoryDoc' } },
    { $sort: { total: -1 } },
  ]);

  const grandTotal = grouped.reduce((sum, row) => sum + row.total, 0);
  const breakdown = grouped.map((row) => {
    // No category on the transaction, or the referenced category was deleted since — bucket it rather than dropping it.
    const category = row.categoryDoc[0];
    return {
      categoryName: category ? category.name : 'Uncategorized',
      total: row.total,
      taxDeductible: category ? category.taxDeductible : false,
      percentage: grandTotal > 0 ? Math.round((row.total / grandTotal) * 1000) / 10 : 0,
    };
  });

  res.status(200).json({ success: true, data: { period, breakdown }, message: '' });
});

/** GET /api/dashboard/monthly-trend — last N months of income/expense/net as parallel arrays for the trend chart. */
const getMonthlyTrend = asyncHandler(async (req, res) => {
  const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 6));
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

  const grouped = await Transaction.aggregate([
    { $match: { userId: req.userId, deleted: false, date: { $gte: since } } },
    {
      $group: {
        _id: { year: { $year: '$date' }, month: { $month: '$date' }, type: '$type' },
        total: { $sum: '$amount' },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);

  const monthLabels = [];
  const income = [];
  const expenses = [];
  const net = [];

  for (let i = 0; i < months; i += 1) {
    const cursor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1));
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1; // aggregation's $month is 1-indexed

    const incomeRow = grouped.find((row) => row._id.year === year && row._id.month === month && row._id.type === 'income');
    const expenseRow = grouped.find((row) => row._id.year === year && row._id.month === month && row._id.type === 'expense');

    const monthIncome = incomeRow ? incomeRow.total : 0;
    const monthExpense = expenseRow ? expenseRow.total : 0;

    monthLabels.push(MONTH_LABELS[cursor.getUTCMonth()]);
    income.push(monthIncome);
    expenses.push(monthExpense);
    net.push(monthIncome - monthExpense);
  }

  res.status(200).json({ success: true, data: { months: monthLabels, income, expenses, net }, message: '' });
});

/** GET /api/dashboard/tax-savings — how much of this FY's expenses are deductible, plus an estimated saving. */
const getTaxSavings = asyncHandler(async (req, res) => {
  const { start, end, label } = resolveFinancialYear(new Date());

  const [expenses, latestEstimate] = await Promise.all([
    Transaction.find({ userId: req.userId, type: 'expense', deleted: false, date: { $gte: start, $lte: end } })
      .populate('category')
      .lean(),
    TaxEstimate.findOne({ userId: req.userId }).sort({ period: -1, createdAt: -1 }).lean(),
  ]);

  let deductibleExpenses = 0;
  let nonDeductibleExpenses = 0;
  const deductibleTotalsByCategory = new Map();

  expenses.forEach((transaction) => {
    if (transaction.category && transaction.category.taxDeductible) {
      deductibleExpenses += transaction.amount;
      const name = transaction.category.name;
      deductibleTotalsByCategory.set(name, (deductibleTotalsByCategory.get(name) || 0) + transaction.amount);
    } else {
      nonDeductibleExpenses += transaction.amount;
    }
  });

  // Fall back to a flat 5% stub whenever the user has no tax estimate yet to derive a real effective rate from.
  const hasUsableEstimate = latestEstimate && latestEstimate.taxableIncome > 0;
  const rate = hasUsableEstimate ? latestEstimate.estimatedTax / latestEstimate.taxableIncome : 0.05;

  const deductibleBreakdown = Array.from(deductibleTotalsByCategory, ([categoryName, total]) => ({ categoryName, total }));

  res.status(200).json({
    success: true,
    data: {
      period: label,
      totalExpenses: deductibleExpenses + nonDeductibleExpenses,
      deductibleExpenses,
      nonDeductibleExpenses,
      estimatedTaxSaving: Math.round(deductibleExpenses * rate),
      deductibleBreakdown,
    },
    message: '',
  });
});

module.exports = {
  getSummary,
  getIncomeBySource,
  getExpenseByCategory,
  getMonthlyTrend,
  getTaxSavings,
};
