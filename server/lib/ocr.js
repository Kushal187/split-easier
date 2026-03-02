const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || 'v1beta';
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
const BEDROCK_MODEL = process.env.BEDROCK_MODEL || 'anthropic.claude-3-haiku-20240307-v1:0';
const OCR_IMAGE_PROVIDER = normalizeProviderName(process.env.OCR_IMAGE_PROVIDER || 'bedrock');
const OCR_HEIC_PROVIDER = normalizeProviderName(process.env.OCR_HEIC_PROVIDER || 'gemini');
const OCR_TEXT_PROVIDER = normalizeProviderName(process.env.OCR_TEXT_PROVIDER || OCR_IMAGE_PROVIDER);
const OCR_TEXT_CHAR_LIMIT = Number(process.env.OCR_TEXT_CHAR_LIMIT || 12000);
export const OCR_MAX_RAW_TEXT_CHARS = Number(process.env.OCR_MAX_RAW_TEXT_CHARS || 50000);

function normalizeProviderName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'gemini' ? 'gemini' : 'bedrock';
}

function cleanLine(value) {
  return String(value || '')
    .replace(/\f/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeOcrText(value) {
  return String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '\n')
    .trim();
}

function inferAiErrorStatus(message = '') {
  const msg = String(message || '');
  if (/429|RESOURCE_EXHAUSTED|quota exceeded|throttl/i.test(msg)) return 429;
  if (/400|VALIDATION|bad request/i.test(msg)) return 400;
  if (/401|UNAUTHENTICATED|invalid api key|unauthorized/i.test(msg)) return 401;
  if (/403|PERMISSION_DENIED|forbidden|accessdenied/i.test(msg)) return 403;
  if (/404|NOT_FOUND/i.test(msg)) return 502;
  if (/500|internal/i.test(msg)) return 502;
  if (/503|unavailable|overloaded/i.test(msg)) return 503;
  return 502;
}

function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const cleaned = value
    .replace(/[Oo]/g, '0')
    .replace(/[Il]/g, '1')
    .replace(/[^0-9.,-]/g, '')
    .trim();
  if (!cleaned) return NaN;
  const normalized = cleaned.includes(',') && !cleaned.includes('.')
    ? cleaned.replace(/,/g, '.')
    : cleaned.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function safeParseJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  const firstObj = trimmed.indexOf('{');
  const lastObj = trimmed.lastIndexOf('}');
  if (firstObj >= 0 && lastObj > firstObj) {
    try {
      return JSON.parse(trimmed.slice(firstObj, lastObj + 1));
    } catch {}
  }

  const firstArr = trimmed.indexOf('[');
  const lastArr = trimmed.lastIndexOf(']');
  if (firstArr >= 0 && lastArr > firstArr) {
    try {
      return JSON.parse(trimmed.slice(firstArr, lastArr + 1));
    } catch {}
  }

  return null;
}

function makeDefaultBillName(fileName = '') {
  const withoutExt = String(fileName || '').replace(/\.[^.]+$/, '').trim();
  return withoutExt || 'Receipt';
}

function normalizeGeminiModelName(model) {
  return String(model || '').trim().replace(/^models\//, '');
}

function buildAiReceiptInstructions() {
  return [
    'Extract every purchasable line item from this receipt.',
    '',
    'INCLUDE:',
    '- Each individual product/item the customer bought',
    '- The final extended price for each item (qty x unit price already multiplied)',
    '- For weighted/produce items, the final computed line price only',
    '- Tax (as a separate item if present)',
    '- Service charge or gratuity (as a separate item if present)',
    '- Tip (voluntary, customer-written as a separate item if present)',
    '',
    'EXCLUDE (never include these as items):',
    '- Subtotal, total, grand total, balance due',
    '- Savings, discounts, coupons (as standalone lines)',
    '- Payment method lines (VISA, cash, change due)',
    '- Store name, address, phone, date, cashier, register metadata',
    '- Standalone quantity or unit-price fragments that aren\'t a final line total',
    '',
    'FORMATTING:',
    '- "name": short, readable product name (trim codes/SKUs). Use "Tax", "Service Charge", or "Tip" for those lines.',
    '- "amount": positive number representing the final dollar amount for that line',
    '- "billName": derive from the store/merchant name if visible, otherwise use "Receipt"',
  ].join('\n');
}

function buildAiReceiptPrompt(text) {
  const clippedText = String(text || '').slice(0, OCR_TEXT_CHAR_LIMIT);
  return [
    buildAiReceiptInstructions(),
    '',
    'Use the following OCR text as supporting context when extracting the receipt items.',
    '',
    '--- OCR TEXT START ---',
    clippedText,
    '--- OCR TEXT END ---'
  ].join('\n');
}

function buildAiReceiptImagePrompt() {
  return [
    buildAiReceiptInstructions(),
    '',
    'Read the attached receipt image directly and return strict JSON only.'
  ].join('\n');
}

function findCandidateItemsArray(root) {
  const direct = root?.items ?? root?.lineItems ?? root?.products ?? root?.entries ?? null;
  if (Array.isArray(direct)) return direct;
  if (!root || typeof root !== 'object' || Array.isArray(root)) return [];

  const candidates = Object.values(root).filter((v) => Array.isArray(v));
  for (const arr of candidates) {
    if (!arr.length) continue;
    if (arr.every((x) => x && typeof x === 'object')) return arr;
  }
  return [];
}

function normalizeAiItem(item) {
  if (!item || typeof item !== 'object') return null;
  const rawName = item.name ?? item.item ?? item.description ?? item.product ?? item.title ?? '';
  const name = cleanLine(rawName);
  const amount = parseAmount(item.amount ?? item.price ?? item.total ?? item.cost ?? item.lineTotal);
  if (!name || !Number.isFinite(amount) || amount <= 0) return null;
  if (/^(?:subtotal|sub total|total|grand total|balance due)$/i.test(name)) return null;
  return {
    name: name.slice(0, 120),
    amount: Math.round(amount * 100) / 100
  };
}

function normalizeAiPayload(payload, fileName = '') {
  const root = Array.isArray(payload) ? { items: payload } : (payload || {});
  const billNameRaw = typeof root.billName === 'string' ? cleanLine(root.billName) : '';
  const candidateItems = findCandidateItemsArray(root);
  const items = candidateItems.map(normalizeAiItem).filter(Boolean);
  if (!items.length) return null;

  const deduped = [];
  const seen = new Set();
  items.forEach((item) => {
    const key = `${item.name.toLowerCase()}|${item.amount.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });

  return {
    billName: billNameRaw || makeDefaultBillName(fileName),
    items: deduped.slice(0, 120)
  };
}

function buildBedrockEndpoint(model) {
  return `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com/model/${encodeURIComponent(model)}/converse`;
}

function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is required for Gemini OCR item extraction.');
    err.status = 503;
    throw err;
  }
  return apiKey;
}

function getBedrockApiKey() {
  const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.BEDROCK_API_KEY;
  if (!apiKey) {
    const err = new Error('AWS_BEARER_TOKEN_BEDROCK or BEDROCK_API_KEY is required for Bedrock OCR item extraction.');
    err.status = 503;
    throw err;
  }
  return apiKey;
}

async function runGeminiOnReceiptText(text, fileName = '') {
  const apiKey = getGeminiApiKey();
  const model = normalizeGeminiModelName(GEMINI_MODEL);
  const version = String(GEMINI_API_VERSION || 'v1beta').trim() || 'v1beta';
  const endpoint =
    `https://generativelanguage.googleapis.com/${version}/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  return runGeminiReceiptRequest({
    endpoint,
    version,
    model,
    fileName,
    parts: [{ text: buildAiReceiptPrompt(text) }],
    systemInstruction: 'You extract accurate receipt line items from OCR text and output strict JSON.',
    failureLabel: 'Gemini OCR post-process failed'
  });
}

async function runGeminiOnReceiptImage({ imageDataUrl, mimeType = '', fileName = '' }) {
  const apiKey = getGeminiApiKey();
  const base64 = extractBase64Payload(imageDataUrl);
  if (!base64) {
    const err = new Error('No receipt image was provided.');
    err.status = 400;
    throw err;
  }

  const model = normalizeGeminiModelName(GEMINI_MODEL);
  const version = String(GEMINI_API_VERSION || 'v1beta').trim() || 'v1beta';
  const endpoint =
    `https://generativelanguage.googleapis.com/${version}/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  return runGeminiReceiptRequest({
    endpoint,
    version,
    model,
    fileName,
    parts: [
      { text: buildAiReceiptImagePrompt() },
      {
        inlineData: {
          mimeType: inferMimeTypeFromImageDataUrl(imageDataUrl, mimeType),
          data: base64
        }
      }
    ],
    systemInstruction: 'You extract accurate receipt line items directly from receipt images and output strict JSON.',
    failureLabel: 'Gemini receipt-image extraction failed'
  });
}

async function runGeminiReceiptRequest({
  endpoint,
  version,
  model,
  fileName = '',
  parts,
  systemInstruction,
  failureLabel
}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [
        {
          role: 'user',
          parts
        }
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            billName: { type: 'STRING' },
            items: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING' },
                  amount: { type: 'NUMBER' }
                },
                required: ['name', 'amount']
              }
            }
          },
          required: ['items']
        }
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const message = `${failureLabel} (${version}:${model}): ${detail || response.statusText}`;
    const err = new Error(message);
    err.status = inferAiErrorStatus(message);
    throw err;
  }

  const data = await response.json();
  const textOut = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n');
  const payload = safeParseJson(textOut);
  const normalized = normalizeAiPayload(payload, fileName);
  if (!normalized?.items?.length) {
    const preview = cleanLine(textOut).slice(0, 320);
    const err = new Error(
      `Gemini OCR returned parseable response but no valid items (${version}:${model}). Response preview: ${preview}`
    );
    err.status = 422;
    throw err;
  }

  return normalized;
}

async function runBedrockOnReceiptText(text, fileName = '') {
  return runBedrockReceiptRequest({
    fileName,
    content: [{ text: buildAiReceiptPrompt(text) }],
    systemInstruction: 'You extract accurate receipt line items from OCR text and output strict JSON.',
    failureLabel: 'Bedrock OCR post-process failed'
  });
}

async function runBedrockOnReceiptImage({ imageDataUrl, mimeType = '', fileName = '' }) {
  const base64 = extractBase64Payload(imageDataUrl);
  if (!base64) {
    const err = new Error('No receipt image was provided.');
    err.status = 400;
    throw err;
  }

  const format = inferBedrockImageFormat({
    imageDataUrl,
    mimeType,
    fileName
  });

  return runBedrockReceiptRequest({
    fileName,
    content: [
      { text: buildAiReceiptImagePrompt() },
      {
        image: {
          format,
          source: {
            bytes: base64
          }
        }
      }
    ],
    systemInstruction: 'You extract accurate receipt line items directly from receipt images and output strict JSON.',
    failureLabel: 'Bedrock receipt-image extraction failed'
  });
}

async function runBedrockReceiptRequest({
  fileName = '',
  content,
  systemInstruction,
  failureLabel
}) {
  const apiKey = getBedrockApiKey();
  const endpoint = buildBedrockEndpoint(BEDROCK_MODEL);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      system: [{ text: systemInstruction }],
      messages: [
        {
          role: 'user',
          content
        }
      ],
      inferenceConfig: {
        temperature: 0,
        maxTokens: 2000
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const message = `${failureLabel} (${BEDROCK_REGION}:${BEDROCK_MODEL}): ${detail || response.statusText}`;
    const err = new Error(message);
    err.status = inferAiErrorStatus(message);
    throw err;
  }

  const data = await response.json();
  const textOut = extractBedrockResponseText(data);
  const payload = safeParseJson(textOut);
  const normalized = normalizeAiPayload(payload, fileName);
  if (!normalized?.items?.length) {
    const preview = cleanLine(textOut).slice(0, 320);
    const err = new Error(
      `Bedrock OCR returned parseable response but no valid items (${BEDROCK_REGION}:${BEDROCK_MODEL}). Response preview: ${preview}`
    );
    err.status = 422;
    throw err;
  }

  return normalized;
}

function extractBedrockResponseText(data) {
  const messageContent = data?.output?.message?.content;
  if (!Array.isArray(messageContent)) return '';
  return messageContent
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

function extractBase64Payload(imageDataUrl) {
  const raw = String(imageDataUrl || '').trim();
  if (!raw) return '';
  return raw.replace(/^data:[^;]+;base64,/, '');
}

function inferMimeTypeFromImageDataUrl(imageDataUrl, fallback = '') {
  const match = String(imageDataUrl || '').match(/^data:([^;]+);base64,/i);
  return match?.[1] || String(fallback || '').trim() || 'image/jpeg';
}

function inferFileExtension(fileName = '') {
  const match = String(fileName || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

function isHeicLike({ mimeType = '', fileName = '', imageDataUrl = '' }) {
  const normalizedMime = inferMimeTypeFromImageDataUrl(imageDataUrl, mimeType).toLowerCase();
  const extension = inferFileExtension(fileName);
  return normalizedMime === 'image/heic' ||
    normalizedMime === 'image/heif' ||
    extension === 'heic' ||
    extension === 'heif';
}

function inferBedrockImageFormat({ imageDataUrl = '', mimeType = '', fileName = '' }) {
  const normalizedMime = inferMimeTypeFromImageDataUrl(imageDataUrl, mimeType).toLowerCase();
  const extension = inferFileExtension(fileName);

  if (normalizedMime === 'image/jpeg' || normalizedMime === 'image/jpg' || extension === 'jpg' || extension === 'jpeg') {
    return 'jpeg';
  }
  if (normalizedMime === 'image/png' || extension === 'png') {
    return 'png';
  }
  if (normalizedMime === 'image/webp' || extension === 'webp') {
    return 'webp';
  }
  if (normalizedMime === 'image/gif' || extension === 'gif') {
    return 'gif';
  }

  const err = new Error('Unsupported image format for Bedrock. Use JPG, PNG, WEBP, or GIF, or route HEIC through Gemini.');
  err.status = 400;
  throw err;
}

function getImageProvider({ imageDataUrl = '', mimeType = '', fileName = '' }) {
  if (isHeicLike({ imageDataUrl, mimeType, fileName })) {
    return OCR_HEIC_PROVIDER;
  }
  return OCR_IMAGE_PROVIDER;
}

export async function extractReceiptItemsFromOcrText({ text, fileName = '' }) {
  const cleaned = sanitizeOcrText(text);
  if (!cleaned) {
    const err = new Error('No OCR text was provided.');
    err.status = 400;
    throw err;
  }
  const bounded = cleaned.slice(0, OCR_MAX_RAW_TEXT_CHARS);
  if (OCR_TEXT_PROVIDER === 'gemini') {
    return runGeminiOnReceiptText(bounded, fileName);
  }
  return runBedrockOnReceiptText(bounded, fileName);
}

export async function extractReceiptItemsFromImage({ imageDataUrl, mimeType = '', fileName = '' }) {
  const base64 = extractBase64Payload(imageDataUrl);
  if (!base64) {
    const err = new Error('No receipt image was provided.');
    err.status = 400;
    throw err;
  }

  const provider = getImageProvider({ imageDataUrl, mimeType, fileName });
  if (provider === 'gemini') {
    return runGeminiOnReceiptImage({ imageDataUrl, mimeType, fileName });
  }
  return runBedrockOnReceiptImage({ imageDataUrl, mimeType, fileName });
}
