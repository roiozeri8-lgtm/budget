// Calculations behind the dashboard: monthly summary, forecast, installments, trends, recurring charges.
import {
  state, transactionsOfMonth, expenseValue, periodOf, currentBudgetMonth, budgetMonthOf, categoriesOf, getCategory,
} from './store.js';
import { normalizeText, todayISO, addMonths, addMonthsToDate, daysBetween, round2 } from './format.js';

const sum = (list, fn = (t) => t.amount) => list.reduce((s, t) => s + fn(t), 0);

/** Normalised description without installment suffix and long reference numbers. */
export function matchKey(description) {
  return normalizeText(description)
    .replace(/\(תשלום[^)]*\)/g, '')
    .replace(/תשלום\s*\d+\s*מתוך\s*\d+/g, '')
    .replace(/\d{4,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Installment info from the transaction field, or from "(תשלום 3/12)" / "תשלום 3 מתוך 12" in the text. */
export function installmentOf(t) {
  if (t.installment) return t.installment;
  const m = t.description.match(/\(תשלום (\d+)\/(\d+)\)|תשלום\s*(\d+)\s*מתוך\s*(\d+)/);
  if (!m) return null;
  return { plan: null, n: Number(m[1] || m[3]), of: Number(m[2] || m[4]) };
}

const counted = (t) => t.type === 'expense' && !t.isCardPayment;

// ---------- monthly summary ----------

export function monthSummary(month) {
  const txs = transactionsOfMonth(month);
  const expenseTxs = txs.filter(counted);
  const income = sum(txs.filter((t) => t.type === 'income'));
  const expenses = sum(expenseTxs, expenseValue);
  const cardPayments = sum(txs.filter((t) => t.type === 'expense' && t.isCardPayment));
  const byCategory = new Map();
  for (const t of expenseTxs) byCategory.set(t.categoryId, (byCategory.get(t.categoryId) || 0) + expenseValue(t));
  const catBudgetSum = categoriesOf('expense').reduce((s, c) => s + (c.budget > 0 ? c.budget : 0), 0);
  const totalBudget = state.settings.totalBudget > 0 ? state.settings.totalBudget : null;
  // what "left to spend" is measured against: the total budget, else the month's income,
  // else (no income entered yet) the sum of the category budgets
  const base = totalBudget ?? (income > 0 ? income : catBudgetSum || null);
  const baseKind = totalBudget ? 'budget' : income > 0 ? 'income' : catBudgetSum ? 'categories' : null;
  return { month, txs, income, expenses, cardPayments, byCategory, totalBudget, base, baseKind };
}

/** Average spending per category over the previous `n` budget months that have any data. */
export function categoryAverages(month, n = 3) {
  const totals = new Map();
  let used = 0;
  for (let i = 1; i <= 12 && used < n; i++) {
    const m = addMonths(month, -i);
    const s = monthSummary(m);
    if (!s.txs.length) continue;
    used++;
    for (const [id, v] of s.byCategory) totals.set(id, (totals.get(id) || 0) + v);
  }
  const avg = new Map();
  if (!used) return { avg, months: 0 };
  for (const [id, v] of totals) avg.set(id, v / used);
  return { avg, months: used };
}

export function monthlyTrend(month, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = addMonths(month, -i);
    const s = monthSummary(m);
    out.push({ month: m, income: s.income, expenses: s.expenses, hasData: s.txs.length > 0 });
  }
  return out;
}

// ---------- installments ----------

/**
 * Installment plans found in the data. For each: the payments seen and the payments still
 * expected (projected month by month from the last one seen).
 */
export function installmentPlans() {
  const plans = new Map();
  for (const t of state.transactions) {
    if (t.type !== 'expense') continue;
    const inst = installmentOf(t);
    if (!inst) continue;
    const key = inst.plan || `${matchKey(t.description)}|${inst.of}|${t.amount.toFixed(2)}`;
    let p = plans.get(key);
    if (!p) {
      p = { key, description: t.description.replace(/\s*\(תשלום[^)]*\)/, '').trim(), of: inst.of, amount: t.amount, categoryId: t.categoryId, payments: [] };
      plans.set(key, p);
    }
    p.payments.push({ n: inst.n, date: t.date, id: t.id });
  }
  const today = todayISO();
  for (const p of plans.values()) {
    p.payments.sort((a, b) => a.n - b.n);
    const last = p.payments[p.payments.length - 1];
    p.expected = [];
    for (let k = last.n + 1; k <= p.of; k++) {
      const date = addMonthsToDate(last.date, k - last.n);
      p.expected.push({ n: k, date, month: budgetMonthOf(date) });
    }
    p.remainingCount = p.of - p.payments.filter((x) => x.date <= today).length;
    p.remainingAmount = round2(p.remainingCount * p.amount);
  }
  return [...plans.values()];
}

// ---------- expected monthly charges (subscriptions / standing orders) ----------

function matchesTemplate(t, rec) {
  return t.recurringId === rec.id || (rec.matchKey && matchKey(t.description) === rec.matchKey);
}

/** Expected-mode charges that have not appeared yet in `month`. */
function pendingExpected(month) {
  const txs = transactionsOfMonth(month);
  return state.recurring
    .filter((r) => r.active && r.mode === 'expected' && r.type === 'expense')
    .filter((r) => !txs.some((t) => matchesTemplate(t, r)));
}

/**
 * What is still going to be charged in `month` but is not in the data yet:
 * projected installments, expected monthly charges, and (future months) automatic recurring items.
 */
export function pendingCharges(month) {
  const items = [];
  const cur = currentBudgetMonth();
  if (month < cur) return items;
  for (const p of installmentPlans()) {
    for (const e of p.expected) {
      if (e.month === month) items.push({ kind: 'installment', description: p.description, amount: p.amount, categoryId: p.categoryId, note: `תשלום ${e.n}/${p.of}`, date: e.date });
    }
  }
  for (const r of pendingExpected(month)) {
    items.push({ kind: 'fixed', description: r.description, amount: r.amount, categoryId: r.categoryId, note: 'חיוב חודשי צפוי', recId: r.id });
  }
  if (month > cur) {
    for (const r of state.recurring.filter((x) => x.active && x.mode !== 'expected' && x.type === 'expense')) {
      items.push({ kind: 'recurring', description: r.description, amount: r.amount, categoryId: r.categoryId, note: 'תנועה קבועה' });
    }
  }
  return items;
}

/** Already-scheduled future transactions in a month (installments entered in advance etc.). */
export function scheduledCharges(month) {
  const today = todayISO();
  return transactionsOfMonth(month).filter((t) => counted(t) && t.date > today);
}

/** Next `n` months (current included): what is already committed. */
export function upcoming(n = 4) {
  const cur = currentBudgetMonth();
  const out = [];
  for (let i = 0; i < n; i++) {
    const month = addMonths(cur, i);
    const pending = pendingCharges(month);
    const scheduled = scheduledCharges(month).map((t) => ({
      kind: installmentOf(t) ? 'installment' : 'scheduled', description: t.description, amount: expenseValue(t),
      categoryId: t.categoryId, note: '', date: t.date,
    }));
    const items = [...scheduled, ...pending];
    out.push({ month, items, total: round2(sum(items)) });
  }
  return out;
}

// ---------- forecast (current budget month) ----------

/** A single large purchase is counted once, not extrapolated as a daily pace. */
const ONE_OFF = 400;
const isOneOff = (t) => t.amount >= ONE_OFF;

function isFixed(t) {
  if (t.recurringId || installmentOf(t)) return true;
  return state.recurring.some((r) => r.mode === 'expected' && matchesTemplate(t, r));
}

/**
 * Forecast for the current budget month: daily allowance and expected total at month end.
 * Fixed charges (recurring, installments, expected) count in full; everyday spending is
 * extrapolated from the pace so far (or from previous months during the first days).
 */
export function forecast(month) {
  if (month !== currentBudgetMonth()) return null;
  const { from, to } = periodOf(month);
  const today = todayISO();
  const daysTotal = daysBetween(from, to) + 1;
  const daysElapsed = Math.min(daysTotal, daysBetween(from, today) + 1);
  const daysLeft = daysTotal - daysElapsed + 1; // including today

  const s = monthSummary(month);
  const exp = s.txs.filter(counted);
  const fixedSoFar = sum(exp.filter(isFixed), expenseValue);
  const variable = exp.filter((t) => !isFixed(t) && t.date <= today);
  const variableSoFar = sum(variable, expenseValue);
  const everydaySoFar = sum(variable.filter((t) => !isOneOff(t)), expenseValue);
  const pending = pendingCharges(month);
  const pendingTotal = sum(pending);

  let pace = daysElapsed > 0 ? everydaySoFar / daysElapsed : 0;
  let paceSource = 'month';
  if (daysElapsed < 5) {
    // too early to tell: use the average everyday spending of previous months
    let total = 0, used = 0;
    for (let i = 1; i <= 6 && used < 3; i++) {
      const m = addMonths(month, -i);
      const txs = transactionsOfMonth(m).filter(counted);
      if (!txs.length) continue;
      used++;
      const p = periodOf(m);
      total += sum(txs.filter((t) => !isFixed(t) && !isOneOff(t)), expenseValue) / (daysBetween(p.from, p.to) + 1);
    }
    if (used) { pace = total / used; paceSource = 'history'; }
  }
  const projectedVariable = variableSoFar + pace * (daysTotal - daysElapsed);
  const forecastTotal = round2(fixedSoFar + pendingTotal + projectedVariable);

  const base = s.base;
  const committed = s.expenses + pendingTotal;
  const remaining = base == null ? null : round2(base - committed);
  const perDay = remaining == null ? null : Math.max(0, remaining) / daysLeft;
  return { daysTotal, daysElapsed, daysLeft, pendingTotal, pending, forecastTotal, base, remaining, perDay, paceSource, fixedSoFar, variableSoFar };
}

// ---------- recurring-charge detection ----------

/**
 * Expenses that look like a monthly charge (same merchant, about once a month, similar amount,
 * seen recently) and are not yet marked as recurring.
 */
export function detectRecurring() {
  const dismissed = new Set(state.settings.dismissedRecurring || []);
  const known = new Set(state.recurring.map((r) => r.matchKey || matchKey(r.description)));
  const groups = new Map();
  for (const t of state.transactions) {
    if (!counted(t) || t.refund || t.recurringId || installmentOf(t)) continue;
    const key = matchKey(t.description);
    if (!key || known.has(key) || dismissed.has(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const cur = currentBudgetMonth();
  const out = [];
  for (const [key, txs] of groups) {
    const perMonth = new Map();
    for (const t of txs) {
      const m = budgetMonthOf(t.date);
      perMonth.set(m, [...(perMonth.get(m) || []), t]);
    }
    const months = [...perMonth.keys()].sort();
    const standing = txs.some((t) => /הוראת קבע/.test(t.note || '') || /הוראות? קבע/.test(t.description));
    if (months.length < (standing ? 1 : 3)) continue;
    const singles = [...perMonth.values()].filter((l) => l.length === 1).length;
    if (singles / months.length < 0.8) continue; // bought several times a month: not a subscription
    const amounts = txs.map((t) => t.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    // a subscription costs (almost) the same every month; standing orders such as bills may vary more
    if (amounts.some((a) => Math.abs(a - median) > median * (standing ? 0.35 : 0.12))) continue;
    if (months[months.length - 1] < addMonths(cur, -2)) continue; // stopped
    const last = txs.reduce((a, b) => (a.date > b.date ? a : b));
    out.push({
      key, description: last.description, amount: last.amount, categoryId: last.categoryId,
      day: Number(last.date.slice(8, 10)), months: months.length, standing,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/** Categories where this month is clearly above the usual level. */
export function categorySpikes(month) {
  const s = monthSummary(month);
  const { avg, months } = categoryAverages(month);
  if (months < 2) return [];
  const out = [];
  for (const [id, v] of s.byCategory) {
    const a = avg.get(id);
    if (a > 50 && v > a * 1.25 && v - a > 100) out.push({ cat: getCategory(id), value: v, avg: a, pct: v / a - 1 });
  }
  return out.sort((x, y) => (y.value - y.avg) - (x.value - x.avg));
}
