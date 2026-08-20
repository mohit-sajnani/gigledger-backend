const mongoose = require('mongoose');
const AgentTask = require('../models/AgentTask');
const asyncHandler = require('../utils/asyncHandler');
const { runAgentCycle, applyApprovedTask } = require('../services/agent.service');
const logger = require('../utils/logger');

/**
 * POST /api/agent/run — triggers a categorization cycle for the caller's
 * pending transactions. Always 200, even on LLM failure — this is a
 * suggestion queue, not a critical path, so it degrades to an empty
 * result rather than surfacing a 500 for an upstream LLM hiccup.
 */
const runAgent = asyncHandler(async (req, res) => {
  const result = await runAgentCycle(req.userId);
  res.status(200).json({
    success: true,
    data: { tasks: result.tasks, count: result.tasks.length },
    message: result.message,
  });
});

/**
 * GET /api/agent/tasks — paginated inbox, defaults to the proposed queue.
 */
const listTasks = asyncHandler(async (req, res) => {
  const status = req.query.status || 'proposed';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);

  const filter = { userId: req.userId, status };

  const [items, total] = await Promise.all([
    AgentTask.find(filter)
      .sort({ priority: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    AgentTask.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { items, page, limit, total, totalPages: Math.ceil(total / limit) },
    message: '',
  });
});

/**
 * PATCH /api/agent/tasks/:id/approve — the only place a proposal actually
 * changes real data. Atomically flips the task to 'approved' and applies
 * it inside one MongoDB session transaction: either the task flip, the
 * Transaction update, and the AuditLog write all happen together, or none
 * of them do. A failure at any point rolls the task back to 'proposed'
 * instead of leaving it stranded as approved-but-unapplied.
 */
const approveTask = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const task = await AgentTask.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId, status: 'proposed' },
      { status: 'approved', resolvedAt: new Date(), resolvedBy: 'user' },
      { session, new: false },
    );

    if (!task) {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: 'Task not found or already resolved',
        errors: [],
      });
    }

    const { transaction, auditLog } = await applyApprovedTask(task, session);

    await session.commitTransaction();
    res.status(200).json({
      success: true,
      data: { transaction, auditLog },
      message: 'Task approved.',
    });
  } catch (err) {
    await session.abortTransaction();
    logger.error(`Failed to apply approved agent task ${req.params.id}: ${err.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to apply approved task — please retry',
      errors: [],
    });
  } finally {
    session.endSession();
  }
});

/**
 * PATCH /api/agent/tasks/:id/reject — pure state transition, never
 * touches the referenced Transaction.
 */
const rejectTask = asyncHandler(async (req, res) => {
  const task = await AgentTask.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId, status: 'proposed' },
    { status: 'rejected', resolvedAt: new Date(), resolvedBy: 'user' },
    { new: true },
  );

  if (!task) {
    return res.status(409).json({
      success: false,
      message: 'Task not found or already resolved',
      errors: [],
    });
  }

  res.status(200).json({
    success: true,
    data: { _id: task._id, status: task.status },
    message: 'Task rejected.',
  });
});

module.exports = { runAgent, listTasks, approveTask, rejectTask };
