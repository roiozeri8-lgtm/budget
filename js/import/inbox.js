// Apple Pay "inbox": a text file that an iPhone Shortcuts automation appends one line to
// on every Apple Pay payment. Recommended line format (see the guide in the app):
//   2026-11-18|₪42.50|ארומה|Visa 4042
// The parser is forgiving: any separator, date as 2026-11-18 / 18/11/2026 / 18.11.26,
// amount with or without ₪ / comma. Lines that cannot be read are kept and marked for review.
import { parseAmount, parseDate, todayISO, round2 } from '../format.js';

const ISO = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/;
const AMOUNT = /[-−]?\s*₪?\s*\d{1,3}(?:,\d{3})*(?:[.,]\d{1,2})?\s*₪?|[-−]?\s*₪?\s*\d+(?:[.,]\d{1,2})?\s*₪?/g;

function parseLine(line) {
  const parts = line.split(/\s*[|;\t]\s*/).map((p) => p.trim()).filter(Boolean);
  let date = null;
  let amount = null;
  const rest = [];

  for (const p of parts.length > 1 ? parts : [line]) {
    if (!date) {
      const iso = p.match(ISO);
      if (iso) {
        date = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
        const left = p.replace(iso[0], '').replace(/\d{1,2}:\d{2}(:\d{2})?/, '').trim();
        if (left) rest.push(left);
        continue;
      }
      const d = parseDate(p);
      // "18/11", "18/11/2026", "18.11.26" — but not "12.05", which is an amount
      if (d && /^\s*\d{1,2}(\/\d{1,2}(\/\d{2,4})?|[.\-]\d{1,2}[.\-]\d{2,4})(\s+\d{1,2}:\d{2})?\s*$/.test(p)) { date = d; continue; }
    }
    if (amount == null && (/₪|ILS|NIS/i.test(p) || /^[-−]?\d[\d,]*([.,]\d{1,2})?$/.test(p))) {
      const v = parseAmount(p.replace(/ILS|NIS/gi, ''));
      if (isFinite(v) && v !== 0) { amount = v; continue; }
    }
    rest.push(p);
  }

  // single free-text line: pull a date and an amount out of it
  if (parts.length <= 1 && (date == null || amount == null)) {
    let text = rest.join(' ');
    if (!date) {
      const d = parseDate(text);
      if (d) { date = d; text = text.replace(/\d{1,2}[\/.\-]\d{1,2}([\/.\-]\d{2,4})?/, ' '); }
    }
    if (amount == null) {
      const m = [...text.matchAll(AMOUNT)].map((x) => x[0]).filter((x) => /[.,]\d{2}|₪/.test(x));
      if (m.length) { amount = parseAmount(m[0]); text = text.replace(m[0], ' '); }
    }
    rest.splice(0, rest.length, text.replace(/\s+/g, ' ').trim());
  }

  const [merchant = '', card = ''] = rest;
  return {
    date: date || todayISO(),
    description: merchant.replace(/\s+/g, ' ').trim(),
    amount: amount == null ? '' : round2(Math.abs(amount)),
    type: 'expense',
    refund: amount != null && amount < 0,
    note: card ? `Apple Pay · ${card}` : 'Apple Pay',
    uncertain: !date || amount == null || !merchant,
  };
}

/** Parse the inbox text into review rows. */
export function parseInbox(text) {
  return String(text)
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[‎‏‪-‮⁦-⁩]/g, '').trim())
    .filter((l) => l && /\d/.test(l))
    .map(parseLine);
}

export function isInboxFile(file) {
  return /\.(txt|text|csv)$/i.test(file.name) || file.type === 'text/plain';
}
