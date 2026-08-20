const mongoose = require('mongoose');

/**
 * Category is a global master list, not scoped to a user — income
 * categories are gig/platform names (Uber, Zepto, ...), expense
 * categories are spend types (Fuel, Rent, ...). A future UserCategory
 * mapping will record per-user selections without touching this model.
 */
const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['income', 'expense'], required: true },
    taxDeductible: { type: Boolean, default: false },
    color: { type: String, default: '#888888' },
    icon: { type: String, default: 'tag' },
    isDefault: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

categorySchema.index({ name: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('Category', categorySchema);
