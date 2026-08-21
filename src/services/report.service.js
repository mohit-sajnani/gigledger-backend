const TaxEstimate = require('../models/TaxEstimate');

/**
 * Assembles the flat data shape both the PDF and Excel renderers consume.
 * Pure read of an already-computed TaxEstimate — no LLM/RAG call, no new
 * database writes. Returns null when nothing has been estimated yet for
 * this period, so the controller can turn that into a clean 404 instead
 * of handing a renderer incomplete data.
 * @param {import('mongoose').Types.ObjectId | string} userId
 * @param {string} period
 * @returns {Promise<object|null>}
 */
async function buildReportData(userId, period) {
  const estimate = await TaxEstimate.findOne({ userId, period });
  if (!estimate) return null;

  return {
    period: estimate.period,
    regime: estimate.regime,
    slabYear: estimate.slabYear,
    generatedAt: new Date(),
    grossIncome: estimate.grossIncome,
    totalDeductions: estimate.totalDeductions,
    taxableIncome: estimate.taxableIncome,
    estimatedTax: estimate.estimatedTax,
    slabBreakdown: estimate.slabBreakdown,
    rulesUsed: estimate.rulesUsed,
  };
}

module.exports = { buildReportData };
