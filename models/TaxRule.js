import mongoose from 'mongoose';

const taxRuleSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    title: {
      type: String,
      required: true
    },
    category: {
      type: String,
      required: true
    },
    target_worker: {
      type: String,
      required: true
    },
    content: {
      type: String,
      required: true
    },
    source_url: {
      type: String,
      required: true
    },
    // Array of 768 floating-point numbers representing the text embedding vector
    embedding: {
      type: [Number],
      required: true
    },
    vectorDimensions: {
      type: Number,
      default: 768
    },
    embeddingModelUsed: {
      type: String,
      default: 'gemini-embedding-001'
    }
  },
  {
    timestamps: true
  }
);

export const TaxRule = mongoose.model('TaxRule', taxRuleSchema);
