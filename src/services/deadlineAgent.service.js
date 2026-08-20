const Deadline = require('../models/Deadline');
const AgentTask = require('../models/AgentTask');
const TaxEstimate = require('../models/TaxEstimate');
const TAX_CALENDAR = require('../constants/taxCalendar');

const DUE_SOON_WINDOW_DAYS = 15;

/**
 * Maps a date to the Indian financial year it falls in — FY starts April 1.
 * Aug 2026 -> "2026-27"; Feb 2026 -> "2025-26".
 * @param {Date} [today]
 * @returns {string}
 */
function currentFinancialYear(today = new Date()) {
  const calendarYear = today.getUTCFullYear();
  const startYear = today.getUTCMonth() >= 3 ? calendarYear : calendarYear - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** "2026-27" -> 2026 */
function fyStartYear(financialYear) {
  return Number(financialYear.split('-')[0]);
}

/**
 * Creates or updates one Deadline per calendar rule for a user's current
 * financial year, and recomputes status from today's date. A deadline the
 * user has already marked `completed` is left alone entirely — sync must
 * never flip it back to overdue/due_soon on a later run.
 * @param {import('mongoose').Types.ObjectId | string} userId
 * @returns {Promise<Array>} the synced Deadline documents
 */
async function syncDeadlines(userId) {
  const today = new Date();
  const financialYear = currentFinancialYear(today);
  const startYear = fyStartYear(financialYear);

  const syncedDeadlines = [];

  for (const rule of TAX_CALENDAR) {
    const dueYear = startYear + rule.yearOffset;
    const dueDate = new Date(Date.UTC(dueYear, rule.month, rule.day));

    // Atomic upsert, not findOne-then-new — two concurrent syncs for the same
    // user (e.g. a double page-load) must never both try to create the same
    // {userId, label, financialYear} row and trip the unique index.
    const deadline = await Deadline.findOneAndUpdate(
      { userId, label: rule.label, financialYear },
      { $setOnInsert: { userId, type: rule.type, label: rule.label, financialYear, dueDate } },
      { upsert: true, new: true },
    );

    if (deadline.status !== 'completed') {
      const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      deadline.status =
        daysUntilDue > DUE_SOON_WINDOW_DAYS ? 'upcoming' : daysUntilDue >= 0 ? 'due_soon' : 'overdue';

      // Only advance-tax quarters map to a TaxEstimate — ITR filing has no per-quarter estimate.
      if (rule.type === 'advance_tax') {
        const period = `${rule.quarter}-${financialYear}`;
        const estimate = await TaxEstimate.findOne({ userId, period });
        if (estimate) {
          deadline.estimatedAmount = estimate.estimatedTax;
          deadline.relatedEstimateId = estimate._id;
        }
      }
    }

    await deadline.save();
    syncedDeadlines.push(deadline);
  }

  return syncedDeadlines;
}

/**
 * Proposes an AgentTask for every due_soon deadline that hasn't been
 * notified yet, reusing the same propose/approve inbox Phase 2 built.
 * Dedup-guarded so calling this twice in a row (or the nightly cron
 * overlapping a manual trigger) never creates a duplicate proposal for
 * the same deadline.
 * @param {import('mongoose').Types.ObjectId | string} userId
 * @returns {Promise<Array>} newly created AgentTask documents
 */
async function checkAndNotify(userId) {
  const dueSoonDeadlines = await Deadline.find({ userId, status: 'due_soon', notified: false });
  const createdTasks = [];

  for (const deadline of dueSoonDeadlines) {
    const alreadyProposed = await AgentTask.exists({
      userId,
      type: 'deadline_check',
      status: 'proposed',
      'proposedChange.deadlineId': deadline._id,
    });
    if (alreadyProposed) continue;

    const daysUntilDue = Math.ceil((deadline.dueDate - new Date()) / (1000 * 60 * 60 * 24));
    const task = await AgentTask.create({
      userId,
      type: 'deadline_check',
      status: 'proposed',
      inputRefs: [],
      proposedChange: { deadlineId: deadline._id, action: 'acknowledge' },
      reasoning: `Your ${deadline.label} is due in ${daysUntilDue} day(s). Based on your income, you need to pay ₹${deadline.estimatedAmount || 0}.`,
      priority: 2,
    });

    deadline.notified = true;
    await deadline.save();
    createdTasks.push(task);
  }

  return createdTasks;
}

module.exports = { syncDeadlines, checkAndNotify, currentFinancialYear };
