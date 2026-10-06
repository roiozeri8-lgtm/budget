// Monthly dashboard: summary cards, budget alerts, doughnut by category, budgets, transaction list.
import { state, categoriesOf, transactionsOfMonth, getCategory, expenseValue } from '../store.js';
import { money, formatMoneyText, escapeHtml, formatMonth } from '../format.js';
import { view, monthNav } from '../ui.js';
import { renderTxList } from './txlist.js';

const MAX_SLICES = 7; // more than that folds into "אחר"
let chart = null;

export function computeMonth(month) {
  const txs = transactionsOfMonth(month);
  const income = sum(txs.filter((t) => t.type === 'income'));
  const counted = txs.filter((t) => t.type === 'expense' && !t.isCardPayment);
  const expenses = counted.reduce((s, t) => s + expenseValue(t), 0);
  const cardPayments = sum(txs.filter((t) => t.type === 'expense' && t.isCardPayment));

  const byCategory = new Map();
  for (const t of counted) byCategory.set(t.categoryId, (byCategory.get(t.categoryId) || 0) + expenseValue(t));

  const budgets = categoriesOf('expense')
    .filter((c) => c.budget > 0)
    .map((c) => {
      const spent = byCategory.get(c.id) || 0;
      return { cat: c, spent, budget: c.budget, pct: spent / c.budget, remaining: c.budget - spent };
    });

  const categoryBudgetSum = budgets.reduce((s, b) => s + b.budget, 0);
  const totalBudget = state.settings.totalBudget > 0 ? state.settings.totalBudget : categoryBudgetSum || null;
  return { txs, income, expenses, cardPayments, byCategory, budgets, totalBudget };
}

const sum = (list) => list.reduce((s, t) => s + t.amount, 0);

function level(pct) {
  if (pct > 1) return { cls: 'lvl-over', icon: '⛔', label: 'חריגה' };
  if (pct >= 0.8) return { cls: 'lvl-warn', icon: '⚠️', label: 'מתקרב לתקרה' };
  return { cls: 'lvl-ok', icon: '✓', label: 'בתקציב' };
}

export function renderDashboard() {
  const m = computeMonth(view.month);
  const balance = m.income - m.expenses;
  const pctSpent = m.income > 0 ? m.expenses / m.income : null;

  const remainingBase = m.totalBudget ?? (m.income > 0 ? m.income : null);
  const remaining = remainingBase != null ? remainingBase - m.expenses : null;
  const remainingNote = m.totalBudget
    ? `מתוך תקציב של ${money(m.totalBudget)}`
    : m.income > 0 ? 'לפי ההכנסות החודש (לא הוגדר תקציב)' : 'הגדירו תקציב או הוסיפו הכנסות';

  const alerts = m.budgets.filter((b) => b.pct >= 0.8).sort((a, b) => b.pct - a.pct);
  if (m.totalBudget && m.expenses / m.totalBudget >= 0.8) {
    alerts.unshift({ cat: { name: 'התקציב הכולל' }, pct: m.expenses / m.totalBudget, remaining: m.totalBudget - m.expenses });
  }

  const slices = [...m.byCategory.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  return `
  <div class="page-head">
    <h1>לוח בקרה</h1>
    ${monthNav()}
  </div>

  <section class="stats">
    <div class="stat"><span class="stat-label">הכנסות</span><span class="stat-value amount-income">${money(m.income)}</span></div>
    <div class="stat"><span class="stat-label">הוצאות</span><span class="stat-value">${money(m.expenses)}</span>
      ${m.cardPayments ? `<span class="stat-sub">לא נספרו חיובי אשראי מרוכזים: ${money(m.cardPayments)}</span>` : ''}</div>
    <div class="stat"><span class="stat-label">יתרה</span><span class="stat-value ${balance < 0 ? 'amount-negative' : ''}">${money(balance)}</span>
      <span class="stat-sub">הכנסות פחות הוצאות</span></div>
    <div class="stat"><span class="stat-label">הוצא מההכנסה</span>
      <span class="stat-value">${pctSpent == null ? '—' : `<span class="num">${Math.round(pctSpent * 100)}%</span>`}</span>
      ${pctSpent == null ? '<span class="stat-sub">אין הכנסות בחודש הזה</span>' : `<div class="bar"><div class="bar-fill ${level(pctSpent).cls}" style="width:${Math.min(100, pctSpent * 100)}%"></div></div>`}</div>
  </section>

  <section class="remaining card ${remaining != null && remaining < 0 ? 'remaining-over' : ''}">
    <div>
      <span class="remaining-label">${remaining != null && remaining < 0 ? 'חרגת החודש ב־' : 'נשאר לך להוציא החודש'}</span>
      <span class="remaining-value">${remaining == null ? '—' : money(Math.abs(remaining))}</span>
    </div>
    <span class="muted">${remainingNote}</span>
  </section>

  ${alerts.length ? `
  <section class="alerts" role="alert">
    ${alerts.map((a) => {
      const l = level(a.pct);
      return `<div class="alert ${l.cls}"><span class="alert-icon" aria-hidden="true">${l.icon}</span>
        <span><b>${escapeHtml(a.cat.name)}</b>: ${a.pct > 1
          ? `עברת את התקרה ב־${money(-a.remaining)} (<span class="num">${Math.round(a.pct * 100)}%</span>)`
          : `ניצלת <span class="num">${Math.round(a.pct * 100)}%</span> מהתקציב — נשארו ${money(a.remaining)}`}</span></div>`;
    }).join('')}
  </section>` : ''}

  <div class="grid-2">
    <section class="card">
      <h2>הוצאות לפי קטגוריה</h2>
      ${slices.length === 0 ? '<p class="empty">אין הוצאות בחודש הזה.</p>' : `
      <div class="pie-wrap"><canvas id="pie" role="img" aria-label="גרף עוגה של ההוצאות לפי קטגוריה ב${formatMonth(view.month)}"></canvas></div>
      <table class="legend-table">
        <tbody>
        ${slices.map(([id, amount]) => {
          const c = getCategory(id);
          return `<tr><td><span class="cat-dot" style="background:${c?.color || '#999'}"></span>${escapeHtml(c?.name || 'ללא קטגוריה')}</td>
            <td class="amount-col">${money(amount)}</td>
            <td class="pct-col"><span class="num">${((amount / m.expenses) * 100).toFixed(1)}%</span></td></tr>`;
        }).join('')}
        </tbody>
      </table>`}
    </section>

    <section class="card">
      <div class="section-head"><h2>תקציב לפי קטגוריה</h2><a href="#settings/categories" class="link-sm">הגדרת תקציבים</a></div>
      ${m.budgets.length === 0 ? '<p class="empty">עדיין לא הוגדרו תקציבים. אפשר להגדיר תקרה חודשית לכל קטגוריה במסך ההגדרות.</p>' : `
      <ul class="budget-list">
        ${m.budgets.sort((a, b) => b.pct - a.pct).map((b) => {
          const l = level(b.pct);
          return `<li>
            <div class="budget-row">
              <span><span class="cat-dot" style="background:${b.cat.color}"></span>${escapeHtml(b.cat.name)}</span>
              <span class="muted">${money(b.spent)} / ${money(b.budget)}</span>
            </div>
            <div class="bar" title="${Math.round(b.pct * 100)}%"><div class="bar-fill ${l.cls}" style="width:${Math.min(100, b.pct * 100)}%"></div></div>
            <div class="budget-row small">
              <span class="lvl-text ${l.cls}">${l.icon} ${l.label} · <span class="num">${Math.round(b.pct * 100)}%</span></span>
              <span>${b.remaining >= 0 ? `נשאר ${money(b.remaining)}` : `חריגה של ${money(-b.remaining)}`}</span>
            </div>
          </li>`;
        }).join('')}
      </ul>`}
      ${unbudgetedHtml(m)}
    </section>
  </div>

  ${renderTxList()}`;
}

function unbudgetedHtml(m) {
  const rows = [...m.byCategory.entries()]
    .filter(([id, v]) => v > 0 && !(getCategory(id)?.budget > 0))
    .sort((a, b) => b[1] - a[1]);
  if (!rows.length || !m.budgets.length) return '';
  return `<details class="unbudgeted"><summary>קטגוריות ללא תקציב (${rows.length})</summary>
    <ul>${rows.map(([id, amt]) => `<li><span>${escapeHtml(getCategory(id)?.name || 'ללא קטגוריה')}</span>${money(amt)}</li>`).join('')}</ul></details>`;
}

/** Draw the doughnut after the HTML is in the DOM. */
export function mountDashboard() {
  chart?.destroy();
  chart = null;
  const canvas = document.getElementById('pie');
  if (!canvas || !window.Chart) return;
  const m = computeMonth(view.month);
  const entries = [...m.byCategory.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  let top = entries.slice(0, MAX_SLICES);
  const rest = entries.slice(MAX_SLICES);
  if (rest.length) top = [...top, ['__other', rest.reduce((s, [, v]) => s + v, 0)]];

  const css = getComputedStyle(document.documentElement);
  const surface = css.getPropertyValue('--surface').trim();
  const ink = css.getPropertyValue('--text').trim();

  chart = new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: top.map(([id]) => (id === '__other' ? 'אחר' : getCategory(id)?.name || 'ללא קטגוריה')),
      datasets: [{
        data: top.map(([, v]) => v),
        backgroundColor: top.map(([id]) => (id === '__other' ? '#b8b7b0' : getCategory(id)?.color || '#999')),
        borderColor: surface,
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: '58%',
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          textDirection: 'rtl',
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${formatMoneyText(ctx.parsed)} (${((ctx.parsed / m.expenses) * 100).toFixed(1)}%)`,
          },
        },
      },
    },
    plugins: [{
      id: 'centerText',
      afterDraw(c) {
        const { ctx, chartArea: a } = c;
        ctx.save();
        ctx.fillStyle = ink;
        ctx.textAlign = 'center';
        ctx.direction = 'ltr';
        ctx.font = '600 15px system-ui, "Segoe UI", Arial';
        ctx.fillText(formatMoneyText(m.expenses), (a.left + a.right) / 2, (a.top + a.bottom) / 2 + 5);
        ctx.restore();
      },
    }],
  });
}
