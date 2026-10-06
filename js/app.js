// Entry point: routing, rendering, global shortcuts.
import { load, onChange, generateRecurring } from './store.js';
import { addMonths, currentMonth } from './format.js';
import { view, toast, $ } from './ui.js';
import { openTxForm } from './views/txform.js';
import { bindTxList } from './views/txlist.js';
import { renderDashboard, mountDashboard } from './views/dashboard.js';
import { renderSettings, bindSettings } from './views/settings.js';
import { renderUpload, bindUpload } from './views/upload.js';

const main = $('#main');

function route() {
  const [page = 'dashboard', sub] = location.hash.replace(/^#/, '').split('/');
  return { page, sub };
}

function render() {
  const { page, sub } = route();
  const focus = rememberFocus();
  const scroll = window.scrollY;

  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  main.dataset.page = page;
  if (page === 'settings') main.innerHTML = renderSettings(sub);
  else if (page === 'upload') main.innerHTML = renderUpload();
  else { main.innerHTML = renderDashboard(); mountDashboard(); }

  restoreFocus(focus);
  const key = `${page}/${sub}`;
  window.scrollTo(0, key === lastRendered ? scroll : 0);
  lastRendered = key;
}
let lastRendered = '';

// Re-rendering replaces the DOM; keep keyboard focus on "the same" field.
function rememberFocus() {
  const el = document.activeElement;
  if (!el || !main.contains(el)) return null;
  const row = el.closest('[data-cat],[data-rule],[data-rec],[data-id],[data-rid]');
  const rowAttr = row && ['data-cat', 'data-rule', 'data-rec', 'data-id', 'data-rid'].find((a) => row.hasAttribute(a));
  const own = ['data-field', 'data-rf', 'data-filter', 'data-total-budget', 'data-rule-search', 'data-rule-test', 'data-action']
    .find((a) => el.hasAttribute(a));
  if (!own) return null;
  let sel = `[${own}${el.getAttribute(own) ? `="${CSS.escape(el.getAttribute(own))}"` : ''}]`;
  if (rowAttr) sel = `[${rowAttr}="${CSS.escape(row.getAttribute(rowAttr))}"] ${sel}`;
  return sel;
}
function restoreFocus(sel) {
  if (!sel) return;
  const el = main.querySelector(sel);
  if (el) el.focus({ preventScroll: true });
}

// month navigation (dashboard)
main.addEventListener('click', (e) => {
  const step = e.target.closest('[data-month-step]');
  if (step) { view.month = addMonths(view.month, Number(step.dataset.monthStep)); render(); }
  if (e.target.closest('[data-month-today]')) { view.month = currentMonth(); render(); }
});
main.addEventListener('change', (e) => {
  if (e.target.matches('[data-month-input]') && e.target.value) { view.month = e.target.value; render(); }
});

bindTxList(main, render);
bindSettings(main, render);
bindUpload(main, render);

document.querySelectorAll('[data-add-tx]').forEach((b) => b.addEventListener('click', () => openTxForm()));

// Shortcut: "+" opens the form (when not typing in a field)
document.addEventListener('keydown', (e) => {
  if ((e.key === '+' || e.key === 'Insert') && !e.target.closest('input,select,textarea,[contenteditable]') && !document.querySelector('.modal')) {
    e.preventDefault();
    openTxForm();
  }
});

window.addEventListener('hashchange', render);

// A new month may start while the app stays open.
let lastMonth = currentMonth();
setInterval(async () => {
  if (currentMonth() !== lastMonth) {
    lastMonth = currentMonth();
    const n = await generateRecurring();
    if (n) toast(`נוספו ${n} תנועות קבועות לחודש החדש`);
  }
}, 60 * 1000);

(async function start() {
  try {
    navigator.storage?.persist?.(); // ask the browser not to evict our data
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    await load();
    onChange(render);
    render();
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="card"><h2>שגיאה בטעינת הנתונים</h2><p>${String(err.message || err)}</p></div>`;
  }
})();
