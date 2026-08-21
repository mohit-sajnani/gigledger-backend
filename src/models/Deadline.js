const mongoose = require('mongoose');

/**
 * One row per statutory calendar rule per user per financial year. Synced
 * (created/updated) by deadlineAgent.service.js#syncDeadlines — `label` +
 * `financialYear` together are the dedup key, so re-running sync never
 * creates duplicates and each fiscal year gets its own fresh set of rows.
 */
const deadlineSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['advance_tax', 'filing', 'gst', 'other'], required: true },
    label: { type: String, required: true },
    financialYear: { type: String, required: true },
    dueDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['upcoming', 'due_soon', 'overdue', 'completed'],
      default: 'upcoming',
    },
    estimatedAmount: { type: Number, default: null },
    relatedEstimateId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxEstimate', default: null },
    notified: { type: Boolean, default: false },
  },
  { timestamps: true },
);

deadlineSchema.index({ userId: 1, label: 1, financialYear: 1 }, { unique: true });
deadlineSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('Deadline', deadlineSchema);
