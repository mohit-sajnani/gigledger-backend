const Deadline = require('../models/Deadline');
const TaxEstimate = require('../models/TaxEstimate');

/**
 * Standard Indian advance-tax installment schedule (cumulative % of annual
 * liability due by each date) plus the ITR filing deadline. This is the
 * general-taxpayer schedule, not the presumptive-taxation-only single
 * 15-March payment some 44ADA filers use — kept as the general case since
 * the app's own UI already references these same four dates.
 */
const ADVANCE_TAX_INSTALLMENTS = [
  { quarter: 1, month: 5, day: 15 }, // 15 June — month is 0-indexed
  { quarter: 2, month: 8, day: 15 }, // 15 September
  { quarter: 3, month: 11, day: 15 }, // 15 December
  { quarter: 4, month: 2, day: 15 }, // 15 March (next calendar year)
];

function fyLabel(fyStartYear) {
  return `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, '0')}`;
}

/** Builds the deadline set for one fiscal year starting in `fyStartYear` (e.g. 2026 -> FY2026-27). */
function buildDeadlinesForFY(fyStartYear) {
  const label = fyLabel(fyStartYear);
  const deadlines = ADVANCE_TAX_INSTALLMENTS.map(({ quarter, month, day }) => {
    const year = quarter === 4 ? fyStartYear + 1 : fyStartYear;
    return {
      type: 'advance_tax',
      label: `Q${quarter} Advance Tax Installment (FY${label})`,
      dueDate: new Date(Date.UTC(year, month, day)),
      period: `Q${quarter}-${label}`, // used to look up a matching TaxEstimate, not stored
    };
  });

  deadlines.push({
    type: 'filing',
    label: `ITR Filing Deadline (FY${label})`,
    dueDate: new Date(Date.UTC(fyStartYear + 1, 6, 31)), // 31 July following FY end
    period: null,
  });

  return deadlines;
}

/**
 * POST /api/deadlines/run — (re)generates the standard statutory deadline
 * set for the caller's current and next fiscal year. Idempotent: upserts by
 * (userId, type, dueDate), so re-running never creates duplicates. Best-effort
 * links each advance-tax installment to the cached TaxEstimate for the
 * matching quarter, if one already exists — never triggers a fresh estimate
 * computation itself (that stays an explicit, separate LLM-backed action).
 */
async function runDeadlineGeneration(userId) {
  const now = new Date();
  const currentFYStart = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

  const planned = [
    ...buildDeadlinesForFY(currentFYStart),
    ...buildDeadlinesForFY(currentFYStart + 1),
  ];

  const periods = [...new Set(planned.map((d) => d.period).filter(Boolean))];
  const estimates = await TaxEstimate.find({ userId, period: { $in: periods } });
  const estimateByPeriod = new Map(estimates.map((e) => [e.period, e]));

  const results = [];
  for (const d of planned) {
    const estimate = d.period ? estimateByPeriod.get(d.period) : null;

    // Never overwrite a deadline the user has already marked completed —
    // skip it entirely rather than upsert, which would otherwise collide
    // with the (userId, type, dueDate) unique index on a completed doc.
    const existing = await Deadline.findOne({ userId, type: d.type, dueDate: d.dueDate });
    if (existing && existing.status === 'completed') {
      results.push(existing);
      continue;
    }

    const doc = await Deadline.findOneAndUpdate(
      { userId, type: d.type, dueDate: d.dueDate },
      {
        $set: {
          label: d.label,
          estimatedAmount: estimate ? estimate.estimatedTax : null,
          relatedEstimateId: estimate ? estimate._id : null,
        },
        $setOnInsert: { userId, type: d.type, dueDate: d.dueDate, status: 'upcoming', notified: false },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    results.push(doc);
  }

  return results;
}

module.exports = { runDeadlineGeneration };
