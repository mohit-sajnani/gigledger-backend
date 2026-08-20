const mongoose = require('mongoose');

// Ported from the RAG teammate's reference implementation (models/TaxRule.js) —
// same field shape, converted to this app's CommonJS convention.
const taxRuleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    category: { type: String, required: true },
    target_worker: { type: String, required: true },
    content: { type: String, required: true },
    source_url: { type: String, required: true },
    embedding: { type: [Number], required: true },
    vectorDimensions: { type: Number, default: 768 },
    embeddingModelUsed: { type: String, default: 'gemini-embedding-001' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('TaxRule', taxRuleSchema);
