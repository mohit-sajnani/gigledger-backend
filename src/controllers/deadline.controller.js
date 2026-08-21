const Deadline = require('../models/Deadline');
const asyncHandler = require('../utils/asyncHandler');
const { syncDeadlines, checkAndNotify } = require('../services/deadlineAgent.service');

/**
 * GET /api/deadlines — syncs the caller's deadlines for the current
 * financial year, then returns all of them sorted soonest-first. Doesn't
 * propose any notifications itself (see POST /run for that) so a plain
 * page load never spams the inbox.
 */
const listDeadlines = asyncHandler(async (req, res) => {
  await syncDeadlines(req.userId);
  const deadlines = await Deadline.find({ userId: req.userId }).sort({ dueDate: 1 });
  res.status(200).json({ success: true, data: deadlines, message: '' });
});

/**
 * GET /api/deadlines/:id — a single deadline, scoped to the caller.
 */
const getDeadline = asyncHandler(async (req, res) => {
  const deadline = await Deadline.findOne({ _id: req.params.id, userId: req.userId });
  if (!deadline) {
    return res.status(404).json({ success: false, message: 'Deadline not found', errors: [] });
  }
  res.status(200).json({ success: true, data: deadline, message: '' });
});

/**
 * PATCH /api/deadlines/:id/complete — user manually marks a deadline paid.
 * Once completed, syncDeadlines will never recompute this row's status again.
 */
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

  res.status(200).json({
    success: true,
    data: { _id: deadline._id, status: deadline.status },
    message: 'Deadline marked complete.',
  });
});

/**
 * POST /api/deadlines/run — on-demand equivalent of the nightly cron: sync
 * then notify together, so the flow is testable without waiting for midnight.
 */
const runDeadlineAgent = asyncHandler(async (req, res) => {
  const deadlines = await syncDeadlines(req.userId);
  const notified = await checkAndNotify(req.userId);

  res.status(200).json({
    success: true,
    data: { deadlines, notified, notifiedCount: notified.length },
    message: 'Deadline sync complete.',
  });
});

module.exports = { listDeadlines, getDeadline, completeDeadline, runDeadlineAgent };
