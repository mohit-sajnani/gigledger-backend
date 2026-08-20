const mongoose = require('mongoose');

const deadlineSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['advance_tax', 'filing', 'gst', 'other'], required: true },
    label: { type: String, required: true, trim: true },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: ['upcoming', 'due', 'overdue', 'completed'], default: 'upcoming' },
    estimatedAmount: { type: Number, min: 0, default: null },
    relatedEstimateId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxEstimate', default: null },
    // Flips true once a reminder email has gone out — keeps the notify scan idempotent.
    notified: { type: Boolean, default: false },
  },
  { timestamps: true },
);

deadlineSchema.index({ userId: 1, dueDate: 1 });

module.exports = mongoose.model('Deadline', deadlineSchema);
