const rag = require('./rag.service');

/**
 * The category name list is real, fetched by the caller from the Category
 * collection — instructing the model to pick from it (never invent its own)
 * is what makes the "category" field in the response trustworthy, not just
 * plausible-sounding.
 */
const buildExtractionPrompt = (categoryNames) => `
You are a receipt-reading assistant for a gig worker's expense tracker.

From the attached receipt image, extract:
1. The total amount paid (a number, in the receipt's currency — assume INR unless clearly stated otherwise).
2. The date on the receipt, if legible (ISO 8601 format, e.g. "2026-08-21"). If illegible or missing, omit this field entirely — do not guess a date.
3. A short one-line description of what was purchased.
4. The single best-matching expense category, chosen ONLY from this exact list — do not invent a category name that isn't in this list, and if nothing fits well, omit the category field entirely:
${categoryNames.join(', ')}

Respond ONLY in valid JSON matching this exact structure:
{
  "amount": number,
  "date": "string (ISO 8601) or omitted",
  "description": "string",
  "category": "string (must exactly match one from the list above) or omitted"
}
`;

/**
 * Calls Gemini with the receipt image + a prompt grounded in the app's real
 * category names. Returns the raw parsed JSON — re-validation of amount,
 * date, and category against real data happens in the controller, not here.
 */
const extractReceiptData = async (imageBuffer, mimeType, categoryNames) => {
  const parts = [
    { text: buildExtractionPrompt(categoryNames) },
    { inlineData: { mimeType, data: imageBuffer.toString('base64') } },
  ];

  const rawJson = await rag.generateJSONContent(parts);
  const cleanJson = rawJson.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleanJson);
};

module.exports = { buildExtractionPrompt, extractReceiptData };
