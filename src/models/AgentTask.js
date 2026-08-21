const mongoose = require('mongoose');

/**
 * The agentic proposal queue — every AI-suggested change lands here first
 * and never touches real data until a user approves it. Only `type:
 * 'categorize'` is produced as of Phase 2; the other enum values exist so
 * later phases (reconciliation, tax estimate, deadline check) don't need
 * a schema change to slot in.
 */
const agentTaskSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['reconcile', 'categorize', 'tax_estimate', 'deadline_check'],
      required: true,
    },
    status: {
      type: String,
      enum: ['proposed', 'approved', 'rejected', 'auto_applied'],
      default: 'proposed',
    },
    inputRefs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }],
    proposedChange: { type: mongoose.Schema.Types.Mixed, required: true },
    reasoning: { type: String, required: true, maxlength: 1000 },
    ruleRefs: { type: [String], default: [] },
    priority: { type: Number, default: 3, min: 1, max: 5 },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, enum: ['user', 'system'], default: null },
  },
  { timestamps: true },
);

agentTaskSchema.index({ userId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('AgentTask', agentTaskSchema);
