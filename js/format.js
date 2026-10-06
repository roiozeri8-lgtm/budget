// Formatting & parsing helpers (numbers, dates, text).

const numberFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1234.5 -> "1,234.50 ₪" (as plain text) */
export function formatMoneyText(value) {
  const n = Number(value) || 0;
  return `${n < 0 ? '-' : ''}${numberFmt.format(Math.abs(n))} ₪`;
}

/** Same, wrapped in an LTR-isolated span so it renders correctly inside RTL text. */
export function money(value, extraClass = '') {
  return `<span class="num ${extraClass}">${formatMoneyText(value)}</span>`;
}

/**
 * Parse an amount typed by the user or read by OCR.
 * Handles: "1,234.50", "-1,234.50", "1,234.50-", "(1,234.50)", "₪ 1,234.50", "1234", "12,5".
 * Returns a signed number, or NaN when no number was found.
 */
export function parseAmount(input) {
  if (input == null) return NaN;
  if (typeof input === 'number') return input;
  let s = String(input)
    .replace(/[‎‏‪-‮⁦-⁩]/g, '') // bidi marks
    .replace(/₪|ש"ח|ש״ח|nis|ils/gi, '')
    .replace(/[−–—]/g, '-') // unicode minus / dashes
    .replace(/\s+/g, '')
    .trim();
  if (!s) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  else if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;

  const commas = (s.match(/,/g) || []).length;
  if (!s.includes('.') && commas === 1 && /,\d{1,2}$/.test(s)) {
    s = s.replace(',', '.'); // "12,50" written with a decimal comma
  } else {
    s = s.replace(/,/g, '');
  }
  if ((s.match(/\./g) || []).length > 1) return NaN;
  const n = parseFloat(s);
  if (!isFinite(n)) return NaN;
  return negative ? -n : n;
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ---------- dates ----------

const pad = (n) => String(n).padStart(2, '0');

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function currentMonth() {
  return todayISO().slice(0, 7);
}

/** "2026-10-05" -> "05/10/2026" */
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const monthFmt = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });

/** "2026-10" -> "אוקטובר 2026" */
export function formatMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return monthFmt.format(new Date(y, m - 1, 1));
}

/** "2026-10", +1 -> "2026-11" */
export function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/**
 * Parse "30/09/2026", "30.09.26", "30-9-2026" or "30/09" (year guessed: the most recent such date
 * that is not more than a month in the future). Returns ISO "YYYY-MM-DD" or null.
 */
export function parseDate(text) {
  const m = String(text ?? '').match(/(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?/);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  let y;
  if (m[3]) {
    y = +m[3];
    if (y < 100) y += 2000;
    if (y < 2000 || y > 2100) return null;
  } else {
    const now = new Date();
    y = now.getFullYear();
    if (new Date(y, mo - 1, d) - now > 31 * 864e5) y--;
  }
  if (d > new Date(y, mo, 0).getDate()) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Date cell from a spreadsheet: Date object, Excel serial number or text. */
export function parseDateCell(v) {
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 864e5));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return parseDate(v);
}

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Build an ISO date inside `month`, clamping the day to the month length. */
export function dateInMonth(month, day) {
  return `${month}-${pad(Math.min(day, daysInMonth(month)))}`;
}

// ---------- text ----------

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Normalise a description for matching: lowercase, unify quotes, collapse spaces. */
export function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[״“”]/g, '"')
    .replace(/[׳‘’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const WORD_CHAR = /[a-z0-9א-ת]/;

/**
 * Does `text` contain `keyword`? Both should be normalised.
 * Short keywords (up to 3 letters, e.g. "פז", "דן") must appear as a whole word
 * so "פז" will not match "פזורה"; longer keywords match anywhere.
 */
export function containsKeyword(text, keyword) {
  if (!keyword) return false;
  if (keyword.length > 3) return text.includes(keyword);
  let from = 0;
  while (true) {
    const i = text.indexOf(keyword, from);
    if (i < 0) return false;
    const before = text[i - 1];
    const after = text[i + keyword.length];
    if ((!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after))) return true;
    from = i + 1;
  }
}
