const Deadline = require('../models/Deadline');
const User = require('../models/User');
const { sendDeadlineReminderEmail } = require('../services/mailer.service');
const logger = require('../utils/logger');
const asyncHandler = require('../utils/asyncHandler');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * GET /api/deadlines — the caller's own deadlines, optionally filtered by
 * status or narrowed to what's due within the next N days.
 */
const listDeadlines = asyncHandler(async (req, res) => {
  const filter = { userId: req.userId };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.withinDays) {
    filter.dueDate = { $lte: new Date(Date.now() + Number(req.query.withinDays) * MS_PER_DAY) };
  }

  const items = await Deadline.find(filter).sort({ dueDate: 1 }).lean();
  res.status(200).json({ success: true, data: { items }, message: '' });
});

/**
 * POST /api/deadlines/notify — scan-and-send action, meant to be triggered
 * on a schedule (external cron, no scheduler wired up in this codebase yet).
 * Every send is isolated in its own try/catch so one bad email — a dead
 * SMTP connection, an orphaned userId — doesn't sink the rest of the batch.
 */
const notifyDueDeadlines = asyncHandler(async (req, res) => {
  const windowDays = req.body.windowDays || 3;
  const windowEnd = new Date(Date.now() + windowDays * MS_PER_DAY);

  const dueDeadlines = await Deadline.find({
    notified: false,
    status: { $ne: 'completed' },
    dueDate: { $lte: windowEnd },
  });

  let notified = 0;
  let failed = 0;
  let skipped = 0;

  for (const deadline of dueDeadlines) {
    const user = await User.findById(deadline.userId);
    if (!user) {
      skipped += 1;
      continue;
    }

    const daysRemaining = Math.max(0, Math.ceil((deadline.dueDate - Date.now()) / MS_PER_DAY));

    try {
      await sendDeadlineReminderEmail(user.email, {
        label: deadline.label,
        dueDate: deadline.dueDate,
        daysRemaining,
      });
      deadline.notified = true;
      await deadline.save();
      notified += 1;
    } catch (err) {
      failed += 1;
      logger.error(`Failed to send deadline reminder for deadline ${deadline._id}, user ${deadline.userId}: ${err.message}`);
    }
  }

  res.status(200).json({
    success: true,
    data: { scanned: dueDeadlines.length, notified, failed, skipped },
    message: '',
  });
});

module.exports = { listDeadlines, notifyDueDeadlines };
