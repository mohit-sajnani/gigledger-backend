/**
 * generate_vectors.js
 * Re-generates vector embeddings for all rules in tax_rules_seed.json
 * and writes the output to data/tax_rules_with_vectors.json.
 *
 * Run: node scripts/generate_vectors.js
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// Ordered list of embedding models to try (most preferred first)
const EMBEDDING_MODEL_CANDIDATES = [
  'gemini-embedding-001',
  'text-embedding-004',
  'embedding-001',
];

async function getEmbedding(text, modelName) {
  const model = genAI.getGenerativeModel({ model: modelName });
  const result = await model.embedContent(text);
  if (result && result.embedding && result.embedding.values) {
    return result.embedding.values;
  }
  throw new Error(`No embedding returned from model ${modelName}`);
}

async function embedWithFallback(text) {
  let lastErr;
  for (const modelName of EMBEDDING_MODEL_CANDIDATES) {
    try {
      const vector = await getEmbedding(text, modelName);
      return { vector, modelName };
    } catch (err) {
      console.warn(` Model "${modelName}" failed: ${err.message}`);
      lastErr = err;
    }
  }
  throw new Error(`All embedding models failed. Last error: ${lastErr.message}`);
}

async function main() {
  console.log('====================================================');
  console.log('Generating Vector Embeddings for Tax Rules');
  console.log('====================================================\n');

  const seedPath = path.resolve('data/tax_rules_seed.json');
  const outputPath = path.resolve('data/tax_rules_with_vectors.json');

  if (!fs.existsSync(seedPath)) {
    console.error(`❌ Seed file not found: ${seedPath}`);
    process.exit(1);
  }

  const rules = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  console.log(`📋 Loaded ${rules.length} rules from seed file.\n`);

  const results = [];
  let usedModel = null;

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const textToEmbed = `${rule.title}\n\n${rule.content}`;

    process.stdout.write(`[${i + 1}/${rules.length}] Embedding: "${rule.title.substring(0, 60)}..." `);

    try {
      const { vector, modelName } = await embedWithFallback(textToEmbed);
      usedModel = modelName;
      results.push({
        ...rule,
        embedding: vector,
        vectorDimensions: vector.length,
        embeddingModelUsed: modelName,
      });
      console.log(`✅ (${vector.length}d, model: ${modelName})`);
    } catch (err) {
      console.log(`❌ FAILED: ${err.message}`);
      console.error('Aborting — fix the embedding model issue and retry.');
      process.exit(1);
    }

    // Small delay to avoid rate limits
    if (i < rules.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');

  console.log('\n====================================================');
  console.log(`✅ Done! Embedded ${results.length} rules.`);
  console.log(`📁 Output saved to: ${outputPath}`);
  console.log(`🤖 Embedding model used: ${usedModel}`);
  console.log('====================================================');
  process.exit(0);
}

main();
