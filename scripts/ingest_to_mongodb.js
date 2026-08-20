import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import dns from 'dns';
import mongoose from 'mongoose';
import { TaxRule } from '../models/TaxRule.js';

dotenv.config();

try {
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (e) {}

const mongoURI = process.env.MONGODB_URI;

async function uploadRulesToMongoDB() {
  console.log('----------------------------------------------------');
  console.log('🍃 Uploading Vector-Indexed Tax Rules to MongoDB');
  console.log('----------------------------------------------------\n');

  if (!mongoURI || mongoURI === 'mongodb://localhost:27017/gig_tax_db') {
    console.log('⚠️ Notice: MONGODB_URI is not configured in .env.');
    console.log('👉 Defaulting to local MongoDB: mongodb://localhost:27017/gig_tax_db\n');
  }

  try {
    // 1. Connect to MongoDB
    console.log('⏳ Connecting to MongoDB...');
    await mongoose.connect(mongoURI || 'mongodb://localhost:27017/gig_tax_db', { serverSelectionTimeoutMS: 5000 });
    console.log('✅ Connected to MongoDB successfully!\n');

    // 2. Read pre-computed vector file from Step 2
    const vectorPath = path.resolve('data/tax_rules_with_vectors.json');

    if (!fs.existsSync(vectorPath)) {
      console.error(`❌ Vector file not found at: ${vectorPath}`);
      console.error('👉 Please run `node scripts/ingest_vectors.js` first!');
      process.exit(1);
    }

    const rawData = fs.readFileSync(vectorPath, 'utf-8');
    const rulesWithVectors = JSON.parse(rawData);

    console.log(`📋 Loaded ${rulesWithVectors.length} rules with vector embeddings.`);

    // 3. Upsert into MongoDB
    // { id: rule.id } - yeh dhundta hai agar yeh id vala exist karta hai db me 
    let insertedCount = 0;
    for (const rule of rulesWithVectors) {
      await TaxRule.findOneAndUpdate(
        { id: rule.id },
        {
          id: rule.id,
          title: rule.title,
          category: rule.category,
          target_worker: rule.target_worker,
          content: rule.content,
          source_url: rule.source_url,
          embedding: rule.embedding,
          vectorDimensions: rule.vectorDimensions || rule.embedding.length,
          embeddingModelUsed: rule.embeddingModelUsed || 'gemini-embedding-001'
        },
        { upsert: true, new: true }
      );
      insertedCount++;
      console.log(`   ✅ Upserted rule [${insertedCount}/${rulesWithVectors.length}]: "${rule.title}"`);
    }

    console.log('\n----------------------------------------------------');
    console.log(`🎉 MongoDB Ingestion Complete!`);
    console.log(`📊 Total Tax Rules Saved to MongoDB: ${insertedCount}`);
    console.log('----------------------------------------------------');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ MongoDB Connection/Ingestion Error:', error.message);
    process.exit(1);
  }
}

uploadRulesToMongoDB();
