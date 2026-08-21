const { chatJSON } = require('../config/gemini');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Sniffs the actual file signature and confirms it matches the declared
 * mimetype — a renamed/spoofed extension won't get past multer's fileFilter
 * (which only looks at the declared mimetype), so this is the real check.
 */
function bufferMatchesDeclaredType(buffer, mimetype) {
  if (buffer.length < 12) return false;

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isWebp =
    buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';

  if (mimetype === 'image/jpeg') return isJpeg;
  if (mimetype === 'image/png') return isPng;
  if (mimetype === 'image/webp') return isWebp;
  return false;
}

const SYSTEM_PROMPT = `You are a receipt-scanning assistant for a gig-worker expense tracker. You are given a photo of a receipt or invoice. Extract the transaction it represents as strict JSON — never prose, never markdown fences.

Respond ONLY with JSON matching this exact shape:
{
  "type": "income" | "expense",
  "amount": number,
  "date": "YYYY-MM-DD",
  "merchant": string | null,
  "rawDescription": string | null,
  "source": "uber" | "swiggy" | "zomato" | "ola" | "manual" | "other" | null,
  "confidence": number
}

Rules:
- Almost every receipt is an expense. Only use "income" if the document is clearly a payout/earnings statement (e.g. a driver payout summary), not a purchase receipt.
- "amount" is the final total paid, as a plain number (no currency symbol, no commas).
- "date" is the transaction date on the receipt, in YYYY-MM-DD. If no date is visible, use null.
- "merchant" is the business/vendor name as printed.
- "rawDescription" is a short human-readable summary (e.g. "Zomato Food Order", "Shell Fuel Refill").
- "source" should only be one of the enum values above if the merchant clearly matches one of those platforms; otherwise null.
- "confidence" is your own confidence in this extraction being fully correct, from 0 to 1.
- If the image isn't a legible receipt/invoice at all, set "amount" to 0 and "confidence" to 0.
- Never invent a number you can't actually read on the receipt.`;

/**
 * Runs OCR extraction on a receipt image via Gemini multimodal input and
 * returns a plain, validated JS object — never persists anything, this is a
 * "proposed" transaction the caller must still POST /api/transactions to save.
 */
async function extractReceiptData(buffer, mimetype) {
  const raw = await chatJSON({
    system: SYSTEM_PROMPT,
    user: 'Extract the transaction from this receipt image as JSON.',
    maxTokens: 500,
    imageParts: [{ inlineData: { mimeType: mimetype, data: buffer.toString('base64') } }],
  });

  const clean = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(clean);

  const type = parsed.type === 'income' ? 'income' : 'expense';
  const amount = typeof parsed.amount === 'number' && Number.isFinite(parsed.amount) && parsed.amount >= 0 ? parsed.amount : 0;
  const date = typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;
  const confidence =
    typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1
      ? parsed.confidence
      : 0;

  const VALID_SOURCES = ['uber', 'swiggy', 'zomato', 'ola', 'manual', 'other'];
  const source = VALID_SOURCES.includes(parsed.source) ? parsed.source : null;

  return {
    type,
    amount,
    date,
    merchant: typeof parsed.merchant === 'string' ? parsed.merchant : null,
    rawDescription: typeof parsed.rawDescription === 'string' ? parsed.rawDescription : null,
    source,
    confidence,
  };
}

module.exports = { ALLOWED_MIME_TYPES, bufferMatchesDeclaredType, extractReceiptData };
