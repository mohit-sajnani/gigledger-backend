const mongoose = require('mongoose');

const taxEstimateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    period: { type: String, required: true },
    grossIncome: { type: Number, required: true, min: 0 },
    totalDeductions: { type: Number, required: true, min: 0 },
    taxableIncome: { type: Number, required: true, min: 0 },
    estimatedTax: { type: Number, required: true, min: 0 },
    slabBreakdown: [
      {
        threshold: Number,
        rate: Number,
        amountInBand: Number,
        taxForBand: Number,
      },
    ],
    rulesUsed: [
      {
        ruleId: String,
        title: String,
        sourceUrl: String,
      },
    ],
    assumptions: { type: [String], default: [] },
    regime: { type: String, default: 'new' },
    slabYear: { type: String, required: true },
  },
  { timestamps: true },
);

// One estimate per user per period — GET /api/tax/estimate upserts this on each call.
taxEstimateSchema.index({ userId: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('TaxEstimate', taxEstimateSchema);
