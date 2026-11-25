// Home screen: what's left to spend, forecast, insights, categories & budgets, upcoming charges, trend.
import {
  state, categoriesOf, getCategory, periodOf, currentBudgetMonth, saveRecurring, setSetting,
} from '../store.js';
import {
  monthSummary, forecast, categoryAverages, upcoming, monthlyTrend, detectRecurring, categorySpikes, pendingCharges,
} from '../analytics.js';
import { money, formatMoneyText, escapeHtml, formatMonth, compactMoney, currentMonth, daysBetween, todayISO, addDays } from '../format.js';
import { view, monthNav, avatar, ring, emptyState, toast } from '../ui.js';
import { icon } from '../icons.js';
import { txRow } from './txlist.js';

const MAX_SLICES = 7; // more than that folds into "אחר"
let pie = null;
let trend = null;
let recurringCandidates = [];

function level(pct) {
  if (pct > 1) return { cls: 'lvl-over', icon: 'alert', label: 'חריגה' };
  if (pct >= 0.8) return { cls: 'lvl-warn', icon: 'alert', label: 'מתקרב לתקרה' };
  return { cls: 'lvl-ok', icon: 'check', label: 'בתקציב' };
}

const shortName = (name) => (name || 'ללא קטגוריה').replace(/\s*\(.*\)\s*/, '');

export function renderDashboard() {
  const month = view.month;
  const cur = currentBudgetMonth();
  const s = monthSummary(month);
  const f = forecast(month);
  const balance = s.income - s.expenses;

  // ---- what's left ----
  const base = s.base;
  const baseLabel = { budget: 'מתוך התקציב החודשי', income: 'מתוך ההכנסות החודש', categories: 'מתוך תקרות הקטגוריות' }[s.baseKind] || '';
  const baseWord = { budget: 'התקציב', income: 'ההכנסות', categories: 'התקציב' }[s.baseKind] || 'התקציב';
  let committed = s.expenses;
  if (month > cur) committed += pendingCharges(month).reduce((a, x) => a + x.amount, 0);
  const remaining = f ? f.remaining : base == null ? null : base - committed;
  const used = f ? s.expenses + f.pendingTotal : committed;
  const over = remaining != null && remaining < 0;

  const budgets = categoriesOf('expense').filter((c) => c.budget > 0).map((c) => {
    const spent = s.byCategory.get(c.id) || 0;
    return { cat: c, spent, budget: c.budget, pct: spent / c.budget, remaining: c.budget - spent };
  });
  const alerts = budgets.filter((b) => b.pct >= 0.8).sort((a, b) => b.pct - a.pct);

  return `
  <div class="page-head">
    <h1>${month === cur ? 'החודש שלך' : formatMonth(month)}</h1>
    ${monthNav(periodOf(month), month === cur)}
  </div>

  ${reminderHtml()}

  <section class="hero ${over ? 'hero-over' : ''}">
    <div class="hero-main">
      <span class="hero-label">${over ? 'חרגת ב־' : month < cur ? 'נשאר בסוף החודש' : 'נשאר לך להוציא'}</span>
      <span class="hero-value">${remaining == null ? '—' : money(Math.abs(remaining))}</span>
      <span class="hero-sub">${heroSub(f, base, baseLabel, month, cur)}</span>
    </div>
    ${base ? `<div class="hero-ring">${ring(used / base, 96, 10)}<span class="hero-ring-text"><b>${Math.round((used / base) * 100)}%</b><small>נוצל</small></span></div>` : ''}
  </section>

  <section class="kpis">
    <div class="kpi"><span class="kpi-label">${icon('plus', 16)} הכנסות</span><span class="kpi-value is-positive">${money(s.income)}</span></div>
    <div class="kpi"><span class="kpi-label">${icon('card', 16)} הוצאות</span><span class="kpi-value">${money(s.expenses)}</span>
      ${s.cardPayments ? `<span class="kpi-sub">לא כולל חיובי אשראי מרוכזים</span>` : ''}</div>
    <div class="kpi"><span class="kpi-label">${icon('wallet', 16)} יתרה</span><span class="kpi-value ${balance < 0 ? 'is-negative' : ''}">${money(balance)}</span>
      <span class="kpi-sub">הכנסות פחות הוצאות</span></div>
    ${f ? `<div class="kpi"><span class="kpi-label">${icon('chart', 16)} תחזית לסוף החודש</span>
      <span class="kpi-value ${f.base && f.forecastTotal > f.base ? 'is-negative' : ''}">${money(f.forecastTotal)}</span>
      <span class="kpi-sub">${f.base ? (f.forecastTotal > f.base ? `מעל ${baseWord} ב־${money(f.forecastTotal - f.base)}` : `בתוך ${baseWord} · ${money(f.base - f.forecastTotal)} פנוי`) : 'בקצב ההוצאות הנוכחי'}</span></div>`
    : `<div class="kpi"><span class="kpi-label">${icon('chart', 16)} הוצא מההכנסה</span>
      <span class="kpi-value">${s.income > 0 ? `<span class="num">${Math.round((s.expenses / s.income) * 100)}%</span>` : '—'}</span>
      <span class="kpi-sub">${s.income > 0 ? '' : 'אין הכנסות בחודש הזה'}</span></div>`}
  </section>

  ${alerts.length ? `
  <section class="alerts" role="alert">
    ${alerts.map((a) => {
      const l = level(a.pct);
      return `<div class="alert ${l.cls}">${icon(l.icon, 18)}
        <span><b>${escapeHtml(shortName(a.cat.name))}</b>: ${a.pct > 1
          ? `עברת את התקרה ב־${money(-a.remaining)} (<span class="num">${Math.round(a.pct * 100)}%</span>)`
          : `ניצלת <span class="num">${Math.round(a.pct * 100)}%</span> מהתקציב — נשארו ${money(a.remaining)}`}</span></div>`;
    }).join('')}
  </section>` : ''}

  ${insightsHtml(month, f, baseWord)}

  <div class="grid-2">
    ${categoriesHtml(month, s, budgets)}
    <div class="stack">
      ${upcomingHtml(month, cur)}
      ${recentHtml(s)}
    </div>
  </div>

  ${trendHtml(month)}`;
}

function heroSub(f, base, baseLabel, month, cur) {
  if (base == null) return `<a href="#settings/general" class="hero-link">הגדירו תקציב חודשי</a> או הוסיפו הכנסה כדי לראות כמה נשאר`;
  if (f) {
    const parts = [];
    if (f.perDay != null && f.remaining > 0) parts.push(`עד <b>${money(f.perDay)}</b> ליום · עוד ${f.daysLeft} ימים`);
    if (f.pendingTotal > 0) parts.push(`אחרי חיובים צפויים של ${money(f.pendingTotal)}`);
    parts.push(`${baseLabel} (${money(base)})`);
    return parts.join('<br>');
  }
  return month < cur ? `${baseLabel} (${money(base)})` : `אחרי חיובים שכבר ידועים · ${baseLabel} (${money(base)})`;
}

function reminderHtml() {
  if (!state.transactions.length) return '';
  const { lastBackup, lastSync, reminderSnooze } = state.settings;
  const last = [lastBackup, lastSync].filter(Boolean).sort().pop();
  const days = last ? daysBetween(last.slice(0, 10), todayISO()) : null;
  if (days != null && days < 14) return '';
  if (reminderSnooze && reminderSnooze > todayISO()) return '';
  return `
  <div class="banner">${icon('backup', 20)}
    <span>${days == null ? 'עוד לא גיבית את הנתונים.' : `עברו ${days} ימים מהגיבוי או הסנכרון האחרון.`}
      הנתונים שמורים רק במכשיר הזה — כדאי לייצא גיבוי ולסנכרן עם המכשיר השני.</span>
    <a href="#settings/backup" class="btn btn-sm btn-primary">לגיבוי וסנכרון</a>
    <button type="button" class="btn btn-sm btn-ghost" data-snooze>אחר כך</button>
  </div>`;
}

function insightsHtml(month, f, baseWord) {
  const items = [];
  if (month === currentBudgetMonth()) {
    recurringCandidates = detectRecurring();
    for (const c of recurringCandidates.slice(0, 4)) {
      const cat = getCategory(c.categoryId);
      items.push(`
      <div class="insight">
        ${avatar(cat, 'sm')}
        <span class="insight-text"><b>${escapeHtml(c.description)}</b> — ${money(c.amount)}<br>
          <small class="muted">${c.standing ? 'הוראת קבע' : `הופיע ב-${c.months} חודשים`}. חיוב קבוע? נצפה אותו בתחזית של כל חודש.</small></span>
        <span class="insight-actions">
          <button type="button" class="btn btn-sm btn-secondary" data-rec-yes="${escapeHtml(c.key)}">כן, קבוע</button>
          <button type="button" class="btn btn-sm btn-ghost" data-rec-no="${escapeHtml(c.key)}">לא</button>
        </span>
      </div>`);
    }
    if (f?.base && f.forecastTotal > f.base && f.daysElapsed >= 5) {
      items.unshift(`<div class="insight insight-warn">${icon('alert', 20)}
        <span class="insight-text">בקצב הנוכחי תסיים את החודש עם הוצאות של <b>${money(f.forecastTotal)}</b> — ${money(f.forecastTotal - f.base)} יותר מ${baseWord}.
        ${f.remaining > 0 ? `כדי לעמוד ביעד: עד ${money(f.remaining / f.daysLeft)} ליום עד סוף החודש.` : 'כבר עברת את היעד החודש — כדאי לצמצם הוצאות שאינן הכרחיות.'}</span></div>`);
    }
  }
  for (const sp of categorySpikes(month).slice(0, 2)) {
    items.push(`<div class="insight">${avatar(sp.cat, 'sm')}
      <span class="insight-text">על <b>${escapeHtml(shortName(sp.cat?.name))}</b> הוצאת ${money(sp.value)} — <span class="num">${Math.round(sp.pct * 100)}%</span> יותר מהממוצע שלך (${money(sp.avg)}).</span></div>`);
  }
  if (!items.length) return '';
  return `<section class="card insights"><h2>${icon('sparkles', 18)} תובנות</h2>${items.join('')}</section>`;
}

function categoriesHtml(month, s, budgets) {
  const { avg, months } = categoryAverages(month);
  const ids = new Set([...s.byCategory.keys(), ...budgets.map((b) => b.cat.id)]);
  const rows = [...ids].map((id) => ({ cat: getCategory(id), id, spent: Math.max(0, s.byCategory.get(id) || 0) }))
    .sort((a, b) => b.spent - a.spent);
  return `
  <section class="card">
    <div class="section-head"><h2>לאן הלך הכסף</h2><a href="#settings/categories" class="link-sm">תקציבים</a></div>
    ${rows.length === 0 ? emptyState('chart', 'אין הוצאות בחודש הזה') : `
    ${s.expenses > 0 ? `<div class="pie-wrap"><canvas id="pie" role="img" aria-label="התפלגות ההוצאות לפי קטגוריה ב${formatMonth(month)}"></canvas></div>` : ''}
    <ul class="cat-list">
      ${rows.map(({ cat, id, spent }) => {
        const b = budgets.find((x) => x.cat.id === id);
        const a = avg.get(id);
        let vs = '';
        if (months >= 1 && a > 0 && spent > 0) {
          const d = spent / a - 1;
          if (Math.abs(d) >= 0.1) vs = `<span class="vs ${d > 0.15 ? 'vs-up' : d < 0 ? 'vs-down' : ''}" title="לעומת הממוצע של ${months} החודשים הקודמים (${formatMoneyText(a)})">${icon(d > 0 ? 'up' : 'down', 12)}<span class="num">${Math.round(Math.abs(d) * 100)}%</span></span>`;
        }
        const l = b ? level(b.pct) : null;
        return `
        <li>
          <button type="button" class="cat-row" data-goto-cat="${escapeHtml(id)}" title="הצגת התנועות">
            ${avatar(cat, 'sm')}
            <span class="cat-row-main">
              <span class="cat-row-top"><span class="cat-row-name">${escapeHtml(shortName(cat?.name))}</span>${vs}
                <span class="cat-row-amount">${money(spent)}</span></span>
              ${b ? `<span class="bar"><span class="bar-fill ${l.cls}" style="width:${Math.min(100, b.pct * 100)}%"></span></span>
                <span class="cat-row-sub"><span class="lvl-text ${l.cls}">${l.label} · <span class="num">${Math.round(b.pct * 100)}%</span></span>
                <span>${b.remaining >= 0 ? `נשאר ${money(b.remaining)}` : `חריגה של ${money(-b.remaining)}`} מתוך ${money(b.budget)}</span></span>`
                : `<span class="cat-row-sub"><span class="muted"><span class="num">${s.expenses > 0 ? ((spent / s.expenses) * 100).toFixed(0) : 0}%</span> מההוצאות</span></span>`}
            </span>
          </button>
        </li>`;
      }).join('')}
    </ul>`}
  </section>`;
}

function upcomingHtml(month, cur) {
  const months = upcoming(4).filter((m) => m.items.length);
  return `
  <section class="card">
    <div class="section-head"><h2>${icon('calendar', 18)} חיובים צפויים</h2></div>
    ${months.length === 0
      ? `<p class="muted small">אין חיובים עתידיים ידועים. עסקאות בתשלומים וחיובים קבועים יופיעו כאן, כדי שתדע מה כבר "תפוס" מהחודשים הבאים.</p>`
      : months.map((m) => `
      <details class="upcoming" ${m.month === month || (month < cur && m.month === cur) ? 'open' : ''}>
        <summary><span>${m.month === cur ? 'עוד החודש' : formatMonth(m.month)}</span><b>${money(m.total)}</b></summary>
        <ul>${m.items.sort((a, b) => b.amount - a.amount).map((it) => `
          <li>${avatar(getCategory(it.categoryId), 'xs')}<span class="up-desc">${escapeHtml(it.description)}<small class="muted">${escapeHtml(it.note || (it.kind === 'scheduled' ? 'מתוכנן' : ''))}</small></span>${money(it.amount)}</li>`).join('')}
        </ul>
      </details>`).join('')}
  </section>`;
}

function recentHtml(s) {
  const recent = [...s.txs].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 5);
  return `
  <section class="card">
    <div class="section-head"><h2>תנועות אחרונות</h2><a href="#tx" class="link-sm">לכל התנועות</a></div>
    ${recent.length ? `<div class="tx-list">${recent.map((t) => txRow(t, { showDate: true })).join('')}</div>`
      : emptyState('wallet', 'אין תנועות בחודש הזה', '', '<button type="button" class="btn btn-primary btn-sm" data-add-tx>הוספת תנועה</button>')}
  </section>`;
}

function trendHtml(month) {
  const data = monthlyTrend(month, 6);
  if (data.filter((d) => d.hasData).length < 2) return '';
  return `
  <section class="card">
    <div class="section-head"><h2>${icon('chart', 18)} חצי שנה אחרונה</h2>
      <span class="legend"><span class="legend-item"><i class="sw sw-inc"></i>הכנסות</span><span class="legend-item"><i class="sw sw-exp"></i>הוצאות</span></span></div>
    <div class="trend-wrap"><canvas id="trend" role="img" aria-label="הכנסות והוצאות בשישה החודשים האחרונים"></canvas></div>
  </section>`;
}

// ---------- charts ----------

export function mountDashboard() {
  pie?.destroy(); pie = null;
  trend?.destroy(); trend = null;
  if (!window.Chart) return;
  const css = getComputedStyle(document.documentElement);
  const token = (n) => css.getPropertyValue(n).trim();
  const s = monthSummary(view.month);

  const canvas = document.getElementById('pie');
  if (canvas) {
    const entries = [...s.byCategory.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    let top = entries.slice(0, MAX_SLICES);
    const rest = entries.slice(MAX_SLICES);
    if (rest.length) top = [...top, ['__other', rest.reduce((a, [, v]) => a + v, 0)]];
    pie = new window.Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: top.map(([id]) => (id === '__other' ? 'אחר' : shortName(getCategory(id)?.name))),
        datasets: [{
          data: top.map(([, v]) => v),
          backgroundColor: top.map(([id]) => (id === '__other' ? '#b8b7b0' : getCategory(id)?.color || '#999')),
          borderColor: token('--surface'),
          borderWidth: 2,
          hoverOffset: 6,
        }],
      },
      options: {
        cutout: '64%',
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            rtl: true, textDirection: 'rtl',
            callbacks: { label: (ctx) => ` ${ctx.label}: ${formatMoneyText(ctx.parsed)} (${((ctx.parsed / s.expenses) * 100).toFixed(1)}%)` },
          },
        },
      },
      plugins: [{
        id: 'centerText',
        afterDraw(c) {
          const { ctx, chartArea: a } = c;
          const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.direction = 'ltr';
          ctx.fillStyle = token('--muted');
          ctx.font = '500 12px Heebo, system-ui, sans-serif';
          ctx.direction = 'rtl';
          ctx.fillText('הוצאות', x, y - 10);
          ctx.direction = 'ltr';
          ctx.fillStyle = token('--text');
          ctx.font = '700 16px Heebo, system-ui, sans-serif';
          ctx.fillText(formatMoneyText(s.expenses), x, y + 12);
          ctx.restore();
        },
      }],
    });
  }

  const tc = document.getElementById('trend');
  if (tc) {
    const data = monthlyTrend(view.month, 6);
    const grid = token('--grid');
    const ink = token('--muted');
    trend = new window.Chart(tc, {
      type: 'bar',
      data: {
        labels: data.map((d) => new Intl.DateTimeFormat('he-IL', { month: 'short' }).format(new Date(d.month + '-15'))),
        datasets: [
          { label: 'הכנסות', data: data.map((d) => d.income), backgroundColor: token('--series-inc'), borderRadius: 4, borderSkipped: 'start' },
          { label: 'הוצאות', data: data.map((d) => d.expenses), backgroundColor: token('--series-exp'), borderRadius: 4, borderSkipped: 'start' },
        ],
      },
      options: {
        maintainAspectRatio: false,
        datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.85 } },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, ticks: { color: ink, font: { family: 'Heebo' } }, border: { color: grid } },
          y: { grid: { color: grid }, border: { display: false }, ticks: { color: ink, maxTicksLimit: 5, callback: (v) => compactMoney(v), font: { family: 'Heebo' } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: { rtl: true, textDirection: 'rtl', callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatMoneyText(ctx.parsed.y)}` } },
        },
      },
    });
  }
}

// ---------- events ----------

export function bindDashboard(root, rerender) {
  root.addEventListener('click', async (e) => {
    const yes = e.target.closest('[data-rec-yes]');
    if (yes) {
      const c = recurringCandidates.find((x) => x.key === yes.dataset.recYes);
      if (!c) return;
      await saveRecurring({
        type: 'expense', amount: c.amount, description: c.description, categoryId: c.categoryId, note: '',
        day: c.day, mode: 'expected', matchKey: c.key, startMonth: currentMonth(), lastGenerated: currentMonth(), active: true,
      });
      toast(`"${c.description}" סומן כחיוב קבוע — יופיע בתחזית ובחיובים הצפויים`);
      return;
    }
    const no = e.target.closest('[data-rec-no]');
    if (no) {
      await setSetting('dismissedRecurring', [...(state.settings.dismissedRecurring || []), no.dataset.recNo]);
      return;
    }
    if (e.target.closest('[data-snooze]')) {
      await setSetting('reminderSnooze', addDays(todayISO(), 3));
      return;
    }
    const cat = e.target.closest('[data-goto-cat]');
    if (cat) {
      view.categoryFilter = cat.dataset.gotoCat;
      view.sourceFilter = '';
      view.search = '';
      location.hash = '#tx';
    }
  });
  void rerender;
}
