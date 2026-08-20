const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Runs a single chat completion forced into strict JSON mode, with a
 * request timeout so a hung OpenAI call can never hang the endpoint that
 * triggered it. Every LLM call in the agentic layer goes through here —
 * one place to keep the cost/latency guardrails consistent.
 */
async function chatJSON({ system, user, maxTokens }) {
  const response = await client.chat.completions.create(
    {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      max_tokens: maxTokens || parseInt(process.env.OPENAI_MAX_TOKENS, 10) || 1000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    { timeout: parseInt(process.env.OPENAI_TIMEOUT_MS, 10) || 15000 },
  );

  return response.choices[0].message.content;
}

module.exports = { client, chatJSON };
