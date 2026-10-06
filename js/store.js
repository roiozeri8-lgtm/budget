// In-memory application state, mirrored to IndexedDB.
//
// Sync between devices (computer / iPhone) works through backup files: every record carries
// `updatedAt`, deletions are remembered as "tombstones", and importing a backup in merge mode
// keeps the newest version of each record. Transactions created by a recurring item have a
// fixed id (`<recurringId>-<YYYY-MM>`) so two devices never create the same month twice.
import * as db from './db.js';
import { DEFAULT_CATEGORIES, DEFAULT_RULES, RULES_VERSION, REMOVED_RULE_IDS, DEFAULT_CARD_KEYWORDS, FALLBACK_CATEGORY } from './defaults.js';
import { currentMonth, addMonths, dateInMonth, round2 } from './format.js';

export const state = {
  transactions: [],
  categories: [],
  rules: [],
  recurring: [],
  settings: {},
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
function emit() { listeners.forEach((fn) => fn()); }

export const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const now = () => new Date().toISOString();

/** Settings that describe this device, not the user's data — never synced. */
const LOCAL_SETTINGS = new Set(['seeded', 'rulesVersion', 'tombstones', 'settingsMeta', 'lastBackup', 'lastSync']);
const SYNC_STORES = ['transactions', 'categories', 'rules', 'recurring'];

// ---------- loading ----------

export async function load() {
  const [transactions, categories, rules, recurring, settings] = await Promise.all(db.STORES.map(db.getAll));
  Object.assign(state, { transactions, categories, rules, recurring });
  state.settings = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  if (!state.settings.seeded) {
    state.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    state.rules = DEFAULT_RULES.map((r) => ({ ...r }));
    await db.put('categories', state.categories);
    await db.put('rules', state.rules);
    await setSetting('cardKeywords', DEFAULT_CARD_KEYWORDS, false);
    await setSetting('seeded', true, false);
    await setSetting('rulesVersion', RULES_VERSION, false);
  }
  if ((state.settings.rulesVersion || 1) < RULES_VERSION) {
    // new built-in rules from an app update; never overrides a keyword the user already has
    const known = new Set(state.rules.map((r) => r.keyword));
    const added = DEFAULT_RULES.filter((r) => !known.has(r.keyword) && getCategory(r.categoryId));
    if (added.length) { await db.put('rules', added); state.rules.push(...added); }
    const removed = state.rules.filter((r) => REMOVED_RULE_IDS.includes(r.id)).map((r) => r.id);
    if (removed.length) { await db.remove('rules', removed); state.rules = state.rules.filter((r) => !removed.includes(r.id)); }
    await setSetting('rulesVersion', RULES_VERSION, false);
  }
  await generateRecurring(false);
}

// ---------- lookups ----------

export function getCategory(id) {
  return state.categories.find((c) => c.id === id);
}

export function categoriesOf(kind) {
  return state.categories.filter((c) => c.kind === kind).sort((a, b) => a.order - b.order);
}

export function fallbackCategory(type) {
  const id = FALLBACK_CATEGORY[type];
  if (getCategory(id)) return id;
  return categoriesOf(type)[0]?.id ?? null;
}

/** How much an expense adds to the month's spending (refunds are negative). */
export function expenseValue(t) {
  return t.refund ? -t.amount : t.amount;
}

export function transactionsOfMonth(month) {
  return state.transactions.filter((t) => t.date.startsWith(month));
}

// ---------- deletions (tombstones) ----------

async function remember(ids) {
  const tomb = { ...(state.settings.tombstones || {}) };
  const at = now();
  for (const id of ids) tomb[id] = at;
  await setSetting('tombstones', tomb, false);
}

// ---------- transactions ----------

function normalizeTx(tx) {
  return {
    id: tx.id || uid(),
    date: tx.date,
    amount: round2(Math.abs(tx.amount)),
    type: tx.type === 'income' ? 'income' : 'expense',
    description: (tx.description || '').trim(),
    categoryId: tx.categoryId || fallbackCategory(tx.type === 'income' ? 'income' : 'expense'),
    note: (tx.note || '').trim(),
    source: tx.source || 'manual',
    isCardPayment: tx.type === 'income' ? false : !!tx.isCardPayment,
    refund: tx.type === 'income' ? false : !!tx.refund, // a credit/refund on an expense category: reduces expenses
    recurringId: tx.recurringId || null,
    createdAt: tx.createdAt || now(),
    updatedAt: now(),
  };
}

export async function saveTransactions(list, notify = true) {
  const items = list.map(normalizeTx);
  await db.put('transactions', items);
  for (const item of items) {
    const i = state.transactions.findIndex((t) => t.id === item.id);
    if (i >= 0) state.transactions[i] = item; else state.transactions.push(item);
  }
  if (notify) emit();
  return items;
}

export async function saveTransaction(tx) {
  return (await saveTransactions([tx]))[0];
}

export async function deleteTransactions(ids) {
  await db.remove('transactions', ids);
  await remember(ids);
  state.transactions = state.transactions.filter((t) => !ids.includes(t.id));
  emit();
}

// ---------- categories ----------

export async function saveCategory(cat) {
  const item = { budget: null, order: state.categories.length, ...cat, id: cat.id || uid(), updatedAt: now() };
  await db.put('categories', [item]);
  const i = state.categories.findIndex((c) => c.id === item.id);
  if (i >= 0) state.categories[i] = item; else state.categories.push(item);
  emit();
  return item;
}

/** Delete a category; its transactions and recurring items move to `moveTo`, its rules are deleted. */
export async function deleteCategory(id, moveTo) {
  const at = now();
  const txs = state.transactions.filter((t) => t.categoryId === id).map((t) => ({ ...t, categoryId: moveTo, updatedAt: at }));
  const recs = state.recurring.filter((r) => r.categoryId === id).map((r) => ({ ...r, categoryId: moveTo, updatedAt: at }));
  const ruleIds = state.rules.filter((r) => r.categoryId === id).map((r) => r.id);
  if (txs.length) await db.put('transactions', txs);
  if (recs.length) await db.put('recurring', recs);
  if (ruleIds.length) await db.remove('rules', ruleIds);
  await db.remove('categories', [id]);
  await remember([id, ...ruleIds]);
  const byId = (list) => new Map(list.map((x) => [x.id, x]));
  const txMap = byId(txs), recMap = byId(recs);
  state.transactions = state.transactions.map((t) => txMap.get(t.id) || t);
  state.recurring = state.recurring.map((r) => recMap.get(r.id) || r);
  state.rules = state.rules.filter((r) => r.categoryId !== id);
  state.categories = state.categories.filter((c) => c.id !== id);
  emit();
}

// ---------- rules ----------

export async function saveRule(rule) {
  const item = { ...rule, id: rule.id || uid(), keyword: rule.keyword.trim().toLowerCase(), updatedAt: now() };
  await db.put('rules', [item]);
  const i = state.rules.findIndex((r) => r.id === item.id);
  if (i >= 0) state.rules[i] = item; else state.rules.push(item);
  emit();
  return item;
}

export async function deleteRule(id) {
  await db.remove('rules', [id]);
  await remember([id]);
  state.rules = state.rules.filter((r) => r.id !== id);
  emit();
}

// ---------- settings ----------

export async function setSetting(key, value, notify = true) {
  const items = [{ key, value }];
  state.settings[key] = value;
  if (!LOCAL_SETTINGS.has(key)) {
    const meta = { ...(state.settings.settingsMeta || {}), [key]: now() };
    state.settings.settingsMeta = meta;
    items.push({ key: 'settingsMeta', value: meta });
  }
  await db.put('settings', items);
  if (notify) emit();
}

// ---------- recurring (monthly) transactions ----------

/**
 * A recurring template: { id, type, amount, description, categoryId, note, isCardPayment,
 *   day, startMonth, lastGenerated, active }.
 * Every month after `lastGenerated` up to the current month gets one transaction.
 */
export async function saveRecurring(rec) {
  const item = { active: true, ...rec, id: rec.id || uid(), amount: round2(Math.abs(rec.amount)), updatedAt: now() };
  await db.put('recurring', [item]);
  const i = state.recurring.findIndex((r) => r.id === item.id);
  if (i >= 0) state.recurring[i] = item; else state.recurring.push(item);
  emit();
  return item;
}

/** Cancel a recurring item. Transactions that were already created stay. */
export async function deleteRecurring(id) {
  await db.remove('recurring', [id]);
  await remember([id]);
  state.recurring = state.recurring.filter((r) => r.id !== id);
  const linked = state.transactions.filter((t) => t.recurringId === id).map((t) => ({ ...t, recurringId: null }));
  if (linked.length) await saveTransactions(linked, false);
  emit();
}

export async function generateRecurring(notify = true) {
  const thisMonth = currentMonth();
  const tomb = state.settings.tombstones || {};
  const existing = new Set(state.transactions.map((t) => t.id));
  const newTxs = [];
  const updated = [];
  for (const rec of state.recurring) {
    if (!rec.active) continue;
    let month = rec.lastGenerated ? addMonths(rec.lastGenerated, 1) : rec.startMonth;
    let changed = false;
    while (month <= thisMonth) {
      const id = `${rec.id}-${month}`;
      // skip months already created here or on another device, or deleted by the user
      if (!existing.has(id) && !tomb[id]) {
        newTxs.push({
          id,
          date: dateInMonth(month, rec.day),
          amount: rec.amount,
          type: rec.type,
          description: rec.description,
          categoryId: rec.categoryId,
          note: rec.note,
          isCardPayment: rec.isCardPayment,
          source: 'manual',
          recurringId: rec.id,
        });
      }
      rec.lastGenerated = month;
      changed = true;
      month = addMonths(month, 1);
    }
    if (changed) { rec.updatedAt = now(); updated.push(rec); }
  }
  if (updated.length) await db.put('recurring', updated);
  if (newTxs.length) await saveTransactions(newTxs, false);
  if (notify && (updated.length || newTxs.length)) emit();
  return newTxs.length;
}

// ---------- backup & sync ----------

export function exportData() {
  return {
    app: 'budget-app',
    version: 2,
    exportedAt: now(),
    transactions: state.transactions,
    categories: state.categories,
    rules: state.rules,
    recurring: state.recurring,
    settings: Object.entries(state.settings)
      .filter(([key]) => !['lastBackup', 'lastSync'].includes(key))
      .map(([key, value]) => ({ key, value })),
  };
}

function validate(data) {
  if (!data || data.app !== 'budget-app' || !Array.isArray(data.transactions) || !Array.isArray(data.categories)) {
    throw new Error('הקובץ אינו גיבוי תקין של האפליקציה');
  }
}

/** Replace everything with the backup (full restore). */
export async function importData(data) {
  validate(data);
  await db.replaceAll(data);
  await load();
  emit();
}

/**
 * Merge a backup from another device into this one.
 * Newest `updatedAt` wins per record; a deletion wins over any version older than it.
 * Returns counts of what changed.
 */
export async function mergeData(data) {
  validate(data);
  const remoteSettings = Object.fromEntries((data.settings || []).map((s) => [s.key, s.value]));
  const tomb = { ...(state.settings.tombstones || {}) };
  for (const [id, at] of Object.entries(remoteSettings.tombstones || {})) {
    if (!tomb[id] || at > tomb[id]) tomb[id] = at;
  }

  const result = {};
  const stats = { added: 0, updated: 0, deleted: 0 };
  for (const store of SYNC_STORES) {
    const map = new Map(state[store].map((x) => [x.id, x]));
    for (const r of data[store] || []) {
      const l = map.get(r.id);
      if (!l) { map.set(r.id, r); if (store === 'transactions') stats.added++; }
      else if ((r.updatedAt || '') > (l.updatedAt || '')) { map.set(r.id, r); if (store === 'transactions') stats.updated++; }
    }
    for (const [id, at] of Object.entries(tomb)) {
      const item = map.get(id);
      if (item && (item.updatedAt || '') <= at) { map.delete(id); if (store === 'transactions') stats.deleted++; }
    }
    result[store] = [...map.values()];
  }

  // a transaction whose category was deleted on the other device goes to the fallback category
  const catIds = new Set(result.categories.map((c) => c.id));
  const kindOf = (t) => (t.type === 'income' ? 'income' : 'expense');
  for (const t of result.transactions) {
    if (!catIds.has(t.categoryId)) {
      const fb = FALLBACK_CATEGORY[kindOf(t)];
      t.categoryId = catIds.has(fb) ? fb : result.categories.find((c) => c.kind === kindOf(t))?.id;
    }
  }

  // settings: per key, the newer change wins
  const localMeta = state.settings.settingsMeta || {};
  const remoteMeta = remoteSettings.settingsMeta || {};
  const settings = { ...state.settings };
  const meta = { ...localMeta };
  for (const [key, value] of Object.entries(remoteSettings)) {
    if (LOCAL_SETTINGS.has(key)) continue;
    if ((remoteMeta[key] || '') > (localMeta[key] || '')) { settings[key] = value; meta[key] = remoteMeta[key]; }
  }
  settings.settingsMeta = meta;
  settings.tombstones = tomb;
  settings.rulesVersion = Math.max(state.settings.rulesVersion || 1, remoteSettings.rulesVersion || 1);
  settings.lastSync = now();

  await db.replaceAll({ ...result, settings: Object.entries(settings).map(([key, value]) => ({ key, value })) });
  await load();
  emit();
  return stats;
}
