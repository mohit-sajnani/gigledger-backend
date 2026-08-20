require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const TaxRule = require('../models/TaxRule');
const logger = require('../utils/logger');

// Reads the pre-computed vectors the RAG teammate already generated and
// committed (repo-root data/tax_rules_with_vectors.json) — no re-embedding,
// just upserting into *this app's* MONGO_URI database instead of the
// reference project's separate gig_tax_db.
const VECTORS_PATH = path.resolve(__dirname, '../../data/tax_rules_with_vectors.json');

async function ingestTaxRules() {
  await connectDB();

  if (!fs.existsSync(VECTORS_PATH)) {
    throw new Error(`Vector file not found at ${VECTORS_PATH} — nothing to ingest`);
  }

  const rules = JSON.parse(fs.readFileSync(VECTORS_PATH, 'utf-8'));

  let upserted = 0;
  for (const rule of rules) {
    await TaxRule.updateOne({ id: rule.id }, { $set: rule }, { upsert: true });
    upserted += 1;
  }

  logger.info(`Tax rule ingestion complete: ${upserted} rule(s) upserted.`);
  await mongoose.connection.close();
  process.exit(0);
}

ingestTaxRules().catch((err) => {
  logger.error(`Tax rule ingestion failed: ${err.message}`);
  process.exit(1);
});
