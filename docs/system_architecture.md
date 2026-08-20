# System Architecture & Workflow Documentation

**Project:** Gig Worker Tax RAG Backend  
**Stack:** Node.js (ESM) · MongoDB Atlas · Google Gemini AI · RAG (Retrieval-Augmented Generation)  
**Last Updated:** FY 2026-27

---

## Table of Contents
1. [High-Level Overview](#1-high-level-overview)
2. [Data Pipeline — One-Time Setup](#2-data-pipeline--one-time-setup)
3. [Runtime Workflow — Per Request](#3-runtime-workflow--per-request)
4. [Core Engine Deep-Dive: ragService.js](#4-core-engine-deep-dive-ragservicejs)
5. [Frontend Integration Guide](#5-frontend-integration-guide)
6. [What the End User Sees](#6-what-the-end-user-sees)
7. [API Contract](#7-api-contract)
8. [System Architecture Diagram](#8-system-architecture-diagram)

---

## 1. High-Level Overview

This system is a **Retrieval-Augmented Generation (RAG) powered Tax Advisor** designed specifically for Indian gig workers (freelancers, cab drivers, delivery partners).

The system's purpose is:
- To calculate estimated income tax liability based on the user's gross earnings and declared business expenses.
- To **proactively suggest ways to save tax** (missed deductions, presumptive taxation schemes).
- To produce every answer **grounded in real Indian tax rules** with citations, preventing AI hallucinations.

> [!IMPORTANT]
> This is a **pure backend service** — it exposes a function `calculateTaxWithRAG()` that a frontend or API route can call. There is currently no HTTP server file (`server.js`) visible in the codebase, meaning the frontend integration is the **next step** to be built.

---

## 2. Data Pipeline — One-Time Setup

This is a one-time ingestion process that builds the knowledge base the AI uses. It must be run before the app can answer any tax questions.

### Step 1 — The Seed Data (`data/tax_rules_seed.json`)

This file is the **master knowledge base**. It contains 20+ Indian tax rules hand-curated for gig workers, each structured as:

```json
{
  "id": "rule_software_saas_subscriptions",
  "title": "Software Subscriptions, Cloud Hosting & Tooling (Section 37)",
  "category": "expense_deduction",
  "target_worker": "freelancer",
  "content": "Monthly and annual subscription costs for specialized professional software...",
  "source_url": "https://incometaxindia.gov.in/..."
}
```

**Categories covered:**
| Category | What it covers |
|---|---|
| `income_tax_regime` | Presumptive taxation (44AD, 44ADA, 44AE) |
| `income_tax_slab` | New & Old regime slab rates, Section 87A rebate |
| `expense_deduction` | Fuel, vehicle maintenance, internet, depreciation (Sec 32, 37) |
| `tds_credit` | TDS under 194J (professional fees), 194C (contracts) |
| `gst_compliance` | GST registration threshold, LUT for exports |
| `tax_filing` | ITR form selection (ITR-3 vs ITR-4), Schedule FA |
| `tax_compliance` | Audit requirements (44AB), book-keeping (44AA) |

### Step 2 — Vector Embedding (`scripts/ingest_vectors.js`)

**Command:** `npm run ingest:vectors`

This script reads `tax_rules_seed.json` and converts every rule's text into a **768-dimensional floating-point vector** using the Google Gemini Embedding API (`gemini-embedding-001`). 

**What happens:**
1. Queries the Gemini API to discover available embedding models (with fallback chain).
2. Loops through each of the 20+ rules.
3. Calls `embedContent("title: content")` for each rule.
4. Saves the output as `data/tax_rules_with_vectors.json` — each rule now has an `embedding: [number]` array of 768 floats.

### Step 3 — MongoDB Ingestion (`scripts/ingest_to_mongodb.js`)

**Command:** `npm run ingest:mongo`

Reads `data/tax_rules_with_vectors.json` and **upserts** every rule into MongoDB using the `TaxRule` Mongoose model.

**MongoDB Schema (`models/TaxRule.js`):**
```
id (String, unique index)
title (String)
category (String)
target_worker (String)
content (String)
source_url (String)
embedding ([Number], 768 floats)  ← the vector
vectorDimensions (Number, default 768)
embeddingModelUsed (String)
```

After this step, MongoDB Atlas holds all tax rules as searchable vector documents.

---

## 3. Runtime Workflow — Per Request

This is what happens every time a user submits their income and expenses.

```
User Input
    │
    ▼
[ Step A ] Embed the user's query into a 768-dim vector
    │
    ▼
[ Step B - Pass 1 ] Reactive RAG Search
  "Rules for gig worker with fuel, internet, car servicing expenses"
    │ → Returns top 4 rules by cosine similarity from MongoDB
    │
    ▼
[ Step B - Pass 2 ] Proactive RAG Search  ← NEW
  "Common missed deductions, 44AD/44ADA savings for ride_hailing worker"
    │ → Returns top 4 rules from MongoDB
    │
    ▼
[ Step C ] Merge & De-duplicate results (by rule id)
    │ → Up to 8 unique, highly relevant rules
    │
    ▼
[ Step D ] Build LLM Prompt
  - Injects user's gross earnings, worker type, claimed expenses
  - Injects all retrieved rules as grounded context
  - Instructs Gemini to: calculate tax (New Regime only), find missed
    deductions, evaluate presumptive taxation, produce savings suggestions
    │
    ▼
[ Step E ] Call Gemini Text Model (with JSON mode)
  - Tries preferred models in order: gemini-3.6-flash, gemini-3.1-pro, etc.
  - Falls back to dynamically discovered models if preferred ones fail
    │
    ▼
[ Step F ] Parse & Return structured JSON
```

---

## 4. Core Engine Deep-Dive: ragService.js

This is the heart of the system. All exported functions:

### `getEmbeddingVector(queryText)`
Converts a text string into a 768-dim vector. Has a **fallback chain** — tries `gemini-embedding-001` first, then any models discovered from the Gemini API. Caches the first working model name for subsequent calls.

### `cosineSimilarity(vecA, vecB)`
Pure math utility. Computes similarity between two vectors (range: 0 to 1.0). Used to rank all rules from MongoDB by relevance to the user's query. A score ≥ 0.50 is considered semantically relevant.

### `initializeDatabase()`
- Attempts to connect to MongoDB Atlas using `MONGODB_URI` from `.env`.
- Also loads `data/tax_rules_with_vectors.json` into `vectorStoreInMemory` as a **fallback** if MongoDB is unavailable.

### `searchTaxRules(queryText, topK = 3)`
The retrieval engine:
1. Generates an embedding vector for `queryText`.
2. Fetches all rules from MongoDB (or in-memory fallback).
3. Computes cosine similarity between the query vector and each rule's stored vector.
4. Returns the top `topK` rules above a 0.50 similarity threshold.
5. If nothing clears the threshold, returns the single best match with a `lowConfidence: true` flag.

### `generateJSONContent(prompt)`
Calls the Gemini text generation API. Has a sophisticated **model fallback chain**:
1. Tries cached `workingTextModel` first.
2. Falls back to preferred models: `gemini-3.6-flash`, `gemini-3.1-pro-preview`, `gemini-3.5-flash`, `gemini-3.1-pro`.
3. Dynamically discovers more models from the API.
4. On 404 errors, parses Google's error message for the suggested replacement model.
5. On 429 rate limits, waits 5 seconds before trying the next model.

### `calculateTaxWithRAG(userEarnings, userExpenses, workerType)` ← Main Function
Orchestrates the full pipeline described in Section 3. Returns:
```json
{
  "taxReport": { ... },      ← Full structured tax calculation
  "retrievedRules": [ ... ]  ← The actual rules used as context (for transparency)
}
```

---

## 5. Frontend Integration Guide

The frontend needs to call `calculateTaxWithRAG()`. Since there's no `server.js` yet, here is exactly how to wire it up:

### Step 1 — Create an API Route (e.g., Express)

```javascript
// server.js (to be created)
import express from 'express';
import { initializeDatabase, calculateTaxWithRAG } from './services/ragService.js';

const app = express();
app.use(express.json());

// Initialize DB once at startup
await initializeDatabase();

app.post('/api/calculate-tax', async (req, res) => {
  const { totalGross, expenses, workerType } = req.body;
  
  const result = await calculateTaxWithRAG(
    { totalGross },
    expenses,
    workerType || 'all_gig_workers'
  );
  
  res.json(result);
});

app.listen(3000);
```

### Step 2 — Frontend API Call (React/Next.js)

```javascript
const response = await fetch('/api/calculate-tax', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    totalGross: 750000,         // User's annual gross income in INR
    workerType: 'freelancer',   // 'freelancer' | 'ride_hailing_and_delivery' | 'all_gig_workers'
    expenses: [
      { description: 'Adobe Creative Cloud Subscription', amount: 12000 },
      { description: 'Laptop Depreciation', amount: 25000 }
    ]
  })
});

const { taxReport } = await response.json();
```

### Input Schema

| Field | Type | Required | Example |
|---|---|---|---|
| `totalGross` | `number` | ✅ | `750000` |
| `expenses` | `Array<{description, amount}>` | ✅ | See above |
| `workerType` | `string` | ❌ (defaults to `all_gig_workers`) | `freelancer` |

---

## 6. What the End User Sees

The API returns a rich JSON object. Here's how each field maps to a UI element:

### Main Tax Summary Card
```
grossEarnings           → "Your Gross Earnings: ₹7,50,000"
totalDeductions         → "Total Deductions Claimed: ₹72,000"
taxableIncome           → "Net Taxable Income: ₹6,78,000"
estimatedTaxLiability   → "Estimated Tax Due: ₹X,XXX"
recommendedMonthlySetAside → "Save ₹X,XXX/month for taxes"
```

### Deductions Breakdown Table
Rendered from `appliedDeductions[]`:
```
| Expense           | Amount Claimed | Rule Applied     | Source |
|-------------------|---------------|------------------|--------|
| Fuel Receipts     | ₹45,000       | Sec 37 (Fuel)    | [Link] |
| Internet Bill     | ₹15,000       | Sec 37 (Mobile)  | [Link] |
```

### Upcoming Deadlines Alerts
Rendered from `upcomingDeadlines[]`:
```
⚠️  Advance Tax Due Date — March 15, 2027
    Single installment for presumptive taxpayers (Rule: rule_advance_tax...)
```

### 💡 Tax Savings Suggestions Panel ← NEW
Rendered from `taxSavingsSuggestions[]`:

Each suggestion has a `type` which the UI can use to choose an icon/color:

| Type | UI Treatment | Example |
|---|---|---|
| `MISSING_DEDUCTION` | 🟡 Yellow tip card | "You can also claim your Coworking Space fees!" |
| `PRESUMPTIVE_TAX` | 🟢 Green highlight | "Opting for Section 44ADA could save you ₹18,000!" |

Example rendered card:
```
╔══════════════════════════════════════════════════╗
║ 💡 Tax Saving Opportunity                        ║
║                                                  ║
║ Opt for Presumptive Taxation (Section 44ADA)     ║
║                                                  ║
║ Potential Savings: ₹18,000                       ║
║                                                  ║
║ As a freelancer with ₹7.5L income, declaring     ║
║ 50% as profit under 44ADA results in a lower     ║
║ tax base than itemized expenses. You also get    ║
║ exemption from maintaining formal books.         ║
║                                                  ║
║ Reference: rule_44ada_presumptive               ║
╚══════════════════════════════════════════════════╝
```

---

## 7. API Contract

### Full Response Schema

```json
{
  "taxReport": {
    "grossEarnings": 750000,
    "totalDeductions": 72000,
    "taxableIncome": 678000,
    "estimatedTaxLiability": 14700,
    "recommendedMonthlySetAside": 1225,
    "appliedDeductions": [
      {
        "expenseDescription": "HPCL Petrol Pump Fuel Receipts",
        "amountClaimed": 45000,
        "ruleId": "rule_vehicle_fuel_expense_section37",
        "ruleTitle": "Fuel Expenses Deduction (Section 37)",
        "explanation": "100% of fuel costs for business rides is deductible",
        "sourceUrl": "https://incometaxindia.gov.in/..."
      }
    ],
    "upcomingDeadlines": [
      {
        "title": "Single Installment Advance Tax",
        "dueDate": "March 15, 2027",
        "ruleId": "rule_advance_tax_presumptive_single_installment"
      }
    ],
    "taxSavingsSuggestions": [
      {
        "type": "MISSING_DEDUCTION",
        "title": "Claim Vehicle Depreciation (Section 32)",
        "potentialSavingsAmount": 6000,
        "description": "You haven't claimed annual depreciation (30% WDV) on your vehicle...",
        "referencedRuleId": "rule_vehicle_depreciation_section32"
      },
      {
        "type": "PRESUMPTIVE_TAX",
        "title": "Consider Section 44AE Presumptive Taxation",
        "potentialSavingsAmount": 12000,
        "description": "For commercial vehicle operators, deemed profit at ₹1000/tonne/month...",
        "referencedRuleId": "rule_44ae_presumptive_goods_carriage"
      }
    ]
  },
  "retrievedRules": [
    {
      "id": "rule_vehicle_fuel_expense_section37",
      "title": "...",
      "category": "expense_deduction",
      "similarityScore": 0.8821
    }
  ]
}
```

---

## 8. System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND (To Build)                  │
│   Income Form → Expense List → Submit Button                │
└─────────────────────────┬───────────────────────────────────┘
                          │  POST /api/calculate-tax
                          │  { totalGross, expenses, workerType }
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     API ROUTE (server.js)                   │
│         Calls calculateTaxWithRAG(earnings, expenses)       │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                  ragService.js — Core Engine                │
│                                                             │
│  1. getEmbeddingVector(query)                               │
│         │→ Gemini Embedding API (gemini-embedding-001)     │
│                                                             │
│  2a. searchTaxRules(reactiveQuery)   [Pass 1]               │
│  2b. searchTaxRules(proactiveQuery)  [Pass 2]               │
│         │→ MongoDB Atlas (cosine similarity on 768-d vecs) │
│         │→ Fallback: in-memory JSON                        │
│                                                             │
│  3. De-duplicate and merge retrieved rules                  │
│                                                             │
│  4. generateJSONContent(prompt + context)                   │
│         │→ Gemini Text Model (with auto-fallback chain)    │
│                                                             │
│  5. Return structured JSON with taxSavingsSuggestions       │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                        RESPONSE                             │
│   Tax Summary · Deductions Table · Deadlines · Suggestions  │
└─────────────────────────────────────────────────────────────┘

────────────── ONE-TIME DATA PIPELINE ──────────────
tax_rules_seed.json  →  ingest_vectors.js (Gemini Embed)
  → tax_rules_with_vectors.json  →  ingest_to_mongodb.js
    → MongoDB Atlas (TaxRule collection, 768-d embeddings)
```
