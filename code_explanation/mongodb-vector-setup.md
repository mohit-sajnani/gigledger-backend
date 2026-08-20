# 🍃 MongoDB Vector Integration Guide

This document explains how your RAG system integrates with **MongoDB** and **MongoDB Atlas Vector Search**.

---

## 📌 Architecture with MongoDB

```
  [ tax_rules_seed.json ]
             │
             ▼ (Step 2: Generate Embeddings)
  [ data/tax_rules_with_vectors.json ]
             │
             ▼ (npm run ingest:mongo)
┌────────────────────────────────────────────────────────┐
│ MongoDB Database (`TaxRule` Collection)                │
│                                                        │
│  {                                                     │
│    id: "rule_44ada",                                   │
│    title: "Presumptive Tax...",                        │
│    content: "...",                                     │
│    embedding: [0.012, -0.045, ... 768 float numbers]  │
│  }                                                     │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ MongoDB Atlas Vector Search ($vectorSearch Pipeline)   │
│ Or Mongoose Cosine Similarity Fallback Engine          │
└────────────────────────────────────────────────────────┘
```

---

## 📁 Key Files Created for MongoDB Support

1. **📁 [`models/TaxRule.js`](file:///home/ankur-asrani/hackathon/models/TaxRule.js)** — Mongoose Schema with `embedding: [Number]` array.
2. **📁 [`scripts/ingest_to_mongodb.js`](file:///home/ankur-asrani/hackathon/scripts/ingest_to_mongodb.js)** — Script to upload all vector tax rules into your MongoDB database.
3. **📁 [`services/ragService.js`](file:///home/ankur-asrani/hackathon/services/ragService.js)** — Updated RAG search engine supporting MongoDB queries.

---

## 🛠️ Step-by-Step Instructions to Run MongoDB Setup

### 1️⃣ Add MongoDB URI to `.env`
Open [`.env`](file:///home/ankur-asrani/hackathon/.env) and add your connection string:
```env
GEMINI_API_KEY=AIzaSy...
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/gig_tax_db
```
*(If testing locally, use `mongodb://localhost:27017/gig_tax_db`)*

---

### 2️⃣ Install Mongoose
In your terminal, install `mongoose`:
```bash
npm install
```

---

### 3️⃣ Ingest Vector Tax Rules into MongoDB
Run the MongoDB upload script:
```bash
npm run ingest:mongo
```

Output:
```text
🍃 Uploading Vector-Indexed Tax Rules to MongoDB
⏳ Connecting to MongoDB...
✅ Connected to MongoDB successfully!
   ✅ Upserted rule [1/15]: "Presumptive Taxation for Non-Specified Businesses..."
   ...
🎉 MongoDB Ingestion Complete!
📊 Total Tax Rules Saved to MongoDB: 15
```

---

## ⚡ (Optional) Creating Vector Search Index in MongoDB Atlas

If you are using **MongoDB Atlas (Cloud)**, configure Vector Search for instant sub-millisecond vector indexing:

1. Open your **MongoDB Atlas Dashboard**.
2. Go to **Atlas Search** ──► **Create Search Index**.
3. Select **JSON Editor** under **Atlas Vector Search**.
4. Choose Database `gig_tax_db` and Collection `taxrules`.
5. Paste this index configuration:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    }
  ]
}
```
6. Name the index `vector_index` and click **Create Search Index**.

---

## 🔍 How `ragService.js` Executes MongoDB Vector Search

When a query comes into `searchTaxRules(userQueryText)`:

```javascript
// 1. Convert user query to 768-dim vector
const queryVector = (await model.embedContent(userQueryText)).embedding.values;

// 2. Execute MongoDB Atlas Vector Search Aggregation
const results = await TaxRule.aggregate([
  {
    $vectorSearch: {
      index: 'vector_index',
      path: 'embedding',
      queryVector: queryVector,
      numCandidates: 50,
      limit: 3
    }
  },
  {
    $project: {
      embedding: 0,
      score: { $meta: 'vectorSearchScore' }
    }
  }
]);
```

If running local MongoDB without an Atlas Vector index, the service automatically falls back to fetching document embeddings and executing fast Cosine Similarity in Node.js memory!
