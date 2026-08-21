const { GoogleGenerativeAI } = require('@google/generative-ai');
const TaxRule = require('../models/TaxRule');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SIMILARITY_THRESHOLD = 0.5; // 768d compressed vectors score lower than 3072d — 0.50+ is semantically relevant

let embeddingModelName = 'gemini-embedding-001';
let discoveredEmbeddingModels = [];
let workingTextModel = null;
let discoveredTextModels = [];

// Models known to be deprecated by Google — skip these in discovery results
const DEPRECATED_MODEL_PREFIXES = ['gemini-2.5', 'gemini-2.0', 'gemini-1.0', 'gemini-1.5'];

const isDeprecated = (modelName) => DEPRECATED_MODEL_PREFIXES.some((prefix) => modelName.startsWith(prefix));

/** Extract Google's suggested replacement model from a 404 error message. */
const extractSuggestedModel = (errMessage) => {
  const match = errMessage && errMessage.match(/use\s+models\/([\w.-]+)/i);
  return match ? match[1] : null;
};

async function discoverEmbeddingModels() {
  if (discoveredEmbeddingModels.length > 0) return discoveredEmbeddingModels;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await res.json();
    if (data.models) {
      discoveredEmbeddingModels = data.models
        .filter((m) => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('embedContent'))
        .map((m) => m.name.replace('models/', ''));
    }
  } catch (e) {
    // best-effort discovery — candidate list below still has known-good fallbacks
  }
  return discoveredEmbeddingModels;
}

async function discoverTextModels() {
  if (discoveredTextModels.length > 0) return discoveredTextModels;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await res.json();
    if (data.models) {
      discoveredTextModels = data.models
        .filter(
          (m) =>
            m.supportedGenerationMethods &&
            m.supportedGenerationMethods.includes('generateContent') &&
            !m.name.includes('tts') &&
            !m.name.includes('image') &&
            !isDeprecated(m.name.replace('models/', '')),
        )
        .map((m) => m.name.replace('models/', ''));
    }
  } catch (e) {
    // best-effort discovery — candidate list below still has known-good fallbacks
  }
  return discoveredTextModels;
}

/** Generates a query embedding, trying candidate models until one succeeds. */
const getEmbeddingVector = async (queryText) => {
  const dynamicEmbedModels = await discoverEmbeddingModels();
  const candidates = Array.from(
    new Set([embeddingModelName, ...dynamicEmbedModels, 'gemini-embedding-001', 'text-embedding-004', 'embedding-001']),
  );

  let lastError = null;
  for (const modelName of candidates) {
    if (!modelName) continue;
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      // No outputDimensionality override: the ingested TaxRule vectors were
      // generated at Gemini's default size (3072 for gemini-embedding-001),
      // and cosineSimilarity requires matching lengths — a truncated query
      // vector here would silently score 0 against every stored rule.
      const queryRes = await model.embedContent({
        content: { parts: [{ text: queryText }] },
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
};

const cosineSimilarity = (vecA, vecB) => {
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
};

/**
 * Ranks TaxRule documents by cosine similarity to the query, via this app's
 * shared Mongoose connection (no second connection to a separate database —
 * ported from the reference implementation, which also supported an
 * in-memory JSON fallback and its own connection; dropped here since this
 * app always has a live DB connection before it serves any request).
 */
const searchTaxRules = async (queryText, topK = 3) => {
  const queryVector = await getEmbeddingVector(queryText);

  const dbRules = await TaxRule.find({}).lean();
  const scored = dbRules.map((rule) => ({
    ...rule,
    similarityScore: cosineSimilarity(queryVector, rule.embedding),
  }));
  scored.sort((a, b) => b.similarityScore - a.similarityScore);

  const topScored = scored.slice(0, topK);
  const aboveThreshold = topScored.filter((r) => r.similarityScore >= SIMILARITY_THRESHOLD);

  // If nothing clears the threshold, return the best match flagged low-confidence
  // rather than silently returning weak/irrelevant rules.
  const finalResults = aboveThreshold.length > 0 ? aboveThreshold : topScored.slice(0, 1).map((r) => ({ ...r, lowConfidence: true }));

  return finalResults.map(({ embedding, ...cleanRule }) => cleanRule);
};

/**
 * Calls Gemini for JSON generation, trying candidate text models until one
 * succeeds (Google's model names/availability shift over time). The prompt
 * itself is the caller's responsibility — this is just the SDK plumbing.
 *
 * Accepts either a plain string (every existing text-only caller) or an
 * array of multimodal parts (text + inlineData, for image input) — a string
 * is wrapped into a single-part array so both shapes flow through the same
 * `{ contents: [{ role: 'user', parts }] }` request, identical behavior to
 * the old string-only call for every caller that never changes.
 */
/**
 * Some Gemini models ignore responseMimeType: 'application/json' and wrap the
 * actual JSON in chain-of-thought reasoning, sometimes repeating the object
 * multiple times (draft, fenced example, final answer). A naive first-{/last-}
 * slice would span across all of those and fail to parse. Instead this walks
 * every balanced {...} / [...] span in the text and returns the LAST one that
 * parses as valid JSON — the model's final answer is always the last repeat.
 */
const extractJson = (text) => {
  let lastValid = null;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') {
      i++;
      continue;
    }

    const closeChar = ch === '{' ? '}' : ']';
    let depth = 0;
    let matchEnd = -1;
    for (let j = i; j < text.length; j++) {
      if (text[j] === ch) depth++;
      else if (text[j] === closeChar) {
        depth--;
        if (depth === 0) {
          matchEnd = j;
          break;
        }
      }
    }

    if (matchEnd === -1) {
      i++;
      continue;
    }

    // Only treat this as a top-level candidate, never descend into it to
    // look for nested "candidates" — a rateTable entry buried inside the
    // real answer must never be mistaken for a sibling repeat of it.
    const candidate = text.slice(i, matchEnd + 1);
    try {
      JSON.parse(candidate);
      lastValid = candidate;
    } catch (e) {
      // not valid JSON on its own — keep scanning
    }
    i = matchEnd + 1;
  }

  return lastValid !== null ? lastValid : text.trim();
};

const generateJSONContent = async (promptOrParts) => {
  const parts = Array.isArray(promptOrParts) ? promptOrParts : [{ text: promptOrParts }];
  const requestBody = { contents: [{ role: 'user', parts }] };

  if (workingTextModel) {
    try {
      const model = genAI.getGenerativeModel({
        model: workingTextModel,
        generationConfig: { responseMimeType: 'application/json' },
      });
      const response = await model.generateContent(requestBody);
      if (response && response.response) return extractJson(response.response.text());
    } catch (e) {
      workingTextModel = null;
    }
  }

  const dynamicModels = await discoverTextModels();
  const PREFERRED_MODELS = ['gemini-3.6-flash', 'gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-3.1-pro'];
  const candidates = Array.from(new Set([...PREFERRED_MODELS, ...dynamicModels.filter((m) => !m.includes('tts') && !isDeprecated(m))]));

  let lastError = null;
  for (let i = 0; i < candidates.length; i++) {
    const modelName = candidates[i];
    if (!modelName || modelName.includes('tts') || isDeprecated(modelName)) continue;
    try {
      let model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: 'application/json' } });

      let response;
      try {
        response = await model.generateContent(requestBody);
      } catch (jsonErr) {
        model = genAI.getGenerativeModel({ model: modelName });
        response = await model.generateContent(requestBody);
      }

      if (response && response.response) {
        workingTextModel = modelName;
        return extractJson(response.response.text());
      }
    } catch (err) {
      lastError = err;

      if (err.message && err.message.includes('404')) {
        const suggested = extractSuggestedModel(err.message);
        if (suggested && !candidates.includes(suggested) && !isDeprecated(suggested)) {
          candidates.splice(i + 1, 0, suggested);
        }
      }

      if (err.status === 429 || (err.message && err.message.includes('429'))) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  throw new Error(`Text generation model error: ${lastError ? lastError.message : 'No text model succeeded'}`);
};

module.exports = { searchTaxRules, generateJSONContent, cosineSimilarity, getEmbeddingVector };
