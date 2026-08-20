# How RAG (Retrieval-Augmented Generation) Works Under the Hood

---

## 🔄 The 3-Phase RAG Pipeline Overview

```
  Phase 1: INDEXING (One-time setup)
  Tax Documents ──► [Chunking] ──► [Embedding Model] ──► Vector Database

  Phase 2: RETRIEVAL (When user asks a question)
  User Query ──────► [Embedding Model] ──► [Cosine Similarity] ──► Top-K Tax Rules

  Phase 3: GENERATION (Creating the answer)
  Top-K Rules + User Query ──► [LLM System Prompt] ──► Grounded Answer + Rule Citations
```

---

## Phase 1: Ingestion & Indexing (Preparing Knowledge)

Before any user asks a question, your system processes your raw documents (e.g., tax codes, PDF guides, JSON rules):

### 1. Chunking (Splitting Text)
- Large tax documents are too big to search efficiently.
- You split them into small, self-contained paragraphs (~200 to 500 words).
- *Example Chunk*:
  > `"Rule #002: Cab drivers and delivery workers can claim fuel and maintenance as business expenses under Section 37."`

### 2. Vector Embedding (Converting Text to Geometry)
- You pass each chunk to an **Embedding Model** (e.g., OpenAI `text-embedding-3-small` or Gemini `text-embedding-004`).
- The model converts text into a **list of floating-point numbers (a Vector)** representing its **semantic meaning** (e.g., `[0.012, -0.451, 0.892, ...]`).

> 💡 **Why Embeddings are Magic**:
> Words with similar meanings end up close to each other in vector space!
> - `"Fuel costs"` and `"Petrol expense"` will have vectors that point in almost the **exact same mathematical direction**, even though they share no identical words.

### 3. Storing in Vector DB
- You store the chunk's text, its metadata (rule title, URL), and its embedding vector in a **Vector Database** (e.g., MongoDB Atlas Vector Search, Pinecone, or an in-memory array for hackathons).

---

## Phase 2: Retrieval (Finding the Right Info)

When a gig worker asks: *"Can I claim gas receipts for my Uber rides?"*

### 1. Query Embedding
- The app converts the user's question into a vector using the **same** embedding model.

### 2. Similarity Search (Cosine Similarity)
- The database calculates the mathematical angle (cosine distance) between the **query vector** and **all stored tax chunk vectors**.

```
  Query Vector:  "Can I claim gas receipts for Uber?"
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Rule #001        Rule #002        Rule #003
 (Property Tax)   (Vehicle Fuel)   (Cryptocurrency)
   Score: 0.12      Score: 0.91      Score: 0.05
       ❌               ✅                ❌
```

### 3. Top-K Fetching
- The system picks the top $K$ (usually top 2 or 3) chunks with the highest similarity scores (e.g., Score > 0.80).

---

## Phase 3: Generation (Creating the Answer with Proof)

Now that you have the relevant tax rules, you combine them into a **System Prompt** for the LLM:

```text
System Prompt:
You are an expert tax advisor. Answer the user question strictly using ONLY 
the context provided below. Always cite the Rule ID.

CONTEXT RULES RETRIEVED FROM DB:
Rule #002: Cab drivers and delivery workers can claim fuel and maintenance 
as business expenses under Section 37. Source: https://incometax.gov/rule002

USER QUESTION:
Can I claim gas receipts for my Uber rides?
```

### What the LLM Does:
Instead of relying on its memory, the LLM reads the context provided in the prompt, extracts the fact, and generates a grounded response:

> **AI Response**: 
> Yes, you can claim gas receipts for your Uber rides. Cab drivers are permitted to claim fuel and maintenance as business expenses. 
> 
> 📜 **Source**: *Rule #002 (Income Tax Section 37)*

---

## Summary: Why This Architecture Solves Your Hackathon Requirements

| Problem with Standard LLM | How RAG Solves It |
| :--- | :--- |
| **Hallucinates fake tax rates** | Constrained to answer ONLY using retrieved context. |
| **No proof or sources** | Source metadata is attached directly to the retrieved vector chunk. |
| **Outdated knowledge** | Updating tax laws takes 5 seconds (just add a new chunk vector to your DB). |
