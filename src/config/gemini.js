const { GoogleGenerativeAI } = require('@google/generative-ai');

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Runs a single generation forced into strict JSON mode, with a request
 * timeout so a hung Gemini call can never hang the endpoint that triggered
 * it. Every LLM call in the agentic layer goes through here — one place to
 * keep the cost/latency guardrails consistent.
 */
async function chatJSON({ system, user, maxTokens }) {
  const model = client.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
    systemInstruction: system,
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: maxTokens || parseInt(process.env.GEMINI_MAX_TOKENS, 10) || 1000,
    },
  });

  const controller = new AbortController();
  const timeoutMs = parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await model.generateContent(
      { contents: [{ role: 'user', parts: [{ text: user }] }] },
      { signal: controller.signal },
    );
    return result.response.text();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { client, chatJSON };
