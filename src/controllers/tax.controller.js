const TaxEstimate = require('../models/TaxEstimate');
const taxService = require('../services/tax.service');
const rag = require('../services/rag.service');
const logger = require('../utils/logger');
const asyncHandler = require('../utils/asyncHandler');

const SLAB_YEAR = '2024-25';

/**
 * Builds the citation-only prompt: the LLM returns matched rule citations
 * and the rate-table/slab data those rules describe — never a computed tax
 * amount. All arithmetic happens afterward in tax.service.calculateTax.
 */
const buildCitationPrompt = (taxableIncome, retrievedRules) => {
  const contextText = retrievedRules
    .map((r, idx) => `[Rule ${idx + 1}] ID: ${r.id}\nTitle: ${r.title}\nContent: ${r.content}\nOfficial Source: ${r.source_url}`)
    .join('\n\n');

  return `
You are a tax-rule citation assistant for Indian gig workers. Do NOT calculate any tax amount, taxable income, or deduction total — that is done separately in code.

Your only job:
1. From the rules below, identify which ones actually apply to a taxable income of ₹${taxableIncome} under the New Tax Regime.
2. For each applicable rule, cite its exact Rule ID, Title, and Source URL.
3. Extract the New Tax Regime income-tax slab thresholds and rates described in the rules (as a rate table only — thresholds and rates, no computed amounts).
4. Do NOT invent a rule ID, title, or rate that isn't in the context below.

RETRIEVED TAX RULES CONTEXT:
${contextText}

Respond ONLY in valid JSON matching this exact structure:
{
  "citedRules": [ { "ruleId": "string", "title": "string", "sourceUrl": "string" } ],
  "rateTable": [ { "threshold": number, "rate": number } ]
}
`;
};

/**
 * GET /api/tax/estimate — computes and upserts a TaxEstimate for the caller,
 * for the given fiscal quarter. Every step that touches the LLM is
 * re-validated against ground truth (the actual retrieval results) before
 * it's trusted — a citation the model invents is dropped, not passed through.
 */
const getTaxEstimate = asyncHandler(async (req, res) => {
  const { period, refresh } = req.query;

  // Cache-first: recomputing means at least two Gemini calls (slow, billed,
  // and prone to the rate-limit-compounding hang seen during this feature's
  // own testing). A cached estimate for the same user+period is served as-is
  // unless the caller explicitly asks for a fresh computation.
  if (refresh !== 'true') {
    const cached = await TaxEstimate.findOne({ userId: req.userId, period });
    if (cached) {
      return res.status(200).json({
        success: true,
        data: {
          period: cached.period,
          grossIncome: cached.grossIncome,
          totalDeductions: cached.totalDeductions,
          taxableIncome: cached.taxableIncome,
          estimatedTax: cached.estimatedTax,
          slabBreakdown: cached.slabBreakdown,
          rulesUsed: cached.rulesUsed,
          regime: cached.regime,
          lowConfidence: false,
          cached: true,
        },
        message: '',
      });
    }
  }

  let startDate;
  let endDate;
  try {
    ({ startDate, endDate } = taxService.parsePeriod(period));
  } catch (err) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: [{ field: 'period', message: err.message }] });
  }

  const { grossIncome, totalDeductions } = await taxService.aggregateIncomeAndDeductions(req.userId, startDate, endDate);
  const taxableIncome = Math.max(0, grossIncome - totalDeductions);

  let retrievedRules;
  let llmOutput;
  try {
    retrievedRules = await rag.searchTaxRules(
      `Income tax slab rates under the New Tax Regime and deductions for a gig worker with taxable income ₹${taxableIncome}`,
      5,
    );
    const rawJson = await rag.generateJSONContent(buildCitationPrompt(taxableIncome, retrievedRules));
    const cleanJson = rawJson.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    llmOutput = JSON.parse(cleanJson);
  } catch (err) {
    logger.error(`Tax estimation failed for user ${req.userId}, period ${period}: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Tax estimation is temporarily unavailable', errors: [] });
  }

  // Re-validation: a citation not present in what was actually retrieved is
  // hallucinated — drop it rather than trust it. Title/source come from the
  // trusted retrieved record itself, never the LLM's own citation object —
  // a valid ruleId doesn't guarantee the model didn't alter the metadata
  // attached to it (e.g. a fabricated "official source" URL).
  const retrievedRulesById = new Map(retrievedRules.map((r) => [r.id, r]));
  const rulesUsed = (llmOutput.citedRules || [])
    .filter((r) => retrievedRulesById.has(r.ruleId))
    .map((r) => {
      const trusted = retrievedRulesById.get(r.ruleId);
      return { ruleId: trusted.id, title: trusted.title, sourceUrl: trusted.source_url };
    });

  const rateTable = (llmOutput.rateTable || []).filter(
    (slab) => typeof slab.threshold === 'number' && Number.isFinite(slab.threshold) && typeof slab.rate === 'number' && slab.rate >= 0 && slab.rate <= 1,
  );

  const lowConfidence = rulesUsed.length === 0 || rateTable.length === 0 || retrievedRules.some((r) => r.lowConfidence);

  const { slabBreakdown, estimatedTax } = taxService.calculateTax(taxableIncome, rateTable);

  const estimate = await TaxEstimate.findOneAndUpdate(
    { userId: req.userId, period },
    {
      userId: req.userId,
      period,
      grossIncome,
      totalDeductions,
      taxableIncome,
      estimatedTax,
      slabBreakdown,
      rulesUsed,
      regime: 'new',
      slabYear: SLAB_YEAR,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  res.status(200).json({
    success: true,
    data: {
      period: estimate.period,
      grossIncome: estimate.grossIncome,
      totalDeductions: estimate.totalDeductions,
      taxableIncome: estimate.taxableIncome,
      estimatedTax: estimate.estimatedTax,
      slabBreakdown: estimate.slabBreakdown,
      rulesUsed: estimate.rulesUsed,
      regime: estimate.regime,
      lowConfidence,
    },
    message: '',
  });
});

/** GET /api/tax/rules/search — retrieval-only debug endpoint, no LLM generation call. */
const searchTaxRules = asyncHandler(async (req, res) => {
  const { q, topK } = req.query;

  let items;
  try {
    items = await rag.searchTaxRules(q, topK ? Number(topK) : 3);
  } catch (err) {
    logger.error(`Tax rule search failed for query "${q}": ${err.message}`);
    return res.status(500).json({ success: false, message: 'Tax rule search is temporarily unavailable', errors: [] });
  }

  res.status(200).json({ success: true, data: { items }, message: '' });
});

module.exports = { getTaxEstimate, searchTaxRules };
