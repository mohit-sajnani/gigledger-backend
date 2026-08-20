# 📄 Deep-Dive: Explanation of `scripts/ingest_vectors.js`

This document provides a detailed breakdown of the vector conversion script (`scripts/ingest_vectors.js`). It explains the **libraries used**, **why each section was built**, and **how raw tax rules are turned into vector embeddings**.

---

## 1. Libraries Used & Their Responsibilities

| Library | Type | Why It Is Used |
| :--- | :--- | :--- |
| **`@google/generative-ai`** | External (`npm`) | Official Google Gemini SDK. Provides the `GoogleGenerativeAI` class to access the `embedContent` API, converting text into 768-dimensional numerical vectors. |
| **`dotenv`** | External (`npm`) | Loads environment variables from the `.env` file into `process.env`. Prevents hardcoding secret API keys inside git-committed source code. |
| **`fs`** | Node.js Built-in | File System module. Used to read the raw `tax_rules_seed.json` file and write the generated vector database output to `tax_rules_with_vectors.json`. |
| **`path`** | Node.js Built-in | Path resolution module. Ensures file paths work consistently across all operating systems (Linux, macOS, Windows). |

---

## 2. Detailed Code Breakdown (Section by Section)

---

### Section 1: Environment Initialization & Validation

```javascript
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
  console.error('❌ ERROR: GEMINI_API_KEY is missing or not set in .env!');
  process.exit(1);
}
```

#### Why we do this:
- **`dotenv.config()`**: Must be called at the top of the file so `process.env` populates before any API calls are made.
- **Upfront Validation**: If the API key is missing or still set to the default placeholder `YOUR_GEMINI_API_KEY_HERE`, the script fails immediately with a clear error message instead of making doomed network requests.

---

### Section 2: Live API Model Auto-Discovery

```javascript
const genAI = new GoogleGenerativeAI(apiKey);

// Query Google Gemini API directly for available embedding models
let availableEmbeddingModels = [];

try {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await res.json();

  if (data.models) {
    availableEmbeddingModels = data.models
      .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('embedContent'))
      .map(m => m.name.replace('models/', ''));
  }
} catch (e) { ... }
```

#### Why we do this:
- **Prevents 404 Model Errors**: Google Gemini frequently updates its supported model names (`text-embedding-004`, `embedding-001`, `text-embedding-004:embedContent`). Hardcoding a single model name risks runtime `404 Not Found` errors if Google deprecates or changes access per API key region.
- **Filtering by Capability**: The script queries Google's REST endpoint and specifically filters models whose `supportedGenerationMethods` array contains `'embedContent'`.

---

### Section 3: Model Candidate Testing Loop

```javascript
const modelCandidates = Array.from(new Set([
  ...availableEmbeddingModels,
  'text-embedding-004',
  'embedding-001'
]));

let workingModelName = null;
let embeddingModel = null;

for (const modelName of modelCandidates) {
  try {
    const testModel = genAI.getGenerativeModel({ model: modelName });
    await testModel.embedContent('Test connection string');
    workingModelName = modelName;
    embeddingModel = testModel;
    break;
  } catch (err) { ... }
}
```

#### Why we do this:
- **Fail-Safe Mechanism**: The script iterates through candidate models and sends a lightweight string (`"Test connection string"`) to test authorization.
- **First Success Wins**: The moment a model successfully returns a vector without throwing an error, the script locks onto that model and uses it for the remainder of the dataset.

---

### Section 4: Data Ingestion & Rich Text Formatting

```javascript
const seedPath = path.resolve('data/tax_rules_seed.json');
const rawData = fs.readFileSync(seedPath, 'utf-8');
const taxRules = JSON.parse(rawData);

for (let i = 0; i < taxRules.length; i++) {
  const rule = taxRules[i];
  const textToEmbed = `${rule.title}: ${rule.content}`;
```

#### Why we combine Title and Content:
- If we only embed `rule.title` (`"Section 44ADA"`), the vector misses the numerical details (50% profit declaration, ₹75 Lakh cap).
- If we only embed `rule.content`, the vector misses key section keywords.
- Combining `${rule.title}: ${rule.content}` ensures the resulting vector captures **both exact legal keywords and semantic explanations**!

---

### Section 5: Generating Vector Embeddings & Attaching Metadata

```javascript
const result = await embeddingModel.embedContent(textToEmbed);
const vector = result.embedding.values;

embeddedRules.push({
  ...rule,
  embedding: vector,                  // Array of 768 float numbers
  vectorDimensions: vector.length,    // 768
  embeddingModelUsed: workingModelName
});
```

#### What happens here:
1. `embeddingModel.embedContent(textToEmbed)` sends the text string to Gemini's neural network.
2. Gemini returns an array of **768 floating-point numbers** (e.g., `[0.0123, -0.0451, 0.8912, ...]`).
3. The original JSON rule (containing `id`, `title`, `category`, `source_url`, `content`) is cloned, and the new `embedding` array + `vectorDimensions` are attached to it.

---

### Section 6: Persistence to Disk (`tax_rules_with_vectors.json`)

```javascript
const outputPath = path.resolve('data/tax_rules_with_vectors.json');
fs.writeFileSync(outputPath, JSON.stringify(embeddedRules, null, 2), 'utf-8');
```

#### Why we do this:
- **Performance & Cost Optimization**: Generating embeddings via API takes network time and consumes API quota.
- By saving the vector database locally to `data/tax_rules_with_vectors.json`, your Express backend can load the vectors **instantly into server memory at startup** without making redundant embedding API calls every time the server runs!

---

## 📊 Summary of Output Data Structure

The generated `data/tax_rules_with_vectors.json` file contains objects structured like this:

```json
{
  "id": "rule_44ad_presumptive",
  "title": "Presumptive Taxation for Non-Specified Businesses (Section 44AD)",
  "category": "income_tax_regime",
  "target_worker": "ride_hailing_and_delivery",
  "content": "Gig workers operating as delivery fleet partners...",
  "source_url": "https://incometaxindia.gov.in/pages/acts/income-tax-act.aspx?section=44AD",
  "embedding": [
    0.012431095,
    -0.038102914,
    0.089120491,
    "... 768 floating-point numbers total ..."
  ],
  "vectorDimensions": 768,
  "embeddingModelUsed": "text-embedding-004"
}
```

This output is now ready to be loaded by your RAG engine to perform **Cosine Similarity searches** against user queries!
