const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * Opens the MongoDB connection. Exits the process on failure so the app
 * never comes up half-broken with no database behind it.
 */
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('MongoDB connected');
  } catch (err) {
    logger.error(`MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = connectDB;
