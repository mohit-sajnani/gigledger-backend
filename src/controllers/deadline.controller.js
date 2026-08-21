const Deadline = require('../models/Deadline');
const asyncHandler = require('../utils/asyncHandler');
const { runDeadlineGeneration } = require('../services/deadline.service');

/** GET /api/deadlines — every deadline for the caller, soonest first. */
const listDeadlines = asyncHandler(async (req, res) => {
  const filter = { userId: req.userId };
  if (req.query.status) filter.status = req.query.status;

  const items = await Deadline.find(filter).sort({ dueDate: 1 });
  res.status(200).json({ success: true, data: { items }, message: '' });
});

/** GET /api/deadlines/:id */
const getDeadline = asyncHandler(async (req, res) => {
  const deadline = await Deadline.findOne({ _id: req.params.id, userId: req.userId });
  if (!deadline) {
    return res.status(404).json({ success: false, message: 'Deadline not found', errors: [] });
  }
  res.status(200).json({ success: true, data: deadline, message: '' });
});

/** PATCH /api/deadlines/:id/complete — one-way transition, upcoming -> completed. */
const completeDeadline = asyncHandler(async (req, res) => {
  const deadline = await Deadline.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId, status: { $ne: 'completed' } },
    { status: 'completed' },
    { new: true },
  );

  if (!deadline) {
    return res.status(409).json({
      success: false,
      message: 'Deadline not found or already completed',
      errors: [],
    });
  }

  res.status(200).json({ success: true, data: deadline, message: 'Deadline marked complete' });
});

/**
 * POST /api/deadlines/run — regenerates the caller's standard statutory
 * deadline set. Cheap (no LLM) and idempotent, so safe to call from an
 * explicit "check for reminders now" button — normal usage otherwise relies
 * on the nightly cron (not implemented in this app; deadlines simply stay
 * whatever they were from the last run until called again).
 */
const runDeadlines = asyncHandler(async (req, res) => {
  const items = await runDeadlineGeneration(req.userId);
  res.status(200).json({ success: true, data: { items, count: items.length }, message: 'Deadlines refreshed' });
});

module.exports = { listDeadlines, getDeadline, completeDeadline, runDeadlines };
