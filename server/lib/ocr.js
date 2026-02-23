import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const OCR_MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const DOCLING_BIN = process.env.DOCLING_BIN || 'docling';
const DOCLING_TIMEOUT_MS = Number(process.env.DOCLING_TIMEOUT_MS || 120000);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || 'v1beta';
const OCR_TEXT_CHAR_LIMIT = Number(process.env.OCR_TEXT_CHAR_LIMIT || 12000);

const OCR_MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif'
};

export function parseReceiptImageDataUrl(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    base64: match[2].replace(/\s+/g, '')
  };
}

function inferAiErrorStatus(message = '') {
  const msg = String(message || '');
  if (/429|RESOURCE_EXHAUSTED|quota exceeded/i.test(msg)) return 429;
  if (/401|UNAUTHENTICATED|invalid api key/i.test(msg)) return 401;
  if (/403|PERMISSION_DENIED|forbidden/i.test(msg)) return 403;
  if (/404|NOT_FOUND/i.test(msg)) return 502;
  return 502;
}

function cleanLine(value) {
  return String(value || '')
    .replace(/\f/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

function buildAiReceiptPrompt(text) {
  return [
    'Extract every purchasable line item from the following receipt OCR text.',
    '',
    'INCLUDE:',
    '- Each individual product/item the customer bought',
    '- The final extended price for each item (qty x unit price already multiplied)',
    '- For weighted/produce items, the final computed line price only',
    '- Tax (as a separate item if present)',
    '- Service charge or gratuity (as a separate item if present)',
    '',
    'EXCLUDE (never include these as items):',
    '- Subtotal, total, grand total, balance due',
    '- Tip (voluntary, customer-written)',
    '- Savings, discounts, coupons (as standalone lines)',
    '- Payment method lines (VISA, cash, change due)',
    '- Store name, address, phone, date, cashier, register metadata',
    '- Standalone quantity or unit-price fragments that are not a final line total',
    '',
    'FORMATTING:',
    '- "name": short, readable product name (trim codes/SKUs). Use "Tax" or "Service Charge" for those lines.',
    '- "amount": positive number representing the final dollar amount for that line',
    '- "billName": derive from the store/merchant name if visible, otherwise use "Receipt"',
    '',
    '--- OCR TEXT START ---',
    String(text || '').slice(0, OCR_TEXT_CHAR_LIMIT),
    '--- OCR TEXT END ---'
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

async function runGeminiOnReceiptText(text, fileName = '') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is required for OCR item extraction.');
    err.status = 503;
    throw err;
  }

  const model = normalizeGeminiModelName(GEMINI_MODEL);
  const version = String(GEMINI_API_VERSION || 'v1beta').trim() || 'v1beta';
  const endpoint =
    `https://generativelanguage.googleapis.com/${version}/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: 'You extract accurate receipt line items from OCR text and output strict JSON.' }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: buildAiReceiptPrompt(text) }]
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
    const message = `Gemini OCR post-process failed (${version}:${model}): ${detail || response.statusText}`;
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

async function extractTextWithDocling({ base64Image, mimeType }) {
  const extension = OCR_MIME_TO_EXT[mimeType] || '.img';
  const tempFile = path.join(
    os.tmpdir(),
    `spliteasier-ocr-${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`
  );
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spliteasier-docling-'));
  const outputTextFile = path.join(outputDir, `${path.parse(tempFile).name}.txt`);
  await fs.writeFile(tempFile, Buffer.from(base64Image, 'base64'));

  try {
    await execFileAsync(
      DOCLING_BIN,
      ['--from', 'image', '--to', 'text', '--force-ocr', '--output', outputDir, tempFile],
      { timeout: DOCLING_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
    );
    return await fs.readFile(outputTextFile, 'utf8').catch(() => '');
  } catch (err) {
    if (err?.code === 'ENOENT') {
      const wrapped = new Error('Docling is not installed on the server. Install docling or set DOCLING_BIN.');
      wrapped.status = 503;
      throw wrapped;
    }
    const wrapped = new Error('Receipt OCR failed while reading the image with Docling.');
    wrapped.status = 422;
    throw wrapped;
  } finally {
    await fs.unlink(tempFile).catch(() => {});
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function extractReceiptItemsFromImage({ base64Image, mimeType, fileName = '' }) {
  const text = await extractTextWithDocling({ base64Image, mimeType });
  return runGeminiOnReceiptText(text, fileName);
}
