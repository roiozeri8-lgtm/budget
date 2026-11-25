// Shared UI helpers: sheets/modals, dialogs, toast, month navigator, small widgets.
import { escapeHtml, formatMonth, formatShortDate } from './format.js';
import { icon } from './icons.js';

/** UI state shared between views (kept only in memory). */
export const view = {
  month: null, // set after the data loads (depends on the budget-month setting)
  categoryFilter: '',
  sourceFilter: '',
  search: '',
};

export const SOURCES = {
  manual: { label: 'ידני', cls: 'src-manual' },
  applepay: { label: 'Apple Pay', cls: 'src-applepay' },
  checking: { label: 'עו"ש', cls: 'src-checking' },
  credit: { label: 'אשראי', cls: 'src-credit' },
};

export function sourceBadge(source) {
  const s = SOURCES[source] || SOURCES.manual;
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

/** Round emoji avatar in the category color. */
export function avatar(cat, size = 'md') {
  const color = cat?.color || '#8a8a85';
  return `<span class="avatar avatar-${size}" style="--c:${color}" aria-hidden="true">${escapeHtml(cat?.icon || '🏷️')}</span>`;
}

export function emptyState(iconName, title, text = '', action = '') {
  return `<div class="empty-state"><div class="empty-icon">${icon(iconName, 28)}</div>
    <p class="empty-title">${title}</p>${text ? `<p class="empty-text">${text}</p>` : ''}${action}</div>`;
}

// ---------- sheet / modal ----------

export function openModal({ title, body, wide = false, onClose, className = '' }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'modal-wide' : ''} ${className}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="sheet-grabber" aria-hidden="true"></div>
      <header class="modal-head">
        <h2>${escapeHtml(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="סגירה">${icon('close')}</button>
      </header>
      <div class="modal-body">${body}</div>
    </div>`;
  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');
  const previouslyFocused = document.activeElement;

  const close = () => {
    backdrop.classList.add('closing');
    setTimeout(() => {
      backdrop.remove();
      if (!document.querySelector('.modal-backdrop')) document.body.classList.remove('modal-open');
    }, 160);
    document.removeEventListener('keydown', onKey);
    previouslyFocused?.focus?.({ preventScroll: true });
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

/** Ask a question with several answers. Resolves with the chosen value, or null if dismissed. */
export function choiceDialog(message, choices, title = 'אישור') {
  return new Promise((resolve) => {
    let answered = false;
    const { el, close } = openModal({
      title,
      className: 'modal-dialog',
      body: `<p class="confirm-text">${message}</p>
        <div class="dialog-actions">
          ${choices.map((c, i) => `<button type="button" class="btn ${c.danger ? 'btn-danger' : c.primary ? 'btn-primary' : 'btn-ghost'}" data-choice="${i}">${escapeHtml(c.label)}</button>`).join('')}
        </div>`,
      onClose: () => { if (!answered) resolve(null); },
    });
    el.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', () => {
      answered = true;
      close();
      resolve(choices[Number(b.dataset.choice)].value);
    }));
    el.querySelector('.btn-primary, .btn-danger')?.focus();
  });
}

export async function confirmDialog(message, { okText = 'אישור', cancelText = 'ביטול', danger = false, title = 'אישור' } = {}) {
  const v = await choiceDialog(message, [
    { value: true, label: okText, danger, primary: !danger },
    { value: false, label: cancelText },
  ], title);
  return v === true;
}

/** Small dialog with one text field. Resolves with the text, or null. */
export function promptDialog({ title, message = '', value = '', okText = 'שמירה', placeholder = '' }) {
  return new Promise((resolve) => {
    let answered = false;
    const { el, close } = openModal({
      title,
      className: 'modal-dialog',
      body: `<form class="prompt-form">${message ? `<p class="confirm-text">${message}</p>` : ''}
        <input class="input" name="v" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" required>
        <div class="dialog-actions"><button class="btn btn-primary">${escapeHtml(okText)}</button>
        <button type="button" class="btn btn-ghost" data-cancel>ביטול</button></div></form>`,
      onClose: () => { if (!answered) resolve(null); },
    });
    const form = el.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = form.elements.v.value.trim();
      if (!v) return;
      answered = true; close(); resolve(v);
    });
    el.querySelector('[data-cancel]').addEventListener('click', close);
    form.elements.v.focus();
    form.elements.v.select();
  });
}

// ---------- toast ----------

export function toast(message, kind = 'ok', action = null) {
  let host = $('#toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.setAttribute('role', 'status');
  t.innerHTML = `<span>${escapeHtml(message)}</span>`;
  const ttl = action ? 6500 : 2800;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => { t.remove(); action.onClick(); });
    t.appendChild(b);
  }
  host.appendChild(t);
  setTimeout(() => t.classList.add('toast-out'), ttl);
  setTimeout(() => t.remove(), ttl + 400);
}

// ---------- month navigator ----------

export function monthNav(period, isCurrent) {
  const range = period && !period.from.endsWith('-01') ? `<span class="month-range">${formatShortDate(period.from)}–${formatShortDate(period.to)}</span>` : '';
  return `
    <div class="month-nav">
      <button type="button" class="icon-btn" data-month-step="-1" aria-label="החודש הקודם">${icon('prev')}</button>
      <label class="month-label">
        <span class="month-name">${formatMonth(view.month)}</span>${range}
        <input type="month" value="${view.month}" data-month-input aria-label="בחירת חודש">
      </label>
      <button type="button" class="icon-btn" data-month-step="1" aria-label="החודש הבא">${icon('next')}</button>
      ${isCurrent ? '' : '<button type="button" class="chip chip-sm" data-month-today>החודש</button>'}
    </div>`;
}

/** Category <option>s for a given list. */
export function categoryOptions(categories, selectedId) {
  return categories
    .map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(`${c.icon || ''} ${c.name}`.trim())}</option>`)
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

/** Progress ring (SVG). pct 0..1+ */
export function ring(pct, size = 92, stroke = 9) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}
