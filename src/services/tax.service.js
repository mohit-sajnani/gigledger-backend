const Category = require('../models/Category');
const Transaction = require('../models/Transaction');

// New-regime health & education cess, applied on top of slab tax — same
// treatment every Indian income-tax slab table needs, kept as one constant
// rather than folding it into the rate table itself.
const CESS_RATE = 0.04;

const PERIOD_PATTERN = /^Q([1-4])-(\d{4})-\d{2}$/;

/**
 * "Q2-2024-25" -> the actual Apr-Mar Indian fiscal quarter it names.
 * Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar (of the following year).
 */
const parsePeriod = (period) => {
  const match = PERIOD_PATTERN.exec(period);
  if (!match) throw new Error(`Invalid period format: ${period}`);

  const quarter = Number(match[1]);
  const fyStartYear = Number(match[2]);

  const QUARTER_STARTS = [
    [3, fyStartYear], // Q1: April (month index 3)
    [6, fyStartYear], // Q2: July
    [9, fyStartYear], // Q3: October
    [0, fyStartYear + 1], // Q4: January, next calendar year
  ];
  const [startMonth, startYear] = QUARTER_STARTS[quarter - 1];

  const startDate = new Date(Date.UTC(startYear, startMonth, 1));
  const endDate = new Date(Date.UTC(startYear, startMonth + 3, 0, 23, 59, 59, 999));

  return { startDate, endDate };
};

/**
 * Sums income and deductible-expense transactions for a user in a date
 * range. Deductions are found via an explicit two-step join — Category ->
 * Transaction — because Transaction.category is an ObjectId ref, not an
 * embedded document; a dot-path filter like 'category.taxDeductible' would
 * silently match nothing.
 */
const aggregateIncomeAndDeductions = async (userId, startDate, endDate) => {
  const dateFilter = { $gte: startDate, $lte: endDate };

  const incomeTransactions = await Transaction.find({
    userId,
    type: 'income',
    date: dateFilter,
    deleted: false,
  }).select('amount');
  const grossIncome = incomeTransactions.reduce((sum, t) => sum + t.amount, 0);

  const deductibleCategories = await Category.find({ taxDeductible: true, deleted: false }).select('_id');
  const deductibleCategoryIds = deductibleCategories.map((c) => c._id);

  const deductibleTransactions = await Transaction.find({
    userId,
    type: 'expense',
    category: { $in: deductibleCategoryIds },
    date: dateFilter,
    deleted: false,
  }).select('amount');
  const totalDeductions = deductibleTransactions.reduce((sum, t) => sum + t.amount, 0);

  return { grossIncome, totalDeductions };
};

/**
 * Pure, deterministic slab-splitting — no LLM involved. `rateTable` is the
 * cited rate/threshold data the LLM returned; this function does all the
 * arithmetic (bucketing, per-band tax, cess, final rounding) in plain JS.
 */
const calculateTax = (taxableIncome, rateTable) => {
  const clampedIncome = Math.max(0, taxableIncome);
  const sortedSlabs = [...rateTable].sort((a, b) => a.threshold - b.threshold);

  let remaining = clampedIncome;
  let prevThreshold = 0;
  let totalTax = 0;
  const slabBreakdown = [];

  for (const slab of sortedSlabs) {
    if (remaining <= 0) break;

    const bandCap = slab.threshold;
    const bandWidth = bandCap - prevThreshold;
    const amountInBand = Math.max(0, Math.min(remaining, bandWidth));

    if (amountInBand > 0) {
      const taxForBand = amountInBand * slab.rate;
      slabBreakdown.push({ threshold: slab.threshold, rate: slab.rate, amountInBand, taxForBand });
      totalTax += taxForBand;
      remaining -= amountInBand;
    }

    prevThreshold = bandCap;
  }

  // If the supplied slabs don't reach taxableIncome (e.g. an incomplete
  // LLM extraction missing the top open-ended band), tax the remainder at
  // the highest known rate rather than silently treating it as untaxed.
  if (remaining > 0 && sortedSlabs.length > 0) {
    const topRate = sortedSlabs[sortedSlabs.length - 1].rate;
    const taxForBand = remaining * topRate;
    slabBreakdown.push({ threshold: null, rate: topRate, amountInBand: remaining, taxForBand });
    totalTax += taxForBand;
    remaining = 0;
  }

  const cess = totalTax * CESS_RATE;
  const estimatedTax = Math.round(totalTax + cess);

  return { slabBreakdown, estimatedTax };
};

module.exports = { parsePeriod, aggregateIncomeAndDeductions, calculateTax };
