// Transactions screen: month's transactions grouped by day, with search and filters.
import { state, getCategory, categoriesOf, transactionsOfMonth, expenseValue, periodOf, currentBudgetMonth } from '../store.js';
import { installmentOf } from '../analytics.js';
import { money, escapeHtml, normalizeText, formatDayHeader } from '../format.js';
import { view, sourceBadge, avatar, monthNav, emptyState, SOURCES, $ } from '../ui.js';
import { icon } from '../icons.js';
import { openTxForm } from './txform.js';

/** Signed effect on the balance: income +, expense − (refund +), card bill 0. */
export function signedValue(t) {
  if (t.type === 'income') return t.amount;
  if (t.isCardPayment) return 0;
  return -expenseValue(t);
}

/** One transaction row (also used by the dashboard's "recent" list). */
export function txRow(t, { showDate = false } = {}) {
  const cat = getCategory(t.categoryId);
  const inst = installmentOf(t);
  const positive = t.type === 'income' || t.refund;
  const meta = [
    escapeHtml(cat?.name?.replace(/\s*\(.*\)/, '') || 'ללא קטגוריה'),
    showDate ? formatDayHeader(t.date) : '',
    t.note ? escapeHtml(t.note) : '',
  ].filter(Boolean).join(' · ');
  return `
  <button type="button" class="tx-row ${t.isCardPayment ? 'is-muted' : ''}" data-tx="${t.id}">
    ${avatar(cat)}
    <span class="tx-main">
      <span class="tx-desc">${escapeHtml(t.description)}</span>
      <span class="tx-meta">${meta}
        ${t.source !== 'manual' ? sourceBadge(t.source) : ''}
        ${t.recurringId ? `<span class="badge badge-recurring" title="תנועה קבועה">${icon('repeat', 12)} קבועה</span>` : ''}
        ${inst && !/\(תשלום/.test(t.description) ? `<span class="badge badge-recurring">${inst.n}/${inst.of}</span>` : ''}
        ${t.isCardPayment ? '<span class="badge badge-card">חיוב אשראי · לא נספר</span>' : ''}
        ${t.refund ? '<span class="badge badge-refund">זיכוי</span>' : ''}
      </span>
    </span>
    <span class="tx-amount ${positive ? 'is-positive' : ''}">${positive ? '+' : ''}${money(positive ? t.amount : -t.amount)}</span>
  </button>`;
}

export function renderTransactions() {
  const all = transactionsOfMonth(view.month);
  const q = normalizeText(view.search);
  const rows = all
    .filter((t) => !view.categoryFilter || t.categoryId === view.categoryFilter)
    .filter((t) => !view.sourceFilter || t.source === view.sourceFilter)
    .filter((t) => !q || normalizeText(`${t.description} ${t.note} ${t.amount}`).includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));

  const income = rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = rows.filter((t) => t.type === 'expense' && !t.isCardPayment).reduce((s, t) => s + expenseValue(t), 0);

  const days = new Map();
  for (const t of rows) days.set(t.date, [...(days.get(t.date) || []), t]);

  const cats = [...categoriesOf('expense'), ...categoriesOf('income')];
  const usedSources = new Set(state.transactions.map((t) => t.source));
  const filtered = view.categoryFilter || view.sourceFilter || view.search;

  return `
  <div class="page-head">
    <h1>תנועות</h1>
    ${monthNav(periodOf(view.month), view.month === currentBudgetMonth())}
  </div>

  <div class="toolbar">
    <label class="search">${icon('search', 18)}
      <input type="search" data-filter="search" placeholder="חיפוש לפי תיאור, הערה או סכום" value="${escapeHtml(view.search)}" aria-label="חיפוש"></label>
    <div class="chip-row" role="group" aria-label="סינון לפי מקור">
      <button type="button" class="chip ${!view.sourceFilter ? 'active' : ''}" data-source="">הכול</button>
      ${Object.entries(SOURCES).filter(([k]) => usedSources.has(k) || k === 'manual').map(([k, s]) =>
        `<button type="button" class="chip ${view.sourceFilter === k ? 'active' : ''}" data-source="${k}">${s.label}</button>`).join('')}
      <select class="chip chip-select ${view.categoryFilter ? 'active' : ''}" data-filter="category" aria-label="סינון לפי קטגוריה">
        <option value="">כל הקטגוריות</option>
        ${cats.map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === view.categoryFilter ? 'selected' : ''}>${escapeHtml(`${c.icon || ''} ${c.name}`)}</option>`).join('')}
      </select>
    </div>
  </div>

  <div class="summary-strip">
    <div><span class="muted">הכנסות</span><b class="is-positive">${money(income)}</b></div>
    <div><span class="muted">הוצאות</span><b>${money(expense)}</b></div>
    <div><span class="muted">תנועות</span><b>${rows.length}${filtered ? ` <small class="muted">מתוך ${all.length}</small>` : ''}</b></div>
  </div>

  ${rows.length === 0
    ? `<div class="card">${all.length
      ? emptyState('filter', 'אין תנועות שמתאימות לסינון', '', '<button type="button" class="btn btn-ghost" data-clear-filters>ניקוי הסינון</button>')
      : emptyState('wallet', 'אין עדיין תנועות בחודש הזה', 'אפשר להוסיף ידנית, לקלוט מ-Apple Pay או להעלות צילום מסך מהבנק.',
        '<button type="button" class="btn btn-primary" data-add-tx>הוספת תנועה</button>')}</div>`
    : [...days.entries()].map(([date, list]) => {
      const net = list.reduce((s, t) => s + signedValue(t), 0);
      return `
      <section class="day-group">
        <header class="day-head"><span>${formatDayHeader(date)}</span><span class="${net > 0 ? 'is-positive' : ''}">${net > 0 ? '+' : ''}${money(net)}</span></header>
        <div class="tx-list card">${list.map((t) => txRow(t)).join('')}</div>
      </section>`;
    }).join('')}`;
}

/** Wire events once on the main container (event delegation). Shared with the dashboard rows. */
export function bindTransactions(root, rerender) {
  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-tx]');
    if (row) {
      const tx = state.transactions.find((t) => t.id === row.dataset.tx);
      if (tx) openTxForm(tx);
      return;
    }
    const src = e.target.closest('[data-source]');
    if (src) { view.sourceFilter = src.dataset.source; rerender(); return; }
    if (e.target.closest('[data-clear-filters]')) {
      view.sourceFilter = ''; view.categoryFilter = ''; view.search = ''; rerender();
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.dataset.filter === 'category') { view.categoryFilter = e.target.value; rerender(); }
  });
  root.addEventListener('input', (e) => {
    if (e.target.dataset.filter === 'search') {
      view.search = e.target.value;
      const pos = e.target.selectionStart;
      rerender();
      const input = $('[data-filter="search"]', root);
      input?.focus();
      input?.setSelectionRange(pos, pos);
    }
  });
}
