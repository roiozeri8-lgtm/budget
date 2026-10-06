// The month's transaction list with filters, inline category change, edit and delete.
import { state, getCategory, categoriesOf, transactionsOfMonth, saveTransaction, deleteTransactions, expenseValue } from '../store.js';
import { money, escapeHtml, formatDate, normalizeText } from '../format.js';
import { view, sourceBadge, categoryOptions, confirmDialog, toast, SOURCES, $ } from '../ui.js';
import { openTxForm } from './txform.js';

export function renderTxList() {
  const all = transactionsOfMonth(view.month);
  const q = normalizeText(view.search);
  const rows = all
    .filter((t) => !view.categoryFilter || t.categoryId === view.categoryFilter)
    .filter((t) => !view.sourceFilter || t.source === view.sourceFilter)
    .filter((t) => !q || normalizeText(`${t.description} ${t.note}`).includes(q))
    .sort((a, b) => (b.date.localeCompare(a.date)) || (b.createdAt || '').localeCompare(a.createdAt || ''));

  const income = rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = rows.filter((t) => t.type === 'expense' && !t.isCardPayment).reduce((s, t) => s + expenseValue(t), 0);

  const catFilterOptions = [...categoriesOf('expense'), ...categoriesOf('income')]
    .map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === view.categoryFilter ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');

  return `
  <section class="card tx-section" id="tx-list">
    <header class="section-head">
      <h2>תנועות החודש <span class="muted">(${rows.length}${rows.length !== all.length ? ` מתוך ${all.length}` : ''})</span></h2>
      <div class="filters">
        <select data-filter="category" aria-label="סינון לפי קטגוריה">
          <option value="">כל הקטגוריות</option>${catFilterOptions}
        </select>
        <select data-filter="source" aria-label="סינון לפי מקור">
          <option value="">כל המקורות</option>
          ${Object.entries(SOURCES).map(([k, s]) => `<option value="${k}" ${k === view.sourceFilter ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
        <input type="search" data-filter="search" placeholder="חיפוש…" value="${escapeHtml(view.search)}" aria-label="חיפוש">
      </div>
    </header>
    ${rows.length === 0 ? `<p class="empty">${all.length ? 'אין תנועות שתואמות את הסינון.' : 'אין עדיין תנועות בחודש הזה. לחצו על "הוספת תנועה" או העלו צילום מסך.'}</p>` : `
    <div class="table-wrap">
    <table class="tx-table">
      <thead><tr>
        <th>תאריך</th><th>תיאור</th><th>קטגוריה</th><th>מקור</th><th class="amount-col">סכום</th><th aria-label="פעולות"></th>
      </tr></thead>
      <tbody>
      ${rows.map(rowHtml).join('')}
      </tbody>
      <tfoot><tr>
        <td colspan="4">סה"כ ברשימה: הכנסות ${money(income)} · הוצאות ${money(expense)}</td>
        <td class="amount-col">${money(income - expense)}</td><td></td>
      </tr></tfoot>
    </table>
    </div>`}
  </section>`;
}

function rowHtml(t) {
  const cat = getCategory(t.categoryId);
  const cats = categoriesOf(t.type);
  return `
  <tr data-id="${t.id}" class="${t.isCardPayment ? 'row-card-payment' : ''}">
    <td class="nowrap">${formatDate(t.date)}</td>
    <td>
      <div class="desc">${escapeHtml(t.description)}
        ${t.recurringId ? '<span class="badge badge-recurring" title="תנועה קבועה">↻ קבועה</span>' : ''}
        ${t.isCardPayment ? '<span class="badge badge-card" title="לא נספר בסך ההוצאות">חיוב אשראי · לא נספר</span>' : ''}
        ${t.refund ? '<span class="badge badge-refund" title="מקטין את ההוצאות בקטגוריה">זיכוי</span>' : ''}
      </div>
      ${t.note ? `<div class="note">${escapeHtml(t.note)}</div>` : ''}
    </td>
    <td>
      <span class="cat-dot" style="background:${cat?.color || '#999'}"></span>
      <select class="inline-select" data-action="category" aria-label="קטגוריה">${categoryOptions(cats, t.categoryId)}</select>
    </td>
    <td>${sourceBadge(t.source)}</td>
    <td class="amount-col ${t.type === 'income' || t.refund ? 'amount-income' : 'amount-expense'}">
      ${t.type === 'income' || t.refund ? '+' : ''}${money(t.type === 'income' || t.refund ? t.amount : -t.amount)}
    </td>
    <td class="row-actions">
      ${t.type === 'expense' ? `<button type="button" class="icon-btn ${t.isCardPayment ? 'active' : ''}" data-action="card"
          title="${t.isCardPayment ? 'בטל סימון חיוב כרטיס אשראי' : 'סמן כחיוב כרטיס אשראי (לא ייספר)'}" aria-label="סימון חיוב כרטיס אשראי">💳</button>` : ''}
      <button type="button" class="icon-btn" data-action="edit" title="עריכה" aria-label="עריכה">✎</button>
      <button type="button" class="icon-btn danger" data-action="delete" title="מחיקה" aria-label="מחיקה">🗑</button>
    </td>
  </tr>`;
}

/** Wire events once on a container that holds the list (event delegation). */
export function bindTxList(root, rerender) {
  root.addEventListener('change', async (e) => {
    const filter = e.target.dataset.filter;
    if (filter === 'category') { view.categoryFilter = e.target.value; rerender(); return; }
    if (filter === 'source') { view.sourceFilter = e.target.value; rerender(); return; }
    if (e.target.dataset.action === 'category') {
      const tx = findTx(e.target);
      await saveTransaction({ ...tx, categoryId: e.target.value });
      toast('הקטגוריה עודכנה. תנועות עתידיות עם אותו תיאור יסווגו כך.');
    }
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
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.tagName === 'SELECT') return;
    const tx = findTx(btn);
    if (!tx) return;
    if (btn.dataset.action === 'edit') openTxForm(tx);
    if (btn.dataset.action === 'card') {
      await saveTransaction({ ...tx, isCardPayment: !tx.isCardPayment });
      toast(tx.isCardPayment ? 'הסימון בוטל — התנועה נספרת בהוצאות' : 'סומן כחיוב כרטיס אשראי — לא נספר בהוצאות');
    }
    if (btn.dataset.action === 'delete') {
      const ok = await confirmDialog(`למחוק את התנועה "${escapeHtml(tx.description)}" (${money(tx.amount)})?`, { okText: 'מחיקה', danger: true, title: 'מחיקת תנועה' });
      if (ok) { await deleteTransactions([tx.id]); toast('התנועה נמחקה'); }
    }
  });
}

function findTx(el) {
  const id = el.closest('tr[data-id]')?.dataset.id;
  return state.transactions.find((t) => t.id === id);
}
