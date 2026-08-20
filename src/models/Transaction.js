const mongoose = require('mongoose');

/**
 * Core financial record — every income/expense entry a user logs,
 * manually or via a future platform import/agent action.
 */
const transactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    source: {
      type: String,
      enum: ['uber', 'swiggy', 'zomato', 'ola', 'manual', 'other'],
      default: 'manual',
    },
    type: { type: String, enum: ['income', 'expense'], required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    date: { type: Date, required: true },
    rawDescription: { type: String, trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    categoryConfidence: { type: Number, min: 0, max: 1, default: null },
    status: { type: String, enum: ['pending', 'categorized', 'reconciled'], default: 'pending' },
    sourceDocRef: { type: String, default: null },
    createdBy: { type: String, enum: ['user', 'agent'], default: 'user' },
    deleted: { type: Boolean, default: false },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
