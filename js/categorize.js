// Automatic categorisation: previous transactions first, then keyword rules.
import { state, getCategory } from './store.js';
import { normalizeText, containsKeyword } from './format.js';

/**
 * Suggest a category for a description.
 * 1. If a transaction with the same description was categorised before, reuse that
 *    (so a correction you made once is remembered).
 * 2. Otherwise the longest matching keyword rule wins ("רמי לוי תקשורת" beats "רמי לוי").
 * Returns { categoryId, reason, keyword? } or null.
 */
export function suggestCategory(description, type = 'expense') {
  const text = normalizeText(description);
  if (!text) return null;

  let best = null;
  for (const t of state.transactions) {
    if (t.type !== type || normalizeText(t.description) !== text) continue;
    if (!getCategory(t.categoryId)) continue;
    if (!best || t.date > best.date) best = t;
  }
  if (best) return { categoryId: best.categoryId, reason: 'history' };

  const rule = matchRule(text, type);
  if (rule) return { categoryId: rule.categoryId, reason: 'rule', keyword: rule.keyword };
  return null;
}

export function matchRule(normalizedText, type) {
  let best = null;
  for (const r of state.rules) {
    const cat = getCategory(r.categoryId);
    if (!cat || cat.kind !== type) continue;
    const kw = normalizeText(r.keyword);
    if (containsKeyword(normalizedText, kw) && (!best || kw.length > best.keyword.length)) {
      best = { ...r, keyword: kw };
    }
  }
  return best;
}

/** Is this checking-account line the monthly credit-card bill? */
export function looksLikeCardPayment(description) {
  const text = normalizeText(description);
  return (state.settings.cardKeywords || []).some((k) => containsKeyword(text, normalizeText(k)));
}

/** Distinct previous descriptions, most frequent first (for autocomplete). */
export function knownDescriptions() {
  const counts = new Map();
  for (const t of state.transactions) {
    const d = t.description.trim();
    if (d) counts.set(d, (counts.get(d) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
}

// ---------- duplicates ----------

export function duplicateKey(tx) {
  return `${tx.date}|${normalizeText(tx.description)}|${tx.refund ? '-' : ''}${Math.abs(Number(tx.amount)).toFixed(2)}`;
}

/** Existing transactions that have the same date, description and amount. */
export function findDuplicates(tx, exceptId = null) {
  const key = duplicateKey(tx);
  return state.transactions.filter((t) => t.id !== exceptId && duplicateKey(t) === key);
}
