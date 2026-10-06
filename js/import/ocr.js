// Local OCR of bank screenshots with tesseract.js (heb+eng, language files served from /vendor).
// Nothing leaves the computer; the image is only held in memory while it is processed.
import { parseAmount, parseDate, round2 } from '../format.js';

// ---------- 1. image pre-processing ----------

/** Upscale ×2–3, grayscale, stretch contrast, Otsu threshold. Returns a canvas. */
export async function preprocess(file) {
  const bmp = await createImageBitmap(file);
  let scale = Math.min(3, Math.max(2, 3000 / bmp.width));
  scale = Math.min(scale, 8000 / Math.max(bmp.width, bmp.height)); // browser canvas limits
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const g = (px[j] * 299 + px[j + 1] * 587 + px[j + 2] * 114) / 1000;
    gray[i] = g;
    hist[gray[i]]++;
    sum += g;
  }
  const invert = sum / n < 110; // dark-mode screenshot: light text on dark background

  // contrast stretch between the 2nd and 98th percentile
  const pct = (p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * p) return v; } return 255; };
  const lo = pct(0.02), hi = Math.max(pct(0.98), lo + 1);
  const stretched = new Uint32Array(256);
  for (let v = 0; v < 256; v++) {
    let s = Math.round(((v - lo) * 255) / (hi - lo));
    s = Math.max(0, Math.min(255, s));
    stretched[v] = invert ? 255 - s : s;
  }
  const hist2 = new Uint32Array(256);
  for (let i = 0; i < n; i++) { gray[i] = stretched[gray[i]]; hist2[gray[i]]++; }

  // Otsu threshold
  let total = 0;
  for (let v = 0; v < 256; v++) total += v * hist2[v];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let v = 0; v < 256; v++) {
    wB += hist2[v];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += v * hist2[v];
    const mB = sumB / wB, mF = (total - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = v; }
  }
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const b = gray[i] > threshold ? 255 : 0;
    px[j] = px[j + 1] = px[j + 2] = b;
    px[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---------- 2. tesseract worker ----------

let workerPromise = null;
let progressCb = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`טעינת ${src} נכשלה`));
    document.head.appendChild(s);
  });
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (!window.Tesseract) await loadScript('vendor/tesseract/tesseract.min.js');
      const abs = (p) => new URL(p, location.href).href;
      const worker = await window.Tesseract.createWorker('heb+eng', 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract-core'),
        langPath: abs('vendor/lang'),
        gzip: true,
        logger: (m) => progressCb?.(m),
      });
      await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' });
      return worker;
    })().catch((err) => { workerPromise = null; throw err; });
  }
  return workerPromise;
}

const STATUS_HE = {
  'loading tesseract core': 'טוען מנוע זיהוי',
  'initializing tesseract': 'מאתחל',
  'loading language traineddata': 'טוען עברית ואנגלית',
  'initializing api': 'מאתחל',
  'recognizing text': 'מזהה טקסט',
};

/** OCR one image file. onProgress(text, fraction) */
export async function ocrImage(file, onProgress) {
  onProgress?.('מעבד תמונה', 0);
  const canvas = await preprocess(file);
  progressCb = (m) => onProgress?.(STATUS_HE[m.status] || m.status, m.progress || 0);
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  progressCb = null;
  const lines = (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  return { lines: lines.length ? lines : data.lines || [], width: canvas.width, text: data.text };
}

// ---------- 3. turning OCR lines into transactions ----------

const BIDI = /[‎‏‪-‮⁦-⁩]/g;
const DATE_RE = /^\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?$/;
const AMOUNT_RE = /^[-−]?₪?[-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?₪?-?$/;

function classify(word) {
  const raw = word.text.replace(BIDI, '').replace(/^[|:;,'"()[\]]+|[|:;'"()[\]]+$/g, '');
  const x = (word.bbox.x0 + word.bbox.x1) / 2;
  if (DATE_RE.test(raw)) {
    const iso = parseDate(raw);
    if (iso) return { kind: 'date', iso, x, raw };
  }
  // an amount must have a decimal point or a ₪ sign, so plain numbers (card digits, references) are text
  if (AMOUNT_RE.test(raw) && (/\.\d{2}/.test(raw) || raw.includes('₪'))) {
    const v = parseAmount(raw);
    if (isFinite(v) && v !== 0) return { kind: 'amount', value: v, x, raw };
    if (v === 0) return { kind: 'skip', x };
  }
  // lone symbols and single digits are usually a misread ₪ or table border
  if (/^₪$|^[-–—|]+$|^\d$/.test(raw) || !raw) return { kind: 'skip', x };
  return { kind: 'text', text: raw, x, conf: word.confidence };
}

/**
 * OCR sometimes glues a date to the next column ("02/10/2026₪0"). Split such a word into
 * the date and the rest, dividing the bounding box in proportion to the characters.
 */
function splitGlued(word) {
  const raw = word.text.replace(BIDI, '');
  const m = raw.match(/^(.*?)(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})(.*)$/);
  if (!m || (!m[1] && !m[3])) return [word];
  const { x0, x1 } = word.bbox;
  const per = (x1 - x0) / raw.length;
  const parts = [];
  let pos = x0;
  for (const text of [m[1], m[2], m[3]]) {
    if (text) parts.push({ ...word, text, bbox: { ...word.bbox, x0: pos, x1: pos + per * text.length } });
    pos += per * text.length;
  }
  return parts;
}

/** Group x-positions into columns. Returns columns sorted right-to-left: [{x, samples}] */
function clusterColumns(points, width) {
  const sorted = [...points].sort((a, b) => b.x - a.x);
  const gap = width * 0.04;
  const cols = [];
  for (const p of sorted) {
    const col = cols.find((c) => Math.abs(c.x - p.x) < gap);
    if (col) { col.items.push(p); col.x = col.items.reduce((s, i) => s + i.x, 0) / col.items.length; }
    else cols.push({ x: p.x, items: [p] });
  }
  return cols
    .filter((c) => c.items.length >= Math.max(1, Math.round(sorted.length * 0.05)))
    .sort((a, b) => b.x - a.x)
    .map((c) => ({ x: c.x, samples: c.items.slice(0, 3).map((i) => i.raw) }));
}

/** Analyse OCR lines: tokens per line + detected date/amount columns. */
export function analyseLines(ocr) {
  const lines = [];
  for (const line of ocr.lines) {
    const tokens = (line.words || []).flatMap(splitGlued).map(classify);
    const dates = tokens.filter((t) => t.kind === 'date');
    const amounts = tokens.filter((t) => t.kind === 'amount');
    if (!dates.length && !amounts.length) continue; // headers, titles, noise
    const words = tokens.filter((t) => t.kind === 'text').sort((a, b) => b.x - a.x); // RTL order
    const confs = (line.words || []).map((w) => w.confidence);
    lines.push({
      dates,
      amounts,
      text: words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim(),
      conf: confs.length ? confs.reduce((s, c) => s + c, 0) / confs.length : 0,
    });
  }
  const dateCols = clusterColumns(lines.flatMap((l) => l.dates), ocr.width);
  const amountCols = clusterColumns(lines.flatMap((l) => l.amounts), ocr.width);
  return { lines, dateCols, amountCols, width: ocr.width };
}

/**
 * Default column roles.
 * date: index of the date column (0 = rightmost).
 * amounts[i]: 'expense' | 'signed' | 'debit' | 'credit' | 'ignore' for amount column i (0 = rightmost).
 */
export function defaultMapping(analysis, kind) {
  const n = analysis.amountCols.length;
  const amounts = Array(n).fill('ignore');
  if (n) {
    if (kind === 'credit') amounts[n - 1] = 'expense'; // charge amount is the leftmost column
    else amounts[0] = 'signed'; // first amount after the description; the balance is further left
  }
  return { date: 0, amounts };
}

export const AMOUNT_ROLES = {
  expense: 'סכום חיוב (הוצאה, מינוס = זיכוי)',
  signed: 'סכום (מינוס = הוצאה, פלוס = הכנסה)',
  debit: 'חובה (הוצאה)',
  credit: 'זכות (הכנסה)',
  ignore: 'להתעלם (יתרה וכו\')',
};

function nearest(tokens, col, width) {
  if (!col) return null;
  let best = null;
  for (const t of tokens) {
    const d = Math.abs(t.x - col.x);
    if (d < width * 0.05 && (!best || d < Math.abs(best.x - col.x))) best = t;
  }
  return best;
}

/** Build review rows from an analysis + mapping. */
export function buildRows(analysis, mapping, kind) {
  const { lines, dateCols, amountCols, width } = analysis;
  const rows = [];
  for (const l of lines) {
    const dateTok = nearest(l.dates, dateCols[mapping.date], width) || l.dates[0] || null;
    let amount = null;
    let type = 'expense';
    let refund = false;
    mapping.amounts.forEach((role, i) => {
      if (role === 'ignore' || amount != null) return;
      const tok = nearest(l.amounts, amountCols[i], width);
      if (!tok) return;
      if (role === 'expense') { amount = Math.abs(tok.value); refund = tok.value < 0; }
      if (role === 'signed') { amount = Math.abs(tok.value); type = tok.value < 0 ? 'expense' : 'income'; }
      if (role === 'debit') { amount = Math.abs(tok.value); type = 'expense'; }
      if (role === 'credit') { amount = Math.abs(tok.value); type = 'income'; }
    });
    if (amount == null && !mapping.amounts.some((r) => r !== 'ignore') && l.amounts.length) {
      amount = Math.abs(l.amounts[0].value);
    }
    if (kind === 'credit') type = 'expense';
    const uncertain = l.conf < 75 || !dateTok || amount == null || !l.text;
    rows.push({
      date: dateTok?.iso || '',
      description: l.text,
      amount: amount == null ? '' : round2(amount),
      type,
      refund,
      note: '',
      confidence: l.conf / 100,
      uncertain,
    });
  }
  return rows;
}
