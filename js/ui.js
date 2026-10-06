// Shared UI helpers: modal, toast, confirm, month navigator, small widgets.
import { escapeHtml, formatMonth, currentMonth } from './format.js';

/** UI state shared between views (kept only in memory). */
export const view = {
  month: currentMonth(),
  categoryFilter: '',
  sourceFilter: '',
  search: '',
};

export const SOURCES = {
  manual: { label: 'ידני', cls: 'src-manual' },
  checking: { label: 'עו"ש', cls: 'src-checking' },
  credit: { label: 'אשראי', cls: 'src-credit' },
};

export function sourceBadge(source) {
  const s = SOURCES[source] || SOURCES.manual;
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

// ---------- modal ----------

export function openModal({ title, body, wide = false, onClose }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <header class="modal-head">
        <h2>${escapeHtml(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button>
      </header>
      <div class="modal-body">${body}</div>
    </div>`;
  document.body.appendChild(backdrop);
  const previouslyFocused = document.activeElement;

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    previouslyFocused?.focus?.();
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && document.body.lastElementChild === backdrop) { e.preventDefault(); close(); }
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('[data-close]').addEventListener('click', close);
  return { el: backdrop.querySelector('.modal'), close };
}

export function confirmDialog(message, { okText = 'אישור', cancelText = 'ביטול', danger = false, title = 'אישור' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const { el, close } = openModal({
      title,
      body: `<p class="confirm-text">${message}</p>
        <div class="form-actions">
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${escapeHtml(okText)}</button>
          <button type="button" class="btn btn-ghost" data-cancel>${escapeHtml(cancelText)}</button>
        </div>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    el.querySelector('[data-ok]').addEventListener('click', () => { answered = true; close(); resolve(true); });
    el.querySelector('[data-cancel]').addEventListener('click', () => { answered = true; close(); resolve(false); });
    el.querySelector('[data-ok]').focus();
  });
}

// ---------- toast ----------

export function toast(message, kind = 'ok') {
  let host = $('#toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.setAttribute('role', 'status');
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => t.classList.add('toast-out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

// ---------- month navigator ----------

export function monthNav() {
  const isCurrent = view.month === currentMonth();
  return `
    <div class="month-nav">
      <button type="button" class="icon-btn" data-month-step="-1" aria-label="החודש הקודם">›</button>
      <label class="month-label">
        <span>${formatMonth(view.month)}</span>
        <input type="month" value="${view.month}" data-month-input aria-label="בחירת חודש">
      </label>
      <button type="button" class="icon-btn" data-month-step="1" aria-label="החודש הבא">‹</button>
      ${isCurrent ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-month-today>לחודש הנוכחי</button>'}
    </div>`;
}

/** Category <option>s for a given kind. */
export function categoryOptions(categories, selectedId) {
  return categories
    .map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
}

export function downloadFile(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
