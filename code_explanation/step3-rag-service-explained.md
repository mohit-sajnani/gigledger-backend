# 📄 Step 3 Implementation Plan & Code Explanation: RAG Service (`services/ragService.js`)

This document provides a complete **implementation plan** and **deep-dive code explanation** for **Step 3: Building the RAG Search & Tax Calculation Engine** in `services/ragService.js`.

---

## 📌 Implementation Plan Overview

```
                          ┌────────────────────────────────────────┐
                          │  data/tax_rules_with_vectors.json      │
                          │  (Pre-computed vectors from Step 2)    │
                          └───────────────────┬────────────────────┘
                                              │ 1. Read on Server Startup
                                              ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Express Server RAM: vectorStore Array (15 Vector-Indexed Tax Rules)                   │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                              ▲
                                              │ 2. Query Embedding Match
┌───────────────────────────┐                 │
│ User Request / Expenses   │ ───────────────► 3. Calculate Cosine Similarity
└───────────────────────────┘                 │
                                              ▼
                          ┌────────────────────────────────────────┐
                          │  Top-3 Relevant Tax Rules (Retrieved)  │
                          └───────────────────┬────────────────────┘
                                              │ 4. Context Injection
                                              ▼
                          ┌────────────────────────────────────────┐
                          │  LLM System Prompt (Gemini 1.5 Flash)  │
                          │  "Answer strictly using context + cite"│
                          └───────────────────┬────────────────────┘
                                              │ 5. Structured JSON Output
                                              ▼
                          ┌────────────────────────────────────────┐
                          │  Tax Report + Citations + Source URLs  │
                          └────────────────────────────────────────┘
```

---

## 🛠️ Step 3 Technical Goals

1. **In-Memory Speed**: Load pre-computed vector database (`data/tax_rules_with_vectors.json`) into RAM once on server startup.
2. **Mathematical Vector Matching**: Execute Cosine Similarity search to retrieve the top 3 most relevant tax rules for any query or transaction list.
3. **Context-Injected Grounded Prompting**: Force Gemini 1.5 Flash to compute tax liability strictly based on retrieved rules.
4. **Transparency & Citations**: Attach official tax `ruleId`, `ruleTitle`, and `sourceUrl` to every generated deduction.

---

## 📚 Libraries Used in Step 3

| Library | Type | Purpose in Step 3 |
| :--- | :--- | :--- |
| **`@google/generative-ai`** | External (`npm`) | Used to (1) convert user query strings into vectors via `embedContent()`, and (2) generate final JSON tax reports via `generateContent()`. |
| **`fs`** | Node.js Built-in | Reads `data/tax_rules_with_vectors.json` from disk into server RAM. |
| **`path`** | Node.js Built-in | Constructs cross-platform file paths (`data/tax_rules_with_vectors.json`). |
| **`dotenv`** | External (`npm`) | Securely loads `GEMINI_API_KEY` from `.env`. |

---

## 🔍 Section-by-Section Code Explanation

---

### Section 1: Mathematical Cosine Similarity Helper

```javascript
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
```

#### Why we use Cosine Similarity:
- **Formula**:
  $$\text{Cosine Similarity} = \frac{\mathbf{A} \cdot \mathbf{B}}{\|\mathbf{A}\| \|\mathbf{B}\|}$$
- **Why Cosine instead of Euclidean Distance?**
  Euclidean distance measures straight-line distance, which is sensitive to sentence length. Cosine similarity measures the **angle** between two vectors, ignoring length differences and focusing 100% on **conceptual direction/meaning**.
- **Score Range**:
  - `1.0`: Identical semantic meaning.
  - `0.0`: Completely unrelated concepts.
  - `-1.0`: Opposite meaning.

---

### Section 2: Loading Vector Database into Server Memory

```javascript
let vectorStore = [];
let embeddingModelName = 'text-embedding-004';

export function initializeVectorStore() {
  const filePath = path.resolve('data/tax_rules_with_vectors.json');
  const rawData = fs.readFileSync(filePath, 'utf-8');
  vectorStore = JSON.parse(rawData);
  console.log(`⚡ Loaded ${vectorStore.length} vector-indexed tax rules into memory.`);
}
```

#### Why we do this:
- Reading from disk or database on every single API request is slow.
- Since tax rules don't change every second, storing `vectorStore` in server RAM allows **sub-millisecond similarity searches** across all 15 rules!

---

### Section 3: Semantic Vector Retrieval (`searchTaxRules`)

```javascript
export async function searchTaxRules(queryText, topK = 3) {
  if (vectorStore.length === 0) initializeVectorStore();

  // 1. Generate query vector using same embedding model
  const model = genAI.getGenerativeModel({ model: embeddingModelName });
  const queryRes = await model.embedContent(queryText);
  const queryVector = queryRes.embedding.values;

  // 2. Calculate Cosine Similarity against all stored tax rules
  const scoredRules = vectorStore.map((rule) => ({
    ...rule,
    similarityScore: cosineSimilarity(queryVector, rule.embedding),
  }));

  // 3. Sort rules descending by score
  scoredRules.sort((a, b) => b.similarityScore - a.similarityScore);

  // 4. Return Top-K matches without raw vector arrays
  return scoredRules.slice(0, topK).map(({ embedding, ...cleanRule }) => cleanRule);
}
```

#### Why we strip `embedding` before returning:
- The vector array contains 768 floating-point numbers per rule.
- Returning raw embeddings over HTTP bloats the network payload by ~50KB per response.
- We use `({ embedding, ...cleanRule }) => cleanRule` to keep HTTP responses lean while returning rule IDs, titles, contents, and source URLs.

---

### Section 4: Grounded Prompting & Tax Estimation (`calculateTaxWithRAG`)

```javascript
export async function calculateTaxWithRAG(userEarnings, userExpenses) {
  // Step A: Retrieve Top 3 matching tax rules
  const retrievedRules = await searchTaxRules(searchQuery, 3);

  // Step B: Inject context into system prompt
  const contextText = retrievedRules
    .map((r, idx) => `[Rule ${idx + 1}] ID: ${r.id}\nTitle: ${r.title}\nContent: ${r.content}\nOfficial Source: ${r.source_url}`)
    .join('\n\n');

  const prompt = `
You are an expert, audit-compliant Tax AI Advisor for gig workers.
CRITICAL INSTRUCTION: Base your calculations ONLY on the tax rules provided below.
For EVERY deduction, cite the exact Rule ID, Title, and Source URL.

USER FINANCIAL PROFILE: ...
RETRIEVED TAX RULES CONTEXT: ${contextText}
`;

  // Step C: Force JSON Output using Gemini 1.5 Flash
  const generativeModel = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: { responseMimeType: 'application/json' }
  });

  const response = await generativeModel.generateContent(prompt);
  return {
    taxReport: JSON.parse(response.response.text()),
    retrievedRules: retrievedRules
  };
}
```

#### Why we use `responseMimeType: 'application/json'`:
- Standard LLM text responses often include markdown codeblocks (````json ... ````) or conversational filler text like *"Here is your tax calculation..."*.
- By configuring `responseMimeType: 'application/json'`, Gemini guarantees raw, valid JSON output that can be directly parsed with `JSON.parse()`.

---

## 🎯 Verification Plan for Step 3

You can test `services/ragService.js` directly by creating a quick test script `scripts/test_rag.js`:

```javascript
import { calculateTaxWithRAG } from '../services/ragService.js';

async function test() {
  const result = await calculateTaxWithRAG(
    { totalGross: 650000 },
    [
      { description: 'HPCL Petrol Pump Fuel for Uber rides', amount: 25000 },
      { description: 'Figma and Adobe Creative Cloud subscription', amount: 12000 }
    ]
  );
  console.log('RAG Tax Result:', JSON.stringify(result, null, 2));
}

test();
```

Running this will output a grounded tax calculation complete with rule IDs and official source links!
