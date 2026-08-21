require('dotenv').config();

const cron = require('node-cron');
const app = require('./src/app');
const connectDB = require('./src/config/db');
const logger = require('./src/utils/logger');
const User = require('./src/models/User');
const { syncDeadlines, checkAndNotify } = require('./src/services/deadlineAgent.service');

const PORT = process.env.PORT || 5000;

/**
 * Nightly deadline scan for every user. One user's failure is logged and
 * skipped, not allowed to take down the rest of the batch.
 */
async function runNightlyDeadlineScan() {
  const users = await User.find({}, '_id');
  for (const user of users) {
    try {
      await syncDeadlines(user._id);
      await checkAndNotify(user._id);
    } catch (err) {
      logger.error(`Deadline agent failed for user ${user._id}: ${err.message}`);
    }
  }
}

connectDB().then(() => {
  app.listen(PORT, () => logger.info(`GigLedger API listening on port ${PORT}`));

  cron.schedule('0 0 * * *', () => {
    runNightlyDeadlineScan().catch((err) => logger.error(`Nightly deadline scan crashed: ${err.message}`));
  });
});

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled rejection: ${err.message}`);
  process.exit(1);
});
