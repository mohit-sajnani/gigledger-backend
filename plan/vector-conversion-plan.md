# 🚀 Vector Conversion & RAG Implementation Plan
**Project**: Gig Worker Income & Tax Management Application
**Stack**: MERN (Node.js, Express, MongoDB) + React Native

---

## 📌 Architectural Overview

```
  [ tax_rules_seed.json ]  ──► (15 Gig Tax Rules)
            │
            ▼
  [ scripts/ingest_vectors.js ]  ──► (Calls Gemini/OpenAI Embedding API)
            │
            ▼
  [ data/tax_rules_with_vectors.json ]  ──► (Saved Vector Knowledge Base)
            │
            ▼
  [ Express RAG Engine (services/ragService.js) ]
            │  ├─ 1. Vector Cosine Similarity Search
            │  └─ 2. Injects Top-3 Rules into LLM Prompt
            ▼
  [ REST API Endpoints ]  ──► (POST /api/tax/estimate & POST /api/agent/reconcile)
            ▼
  [ React Native App ]  ──► (Displays Tax Estimate, Citations & User Approval Buttons)
```

---

## 📁 Recommended Project Directory Structure

```text
hackathon/
├── data/
│   ├── tax_rules_seed.json            # Raw JSON tax rules (15 rules)
│   └── tax_rules_with_vectors.json   # Output JSON with 768-dim vector embeddings
├── scripts/
│   └── ingest_vectors.js              # One-time script to convert text into vectors
├── backend/
│   ├── .env                           # Stores GEMINI_API_KEY or OPENAI_API_KEY
│   ├── package.json
│   ├── server.js                      # Express server entry point
│   ├── services/
│   │   └── ragService.js              # In-Memory Cosine Similarity & RAG logic
│   └── routes/
│       └── taxRoutes.js               # API Endpoints
└── docs/                              # Learning & Hackathon Guides
```

---

## 🛠️ Step-by-Step Implementation Blueprint

---

### STEP 1: Environment Setup & Dependencies

In your backend folder (`backend/`), install the required packages:

```bash
npm install express cors dotenv @google/genai mongoose
```

Create a `.env` file:
```env
PORT=5000
GEMINI_API_KEY=your_actual_gemini_api_key_here
```

---

### STEP 2: The Vector Ingestion Script (`scripts/ingest_vectors.js`)

This script reads [`tax_rules_seed.json`](file:///home/ankur-asrani/hackathon/data/tax_rules_seed.json), passes each rule through the embedding model (`text-embedding-004`), and saves the output with vectors to `tax_rules_with_vectors.json`.

```javascript
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function convertTaxRulesToVectors() {
  console.log('🚀 Starting Vector Conversion Process...');

  // 1. Load Raw Tax Rules
  const rawData = fs.readFileSync(path.resolve('data/tax_rules_seed.json'), 'utf-8');
  const taxRules = JSON.parse(rawData);

  console.log(`📋 Loaded ${taxRules.length} tax rules from seed file.`);

  // 2. Loop through each rule and generate embedding
  const embeddedRules = [];

  for (let i = 0; i < taxRules.length; i++) {
    const rule = taxRules[i];
    
    // Combine Title + Content to create a rich semantic string
    const textToEmbed = `${rule.title}: ${rule.content}`;
    console.log(`[${i + 1}/${taxRules.length}] Embedding: "${rule.title}"...`);

    try {
      const response = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: textToEmbed,
      });

      // Extract vector array (768 float numbers)
      const vector = response.embedding.values;

      embeddedRules.push({
        ...rule,
        embedding: vector // Array of 768 float numbers
      });
    } catch (error) {
      console.error(`❌ Failed to embed rule ${rule.id}:`, error.message);
    }
  }

  // 3. Save embedded rules to output file
  const outputPath = path.resolve('data/tax_rules_with_vectors.json');
  fs.writeFileSync(outputPath, JSON.stringify(embeddedRules, null, 2), 'utf-8');

  console.log(`✅ Success! Saved ${embeddedRules.length} rules with vectors to: ${outputPath}`);
}

convertTaxRulesToVectors();
```

---

### STEP 3: The Express RAG Engine (`services/ragService.js`)

This service loads `tax_rules_with_vectors.json` into server memory, calculates **Cosine Similarity** for user queries, and generates tax estimates with citations.

```javascript
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
let loadedVectorStore = [];

// 1. Math Helper: Cosine Similarity between two vectors
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 2. Load Stored Vectors into Memory
export function initializeVectorStore() {
  const filePath = path.resolve('data/tax_rules_with_vectors.json');
  const rawData = fs.readFileSync(filePath, 'utf-8');
  loadedVectorStore = JSON.parse(rawData);
  console.log(`⚡ Loaded ${loadedVectorStore.length} vector-indexed tax rules into memory.`);
}

// 3. Search Vector Store for Query Match
export async function searchTaxRules(queryText, topK = 3) {
  // Generate query embedding
  const queryRes = await ai.models.embedContent({
    model: 'text-embedding-004',
    contents: queryText,
  });
  const queryVector = queryRes.embedding.values;

  // Compute similarity against all stored rules
  const scoredRules = loadedVectorStore.map((rule) => ({
    ...rule,
    similarityScore: cosineSimilarity(queryVector, rule.embedding),
  }));

  // Sort descending by similarity score
  scoredRules.sort((a, b) => b.similarityScore - a.similarityScore);

  // Return Top K rules (excluding raw embedding arrays to keep HTTP payloads small)
  return scoredRules.slice(0, topK).map(({ embedding, ...cleanRule }) => cleanRule);
}

// 4. Generate RAG Tax Calculation Response
export async function calculateTaxWithRAG(userEarnings, userExpenses) {
  const searchQuery = `Tax deductions for earnings ₹${userEarnings.total} and expenses: ${userExpenses.map(e => e.description).join(', ')}`;
  
  // Step A: Retrieve Top 3 matching tax rules
  const retrievedRules = await searchTaxRules(searchQuery, 3);

  const contextText = retrievedRules
    .map(r => `[Rule ID: ${r.id}]\nTitle: ${r.title}\nContent: ${r.content}\nSource: ${r.source_url}`)
    .join('\n\n');

  // Step B: Formulate Grounded Prompt
  const prompt = `
You are an expert tax advisor for gig workers. Calculate estimated tax liability based ONLY on the tax rules provided below.

USER FINANCIAL SUMMARY:
- Total Earnings: ₹${userEarnings.total}
- Expenses: ${JSON.stringify(userExpenses)}

RETRIEVED TAX RULES CONTEXT:
${contextText}

Respond ONLY in valid JSON matching this schema:
{
  "grossEarnings": number,
  "totalDeductions": number,
  "netTaxableIncome": number,
  "estimatedTaxLiability": number,
  "appliedRules": [
    {
      "expenseCategory": "string",
      "deductedAmount": number,
      "ruleId": "string",
      "ruleTitle": "string",
      "explanation": "string",
      "sourceUrl": "string"
    }
  ]
}
`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: { responseMimeType: 'application/json' }
  });

  return {
    taxReport: JSON.parse(response.text),
    retrievedCitations: retrievedRules
  };
}
```

---

### STEP 4: Express API Route (`routes/taxRoutes.js`)

```javascript
import express from 'express';
import { calculateTaxWithRAG, searchTaxRules } from '../services/ragService.js';

const router = express.Router();

// Route 1: Calculate Tax Liability with RAG & Citations
router.post('/estimate', async (req, res) => {
  try {
    const { userEarnings, userExpenses } = req.body;
    const result = await calculateTaxWithRAG(userEarnings, userExpenses);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route 2: Search Tax Rules Directly
router.post('/search-rules', async (req, res) => {
  try {
    const { query } = req.body;
    const rules = await searchTaxRules(query, 3);
    res.json({ success: true, rules });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
```

---

### STEP 5: React Native Mobile Integration

In React Native, consume the API and render **Citation Badges** + **User Approval Buttons**:

```javascript
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';

export function TaxEstimateScreen() {
  const [taxData, setTaxData] = useState(null);

  const fetchTaxEstimate = async () => {
    const response = await fetch('http://YOUR_BACKEND_IP:5000/api/tax/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userEarnings: { total: 450000 },
        userExpenses: [
          { description: 'HPCL Petrol Pump Fuel', amount: 15000 },
          { description: 'Figma & Adobe SaaS Subscription', amount: 8000 }
        ]
      })
    });
    const result = await response.json();
    setTaxData(result.data.taxReport);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.button} onPress={fetchTaxEstimate}>
        <Text style={styles.buttonText}>Calculate Tax with AI RAG</Text>
      </TouchableOpacity>

      {taxData && (
        <View style={styles.reportCard}>
          <Text style={styles.taxTitle}>Estimated Tax: ₹{taxData.estimatedTaxLiability}</Text>
          
          <Text style={styles.sectionHeader}>Applied Tax Rules (Citations):</Text>
          {taxData.appliedRules.map((rule, idx) => (
            <View key={idx} style={styles.citationBox}>
              <Text style={styles.ruleTitle}>📜 {rule.ruleTitle}</Text>
              <Text style={styles.explanation}>{rule.explanation}</Text>
              
              {/* Clickable Citation URL */}
              <TouchableOpacity onPress={() => Linking.openURL(rule.sourceUrl)}>
                <Text style={styles.linkText}>Verify Official Rule Source ↗</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#0F172A', flex: 1 },
  button: { backgroundColor: '#6366F1', padding: 14, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#FFF', fontWeight: 'bold' },
  reportCard: { marginTop: 20, backgroundColor: '#1E293B', padding: 16, borderRadius: 12 },
  taxTitle: { color: '#10B981', fontSize: 20, fontWeight: 'bold' },
  sectionHeader: { color: '#94A3B8', marginTop: 14, fontWeight: '600' },
  citationBox: { backgroundColor: '#334155', padding: 12, borderRadius: 8, marginTop: 8 },
  ruleTitle: { color: '#F59E0B', fontWeight: 'bold' },
  explanation: { color: '#E2E8F0', fontSize: 13, marginVertical: 4 },
  linkText: { color: '#38BDF8', fontSize: 12, marginTop: 4 }
});
```

---

## 🎯 Verification Checklist for Your Presentation

- [ ] Run `ingest_vectors.js` to create `data/tax_rules_with_vectors.json`.
- [ ] Verify `tax_rules_with_vectors.json` contains arrays of 768 float numbers under each rule's `embedding` key.
- [ ] Test `/api/tax/estimate` endpoint in Postman or Express logs.
- [ ] Show judges the **Clickable Citation Link** on the React Native mobile screen proving transparency!
