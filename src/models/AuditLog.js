const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actionType: { type: String, required: true },
    agentTaskId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentTask', required: true },
    before: { type: mongoose.Schema.Types.Mixed, required: true },
    after: { type: mongoose.Schema.Types.Mixed, required: true },
    approvedBy: { type: String, enum: ['user', 'system'], default: 'user' },
    targetModel: { type: String, enum: ['Transaction', 'Deadline'], default: 'Transaction' },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

auditLogSchema.index({ userId: 1, createdAt: -1 });

/**
 * Append-only guarantee: every Mongoose static path that could mutate or
 * remove an existing document is refused here. Nothing in this codebase
 * should ever call these on AuditLog — this is the backstop if it happens.
 */
const FORBIDDEN_MUTATIONS = [
  'findOneAndUpdate',
  'updateOne',
  'updateMany',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
  'findOneAndReplace',
  'replaceOne',
];

FORBIDDEN_MUTATIONS.forEach((method) => {
  auditLogSchema.pre(method, function refuseMutation() {
    throw new Error(`AuditLog is append-only — ${method} is not allowed`);
  });
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
