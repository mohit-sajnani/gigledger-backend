import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

async function ingestTaxRules() {
  console.log('----------------------------------------------------');
  console.log('🚀 Step 2: Converting Tax Rules to Vector Embeddings');
  console.log('----------------------------------------------------\n');

  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    console.error('❌ ERROR: GEMINI_API_KEY is missing or not set in .env!');
    console.error('👉 Please open .env and add your Gemini API Key:');
    console.error('   GEMINI_API_KEY=AIzaSy...\n');
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  // Query Google Gemini API directly for available embedding models
  console.log('🔍 Querying Google Gemini API for available models...');
  let availableEmbeddingModels = [];

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await res.json();

    if (data.models) {
      availableEmbeddingModels = data.models
        .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('embedContent'))
        .map(m => m.name.replace('models/', ''));

      console.log(`📋 Discovered models supporting embedContent: ${JSON.stringify(availableEmbeddingModels)}\n`);
    } else if (data.error) {
      console.error('❌ API Key Error from Google:', data.error.message);
      process.exit(1);
    }
  } catch (e) {
    console.log('⚠️ Could not list models via REST API:', e.message);
  }

  const modelCandidates = Array.from(new Set([
    ...availableEmbeddingModels,
    'text-embedding-004',
    'embedding-001'
  ]));

  let workingModelName = null;
  let embeddingModel = null;

  for (const modelName of modelCandidates) {
    try {
      console.log(`   Testing model: "${modelName}"...`);
      const testModel = genAI.getGenerativeModel({ model: modelName });
      await testModel.embedContent('Test connection string');
      workingModelName = modelName;
      embeddingModel = testModel;
      console.log(`\n✅ Connected successfully using model: "${workingModelName}"!\n`);
      break;
    } catch (err) {
      console.log(`   ⚠️ Model "${modelName}" error: ${err.message}`);
    }
  }

  if (!embeddingModel) {
    console.error('\n❌ Could not find a working embedding model for this API key.');
    process.exit(1);
  }

  // 1. Resolve path to seed file
  const seedPath = path.resolve('data/tax_rules_seed.json');
  const rawData = fs.readFileSync(seedPath, 'utf-8');
  const taxRules = JSON.parse(rawData);

  console.log(`📋 Found ${taxRules.length} tax rules in data/tax_rules_seed.json.\n`);

  const embeddedRules = [];

  // 2. Loop through each rule and generate vector embedding
  for (let i = 0; i < taxRules.length; i++) {
    const rule = taxRules[i];
    const textToEmbed = `${rule.title}: ${rule.content}`;

    console.log(`[${i + 1}/${taxRules.length}] Embedding: "${rule.title}"...`);

    try {
      const result = await embeddingModel.embedContent(textToEmbed);
      const vector = result.embedding.values;

      embeddedRules.push({
        ...rule,
        embedding: vector,
        vectorDimensions: vector.length,
        embeddingModelUsed: workingModelName
      });

      console.log(`   ✅ Success! Generated ${vector.length}-dimensional vector.`);
    } catch (error) {
      console.error(`   ❌ Failed to embed rule ${rule.id}:`, error.message);
    }
  }

  // 3. Save embedded output
  const outputPath = path.resolve('data/tax_rules_with_vectors.json');
  fs.writeFileSync(outputPath, JSON.stringify(embeddedRules, null, 2), 'utf-8');

  console.log('\n----------------------------------------------------');
  console.log(`🎉 Step 2 Complete!`);
  console.log(`📁 Vector Store File Created: ${outputPath}`);
  console.log(`📊 Total Rules Embedded: ${embeddedRules.length}/${taxRules.length}`);
  console.log('----------------------------------------------------');
}

ingestTaxRules();
