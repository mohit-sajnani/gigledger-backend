import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import dns from 'dns';
import mongoose from 'mongoose';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TaxRule } from '../models/TaxRule.js';

dotenv.config();

try {
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (e) { }

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

let vectorStoreInMemory = [];
let embeddingModelName = 'gemini-embedding-001';
let discoveredEmbeddingModels = [];

async function discoverEmbeddingModels() {
  if (discoveredEmbeddingModels.length > 0) return discoveredEmbeddingModels;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await res.json();
    if (data.models) {
      discoveredEmbeddingModels = data.models
        .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('embedContent'))
        .map(m => m.name.replace('models/', ''));
    }
  } catch (e) { }
  return discoveredEmbeddingModels;
}

/**
 * Helper to generate query embedding vector with candidate fallback & dynamic API discovery
 */
export async function getEmbeddingVector(queryText) {
  const dynamicEmbedModels = await discoverEmbeddingModels();
  const candidates = Array.from(new Set([
    embeddingModelName,
    ...dynamicEmbedModels,
    'gemini-embedding-001',
    'text-embedding-004',
    'embedding-001'
  ]));

  let lastError = null;
  for (const modelName of candidates) {
    if (!modelName) continue;
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const queryRes = await model.embedContent({
        content: { parts: [{ text: queryText }] },
        outputDimensionality: 768
      });
      if (queryRes && queryRes.embedding && queryRes.embedding.values) {
        embeddingModelName = modelName;
        return queryRes.embedding.values;
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`Embedding model error: ${lastError ? lastError.message : 'No embedding model succeeded'}`);
}

/**
 * SECTION 1: Cosine Similarity Helper
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * SECTION 2: Initialize Database Connection & Load Vector Rules
 */
export async function initializeDatabase() {
  const mongoURI = process.env.MONGODB_URI;

  try {
    if (mongoose.connection.readyState === 0 && mongoURI) {
      console.log('⏳ Connecting MongoDB for RAG Engine...');
      await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000 });
      console.log('🍃 MongoDB Connected for RAG Search Engine!');
    }
  } catch (err) {
    console.log('⚠️ MongoDB connection warning:', err.message, '- Using in-memory JSON fallback.');
  }

  // Also load local JSON into memory as fallback
  try {
    const filePath = path.resolve('data/tax_rules_with_vectors.json');
    if (fs.existsSync(filePath)) {
      vectorStoreInMemory = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (vectorStoreInMemory.length > 0 && vectorStoreInMemory[0].embeddingModelUsed) {
        embeddingModelName = vectorStoreInMemory[0].embeddingModelUsed;
      }
    }
  } catch (e) { }
}

/**
 * SECTION 3: MongoDB Vector Search Engine
 */
export async function searchTaxRules(queryText, topK = 3) {
  const queryVector = await getEmbeddingVector(queryText);

  const SIMILARITY_THRESHOLD = 0.50; // 768d compressed vectors score lower than 3072d — 0.50+ is semantically relevant

  if (mongoose.connection.readyState === 1) {
    try {
      // Fetch all rules from MongoDB and rank by cosine similarity in Node.js
      // (Atlas $vectorSearch requires a 'vector' type index; falls back here when knnVector is used)
      const dbRules = await TaxRule.find({}).lean();
      if (dbRules.length > 0) {
        const scored = dbRules.map(rule => ({
          ...rule,
          similarityScore: cosineSimilarity(queryVector, rule.embedding)
        }));
        scored.sort((a, b) => b.similarityScore - a.similarityScore);
        const topScored = scored.slice(0, topK);
        const aboveThreshold = topScored.filter(r => r.similarityScore >= SIMILARITY_THRESHOLD);
        const finalResults = aboveThreshold.length > 0
          ? aboveThreshold
          : [{ ...topScored[0], lowConfidence: true }];
        return finalResults.map(({ embedding, ...cleanRule }) => cleanRule);
      }
    } catch (dbErr) {
      // Fall through to in-memory JSON
    }
  }

  if (vectorStoreInMemory.length === 0) {
    await initializeDatabase();
  }

  const scored = vectorStoreInMemory.map(rule => ({
    ...rule,
    similarityScore: cosineSimilarity(queryVector, rule.embedding)
  }));

  scored.sort((a, b) => b.similarityScore - a.similarityScore);

  const topScored = scored.slice(0, topK);
  const aboveThreshold = topScored.filter(r => r.similarityScore >= SIMILARITY_THRESHOLD);

  // If no result meets the threshold, return best match with a low-confidence flag
  // so the LLM knows to be cautious — better than silently returning wrong rules
  const finalResults = aboveThreshold.length > 0
    ? aboveThreshold
    : topScored.slice(0, 1).map(r => ({ ...r, lowConfidence: true }));

  return finalResults.map(({ embedding, ...cleanRule }) => cleanRule);
}

let workingTextModel = null;
let discoveredTextModels = [];

// Models known to be deprecated by Google — skip these in discovery results
const DEPRECATED_MODEL_PREFIXES = ['gemini-2.5', 'gemini-2.0', 'gemini-1.0', 'gemini-1.5'];

function isDeprecated(modelName) {
  return DEPRECATED_MODEL_PREFIXES.some(prefix => modelName.startsWith(prefix));
}

/** Extract Google's suggested replacement model from a 404 error message */
function extractSuggestedModel(errMessage) {
  const match = errMessage && errMessage.match(/use\s+models\/([\w.-]+)/i);
  return match ? match[1] : null;
}

async function discoverTextModels() {
  if (discoveredTextModels.length > 0) return discoveredTextModels;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await res.json();
    if (data.models) {
      discoveredTextModels = data.models
        .filter(m =>
          m.supportedGenerationMethods &&
          m.supportedGenerationMethods.includes('generateContent') &&
          !m.name.includes('tts') &&
          !m.name.includes('image') &&
          !isDeprecated(m.name.replace('models/', ''))
        )
        .map(m => m.name.replace('models/', ''));
    }
  } catch (e) { }
  return discoveredTextModels;
}

/**
 * Helper to generate JSON content with dynamic API discovery, model fallback, & rate-limit safety
 */
export async function generateJSONContent(prompt) {
  if (workingTextModel) {
    try {
      const model = genAI.getGenerativeModel({
        model: workingTextModel,
        generationConfig: { responseMimeType: 'application/json' }
      });
      const response = await model.generateContent(prompt);
      if (response && response.response) {
        return response.response.text();
      }
    } catch (e) {
      workingTextModel = null;
    }
  }

  const dynamicModels = await discoverTextModels();

  // Known-working models go FIRST so they're tried before dynamic discovery results
  const PREFERRED_MODELS = [
    'gemini-3.6-flash',
    'gemini-3.1-pro-preview',
    'gemini-3.5-flash',
    'gemini-3.1-pro',
  ];

  const candidates = Array.from(new Set([
    ...PREFERRED_MODELS,
    ...dynamicModels.filter(m => !m.includes('tts') && !isDeprecated(m)),
  ]));

  let lastError = null;
  for (let i = 0; i < candidates.length; i++) {
    const modelName = candidates[i];
    if (!modelName || modelName.includes('tts') || isDeprecated(modelName)) continue;
    try {
      console.log(`   🤖 Calling Gemini model "${modelName}" for RAG report...`);
      let model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: 'application/json' }
      });

      let response;
      try {
        response = await model.generateContent(prompt);
      } catch (jsonErr) {
        // If responseMimeType JSON isn't supported, fallback to plain text config
        model = genAI.getGenerativeModel({ model: modelName });
        response = await model.generateContent(prompt);
      }

      if (response && response.response) {
        workingTextModel = modelName;
        console.log(`   ✅ Gemini Model "${workingTextModel}" responded successfully!\n`);
        return response.response.text();
      }
    } catch (err) {
      console.log(`   ⚠️ Model "${modelName}" failed: ${err.message}`);
      lastError = err;

      // If Google's 404 message suggests a replacement, inject it next in line
      if (err.message && err.message.includes('404')) {
        const suggested = extractSuggestedModel(err.message);
        if (suggested && !candidates.includes(suggested) && !isDeprecated(suggested)) {
          console.log(`   💡 Google suggests "${suggested}" — adding to retry queue...`);
          candidates.splice(i + 1, 0, suggested);
        }
      }

      // Handle rate limit (429) by waiting briefly before trying the next fallback
      if (err.status === 429 || (err.message && err.message.includes('429'))) {
        console.log(`⏳ Rate limit encountered. Pausing for 5 seconds before trying next model...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  throw new Error(`Text generation model error: ${lastError ? lastError.message : 'No text model succeeded'}`);
}

/**
 * SECTION 4: Grounded RAG Tax Report Generator
 */
export async function calculateTaxWithRAG(userEarnings, userExpenses, workerType = 'all_gig_workers') {
  const expenseDescriptions = userExpenses.map(e => `${e.description} (₹${e.amount})`).join(', ');

  // --- PASS 1 (Reactive): Search for rules matching the user's actual expenses ---
  const reactiveQuery = `Tax deductions and rules for gig worker earning ₹${userEarnings.totalGross} with expenses: ${expenseDescriptions}`;
  const reactiveRules = await searchTaxRules(reactiveQuery, 4);

  // --- PASS 2 (Proactive): Search for commonly missed deductions & savings strategies ---
  const proactiveQuery = `Common missed tax deductions, presumptive taxation Section 44AD 44ADA, and tax saving strategies for ${workerType} earning ₹${userEarnings.totalGross} under New Tax Regime`;
  const proactiveRules = await searchTaxRules(proactiveQuery, 4);

  // Merge both passes, de-duplicate by rule id
  const seenIds = new Set();
  const allRetrievedRules = [...reactiveRules, ...proactiveRules].filter(r => {
    if (seenIds.has(r.id)) return false;
    seenIds.add(r.id);
    return true;
  });

  const contextText = allRetrievedRules
    .map((r, idx) => `[Rule ${idx + 1}] ID: ${r.id}\nTitle: ${r.title}\nContent: ${r.content}\nOfficial Source: ${r.source_url}`)
    .join('\n\n');

  // List of expense descriptions the user already entered (for the LLM to detect gaps)
  const claimedExpensesList = userExpenses.map(e => e.description).join('; ');

  const prompt = `
You are an expert, audit-compliant Tax AI Advisor for Indian gig workers.

CRITICAL INSTRUCTIONS:
1. Base your calculations ONLY on the provided Tax Rules Context below.
2. For EVERY deduction or tax slab applied, cite the exact Rule ID, Title, and Source URL.
3. Do NOT make up tax rules or percentages outside the context.
4. CALCULATE the tax liability under the New Tax Regime ONLY.
5. ANALYZE the retrieved rules against the user's already-claimed expenses and IDENTIFY any eligible deductions the user has NOT yet claimed.
6. EVALUATE whether Presumptive Taxation under Section 44AD or 44ADA would reduce the user's tax liability. Calculate both the presumptive tax and the regular tax, and flag a saving if presumptive is lower.
7. POPULATE the 'taxSavingsSuggestions' array with actionable, specific advice. Include a realistic 'potentialSavingsAmount' estimate for each suggestion.

USER FINANCIAL PROFILE:
- Total Gross Earnings: ₹${userEarnings.totalGross}
- Worker Type: ${workerType}
- Expense Transactions Already Claimed: ${claimedExpensesList}
- Full Expense Details: ${JSON.stringify(userExpenses)}

RETRIEVED TAX RULES CONTEXT (Reactive + Proactive):
${contextText}

Respond ONLY in valid JSON matching this exact structure:
{
  "grossEarnings": number,
  "totalDeductions": number,
  "taxableIncome": number,
  "estimatedTaxLiability": number,
  "recommendedMonthlySetAside": number,
  "appliedDeductions": [
    {
      "expenseDescription": "string",
      "amountClaimed": number,
      "ruleId": "string",
      "ruleTitle": "string",
      "explanation": "string",
      "sourceUrl": "string"
    }
  ],
  "upcomingDeadlines": [
    {
      "title": "string",
      "dueDate": "string",
      "ruleId": "string"
    }
  ],
  "taxSavingsSuggestions": [
    {
      "type": "string",
      "title": "string",
      "potentialSavingsAmount": number,
      "description": "string",
      "referencedRuleId": "string"
    }
  ]
}

Valid 'type' values for taxSavingsSuggestions are: "MISSING_DEDUCTION", "PRESUMPTIVE_TAX".
`;

  const rawJson = await generateJSONContent(prompt);
  const cleanJsonText = rawJson.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  const jsonOutput = JSON.parse(cleanJsonText);

  return {
    taxReport: jsonOutput,
    retrievedRules: allRetrievedRules
  };
}