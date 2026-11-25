// Import screen: Apple Pay inbox file / pasted text, or bank screenshots (OCR) -> review -> save.
import { state, categoriesOf, fallbackCategory, saveTransactions, budgetMonthOf } from '../store.js';
import { suggestCategory, looksLikeCardPayment, duplicateKey, findDuplicates } from '../categorize.js';
import { escapeHtml, money, parseAmount, formatDate, normalizeText, round2 } from '../format.js';
import { categoryOptions, toast, sourceBadge, confirmDialog, view, $ } from '../ui.js';
import { icon } from '../icons.js';
import { ocrImage, analyseLines, defaultMapping, buildRows, AMOUNT_ROLES } from '../import/ocr.js';
import { parseInbox, isInboxFile } from '../import/inbox.js';
import { offerRule } from './ruleoffer.js';

const KIND_LABEL = { checking: 'עו"ש', credit: 'כרטיס אשראי', applepay: 'Apple Pay' };
const SOURCE_RANK = { manual: 0, applepay: 1, checking: 2, credit: 2 };

/** Everything here lives only in memory; images and files are never stored. */
const session = {
  files: [], // {id, file, name, isInbox, kind, status, progress, error, thumb, analysis, mapping, hidden}
  rows: [],
  busy: false,
  pasteOpen: false,
};
let seq = 0;
const nid = () => `n${++seq}`;
let rerenderFn = () => {};

// ---------- rendering ----------

export function renderUpload() {
  return `
  <div class="page-head"><h1>ייבוא תנועות</h1></div>
  ${session.rows.length ? reviewHtml() : ''}
  <div class="import-options ${session.rows.length ? 'is-compact' : ''}">
    <section class="card import-card">
      <div class="import-icon ic-applepay">${icon('phone', 26)}</div>
      <h2>Apple Pay מהאייפון</h2>
      <p class="muted">קיצור באייפון רושם כל תשלום ב-Apple Pay לקובץ. בוחרים כאן את הקובץ, ומה שכבר נקלט בעבר מדולג לבד.</p>
      <div class="import-actions">
        <label class="btn btn-primary">${icon('import', 18)} בחירת קובץ התשלומים
          <input type="file" accept=".txt,text/plain" data-file-input="inbox" class="visually-hidden"></label>
        <button type="button" class="btn btn-ghost" data-toggle-paste>הדבקת טקסט</button>
      </div>
      ${session.pasteOpen ? `
      <div class="paste-box">
        <textarea class="input" rows="4" data-paste-text placeholder="שורה לכל תשלום, למשל:&#10;2026-11-18|₪42.50|ארומה"></textarea>
        <button type="button" class="btn btn-secondary" data-paste-go>קליטה</button>
      </div>` : ''}
      <a href="#settings/applepay" class="link-sm">${icon('info', 14)} איך מגדירים את הקיצור באייפון (פעם אחת)</a>
    </section>

    <section class="card import-card">
      <div class="import-icon ic-shot">${icon('image', 26)}</div>
      <h2>צילום מסך מהבנק</h2>
      <p class="muted">צילום של תנועות העו"ש או של פירוט כרטיס האשראי. הפענוח נעשה במכשיר (OCR) — כדאי לבדוק את השורות.</p>
      <div class="dropzone" data-dropzone tabindex="0" role="button" aria-label="בחירת צילומי מסך">
        ${icon('import', 22)}
        <span><b>לחצו לבחירת צילומים</b><span class="hide-touch"> · גררו לכאן · או הדביקו עם Ctrl+V</span></span>
        <input type="file" multiple accept="image/*" data-file-input="image" class="visually-hidden">
      </div>
    </section>
  </div>
  ${session.files.some((f) => !f.isInbox) ? queueHtml() : ''}`;
}

function queueHtml() {
  const files = session.files.filter((f) => !f.isInbox);
  const pending = files.filter((f) => f.status === 'pending');
  const missingKind = pending.some((f) => !f.kind);
  return `
  <section class="card">
    <h2>צילומי מסך</h2>
    <ul class="queue">
      ${files.map((f) => `
      <li class="queue-item status-${f.status}" data-file="${f.id}">
        ${f.thumb ? `<img src="${f.thumb}" alt="" class="thumb">` : `<span class="thumb thumb-file" aria-hidden="true">${icon('image', 18)}</span>`}
        <div class="queue-main">
          <div class="queue-name">${escapeHtml(f.name)}</div>
          <div class="queue-status">${statusText(f)}</div>
          ${f.status === 'processing' ? `<div class="bar"><div class="bar-fill lvl-ok" style="width:${Math.round((f.progress || 0) * 100)}%"></div></div>` : ''}
        </div>
        <div class="seg-mini" role="radiogroup" aria-label="סוג הצילום">
          ${['checking', 'credit'].map((k) => `<button type="button" class="chip chip-sm ${f.kind === k ? 'active' : ''}" data-file-kind="${k}" ${f.status !== 'pending' ? 'disabled' : ''}>${KIND_LABEL[k]}</button>`).join('')}
        </div>
        <button type="button" class="icon-btn" data-remove-file aria-label="הסרה" ${f.status === 'processing' ? 'disabled' : ''}>${icon('close', 18)}</button>
      </li>`).join('')}
    </ul>
    ${pending.length ? `
    <div class="form-actions">
      <button type="button" class="btn btn-primary" data-process ${missingKind || session.busy ? 'disabled' : ''}>פענוח ${pending.length === 1 ? 'הצילום' : `${pending.length} צילומים`}</button>
      ${missingKind ? '<span class="hint">בחרו לכל צילום: עו"ש או כרטיס אשראי</span>' : ''}
    </div>` : ''}
  </section>`;
}

function statusText(f) {
  if (f.status === 'pending') return f.kind ? 'מוכן לפענוח' : 'בחרו את סוג הצילום';
  if (f.status === 'processing') return escapeHtml(f.progressText || 'מפענח…');
  if (f.status === 'error') return `<span class="text-bad">שגיאה: ${escapeHtml(f.error)}</span>`;
  const count = session.rows.filter((r) => r.fileId === f.id).length;
  return `פוענח: ${count} שורות · ${KIND_LABEL[f.kind] || ''}`;
}

function totals() {
  const active = session.rows.filter((r) => r.action !== 'skip');
  const expenses = active.filter((r) => r.type !== 'income' && !r.isCardPayment).reduce((s, r) => s + (r.type === 'refund' ? -1 : 1) * (Number(r.amount) || 0), 0);
  const income = active.filter((r) => r.type === 'income').reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return { active, expenses, income };
}

function reviewHtml() {
  const rows = session.rows;
  const { active, expenses, income } = totals();
  const dups = rows.filter((r) => r.dup).length;
  const uncertain = rows.filter((r) => r.uncertain).length;
  const hidden = session.files.reduce((s, f) => s + (f.hidden || 0), 0);

  return `
  <section class="card review" id="review">
    <div class="section-head">
      <h2>בדיקה לפני שמירה <span class="muted">(${rows.length})</span></h2>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-add-row>${icon('plus', 16)} שורה</button>
        <button type="button" class="btn btn-ghost btn-sm danger" data-clear-review>ביטול</button>
      </div>
    </div>
    ${session.files.filter((f) => f.analysis).map(mapperHtml).join('')}
    <div class="review-legend">
      ${hidden ? `<span class="legend-chip chip-ok">${icon('check', 14)} ${hidden} תשלומים כבר נקלטו בעבר ודולגו</span>` : ''}
      ${uncertain ? `<span class="legend-chip chip-uncertain">${uncertain} שורות לבדיקה — מסומנות בצהוב</span>` : ''}
      ${dups ? `<span class="legend-chip chip-dup">${dups} כפילויות אפשריות — מסומנות באדום</span>` : ''}
    </div>
    <div class="table-wrap">
    <table class="review-table">
      <thead><tr>
        <th>תאריך</th><th>תיאור</th><th>סכום (₪)</th><th>סוג</th><th>קטגוריה</th><th title="חיוב כרטיס אשראי מרוכז — לא נספר">חיוב אשראי</th><th>הערה</th><th>כפילות</th><th></th>
      </tr></thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table>
    </div>
    <div class="review-footer">
      <div data-review-summary>${summaryText(active.length, rows.length, expenses, income)}</div>
      <button type="button" class="btn btn-primary btn-lg" data-save-review>${icon('check', 18)} אישור ושמירה</button>
    </div>
  </section>`;
}

function summaryText(saving, all, expenses, income) {
  return `יישמרו <b>${saving}</b> מתוך ${all} · הוצאות ${money(expenses)}${income ? ` · הכנסות ${money(income)}` : ''}`;
}

function mapperHtml(f) {
  const a = f.analysis;
  const dateOpts = a.dateCols.map((c, i) => `<option value="${i}" ${f.mapping.date === i ? 'selected' : ''}>עמודה ${i + 1} מימין — למשל ${escapeHtml(c.samples.join(', '))}</option>`).join('');
  return `
  <details class="mapper" ${f.mapperOpen ? 'open' : ''} data-mapper="${f.id}">
    <summary>מבנה העמודות ב-${escapeHtml(f.name)} — לתיקון אם התאריכים או הסכומים לא נכונים</summary>
    <div class="mapper-body">
      <label class="field"><span class="field-label">עמודת התאריך</span>
        <select class="input" data-map-date>${dateOpts || '<option>לא נמצאו תאריכים</option>'}</select></label>
      ${a.amountCols.map((c, i) => `
        <label class="field"><span class="field-label">עמודת סכום ${i + 1} מימין <span class="muted">(${escapeHtml(c.samples.join(', '))})</span></span>
          <select class="input" data-map-amount="${i}">
            ${Object.entries(AMOUNT_ROLES).map(([k, label]) => `<option value="${k}" ${f.mapping.amounts[i] === k ? 'selected' : ''}>${label}</option>`).join('')}
          </select></label>`).join('')}
      <p class="hint">שינוי כאן בונה מחדש את השורות של הצילום הזה (תיקונים ידניים בשורות שלו יתאפסו).</p>
      <details><summary>הטקסט שזוהה</summary><pre class="raw-text">${escapeHtml(f.rawText || '')}</pre></details>
    </div>
  </details>`;
}

function rowHtml(r) {
  const kindCats = categoriesOf(r.type === 'income' ? 'income' : 'expense');
  const cls = [r.dup ? 'row-dup' : '', r.uncertain ? 'row-uncertain' : '', r.action === 'skip' ? 'row-skipped' : ''].join(' ');
  return `
  <tr data-rid="${r.rid}" class="${cls}">
    <td><input class="input" type="date" value="${escapeHtml(r.date)}" data-rf="date" aria-label="תאריך"></td>
    <td><input class="input desc-input" value="${escapeHtml(r.description)}" data-rf="description" aria-label="תיאור"></td>
    <td><input class="input amount-input" value="${r.amount === '' ? '' : Number(r.amount).toFixed(2)}" data-rf="amount" inputmode="decimal" aria-label="סכום"></td>
    <td><select class="input" data-rf="type" aria-label="סוג">
      <option value="expense" ${r.type === 'expense' ? 'selected' : ''}>הוצאה</option>
      <option value="refund" ${r.type === 'refund' ? 'selected' : ''}>זיכוי</option>
      <option value="income" ${r.type === 'income' ? 'selected' : ''}>הכנסה</option>
    </select></td>
    <td><select class="input" data-rf="categoryId" aria-label="קטגוריה">${categoryOptions(kindCats, r.categoryId)}</select></td>
    <td class="center">${r.type === 'expense' ? `<input type="checkbox" data-rf="isCardPayment" ${r.isCardPayment ? 'checked' : ''} aria-label="חיוב כרטיס אשראי">` : ''}</td>
    <td><input class="input note-input" value="${escapeHtml(r.note)}" data-rf="note" aria-label="הערה"></td>
    <td>${r.dup ? dupCell(r) : ''}</td>
    <td><button type="button" class="icon-btn" data-del-row aria-label="מחיקת שורה">${icon('trash', 18)}</button></td>
  </tr>`;
}

function dupCell(r) {
  const d = r.dup;
  const what = d.kind === 'batch' ? 'שורה זהה בקובץ אחר בייבוא הזה'
    : d.kind === 'loose' ? `ייתכן שזו אותה תנועה: ${escapeHtml(d.tx.description)} ${money(d.tx.amount)} (${formatDate(d.tx.date)}) ${sourceBadge(d.tx.source)}`
    : `כבר קיימת: ${escapeHtml(d.tx.description)} ${sourceBadge(d.tx.source)}`;
  return `<div class="dup-cell"><span class="dup-text">${what}</span>
    <select class="input" data-rf="action" aria-label="מה לעשות בכפילות">
      <option value="skip" ${r.action === 'skip' ? 'selected' : ''}>לדלג</option>
      ${d.tx ? `<option value="merge" ${r.action === 'merge' ? 'selected' : ''}>למזג עם הקיימת</option>` : ''}
      <option value="save" ${r.action === 'save' ? 'selected' : ''}>לשמור בכל זאת</option>
    </select></div>`;
}

// ---------- adding & processing ----------

function addFiles(fileList, hint) {
  const files = [...fileList];
  const inbox = files.filter((f) => hint === 'inbox' || isInboxFile(f));
  const images = files.filter((f) => !inbox.includes(f) && f.type.startsWith('image/'));
  if (!inbox.length && !images.length) { toast('אפשר לבחור קובץ טקסט של Apple Pay או תמונות', 'error'); return; }
  if (!location.hash.startsWith('#import')) location.hash = '#import';
  for (const file of inbox) readInbox(file);
  for (const file of images) {
    session.files.push({ id: nid(), file, name: file.name || 'צילום מסך מודבק', isInbox: false, kind: null, status: 'pending', thumb: URL.createObjectURL(file) });
  }
  rerenderFn();
}

async function readInbox(file) {
  try {
    addInboxText(await file.text(), file.name);
  } catch (err) {
    toast(`לא הצלחתי לקרוא את הקובץ: ${err.message}`, 'error');
  }
}

function addInboxText(text, name = 'טקסט מודבק') {
  const items = parseInbox(text);
  if (!items.length) { toast('לא נמצאו תשלומים בטקסט', 'error'); return; }
  const f = { id: nid(), name, isInbox: true, kind: 'applepay', status: 'done', hidden: 0 };
  session.files.push(f);
  addRows(f, items);
  // the inbox file keeps growing: payments imported before are hidden, not shown as duplicates
  const before = session.rows.length;
  session.rows = session.rows.filter((r) => !(r.fileId === f.id && r.dup?.kind === 'exact'));
  f.hidden = before - session.rows.length;
  if (!session.rows.some((r) => r.fileId === f.id)) {
    toast(f.hidden ? `כל ${f.hidden} התשלומים בקובץ כבר נקלטו בעבר — אין חדשים` : 'לא נמצאו תשלומים חדשים');
  }
  rerenderFn();
  setTimeout(() => $('#review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

async function processAll() {
  if (session.busy) return;
  session.busy = true;
  for (const f of session.files.filter((x) => x.status === 'pending')) {
    f.status = 'processing';
    f.progress = 0;
    rerenderFn();
    try {
      const ocr = await ocrImage(f.file, (text, p) => {
        f.progressText = `${text}… ${Math.round(p * 100)}%`;
        f.progress = p;
        const el = $(`[data-file="${f.id}"]`);
        if (el) {
          $('.queue-status', el).textContent = f.progressText;
          const bar = $('.bar-fill', el);
          if (bar) bar.style.width = `${Math.round(p * 100)}%`;
        }
      });
      f.analysis = analyseLines(ocr);
      f.rawText = ocr.text;
      f.mapping = defaultMapping(f.analysis, f.kind);
      f.mapperOpen = f.analysis.lines.length === 0;
      addRows(f, buildRows(f.analysis, f.mapping, f.kind));
      f.status = f.analysis.lines.length ? 'done' : 'error';
      if (!f.analysis.lines.length) f.error = 'לא זוהו שורות עם תאריך או סכום';
    } catch (err) {
      console.error(err);
      f.status = 'error';
      f.error = err.message || String(err);
    }
    if (f.thumb) { URL.revokeObjectURL(f.thumb); f.thumb = null; }
    f.file = null; // drop the image from memory
    rerenderFn();
  }
  session.busy = false;
  rerenderFn();
  $('#review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Turn parsed items into review rows: category, card-payment flag, duplicates. */
function addRows(file, items) {
  for (const it of items) {
    const type = it.type === 'income' ? 'income' : it.refund ? 'refund' : 'expense';
    const row = {
      rid: nid(),
      fileId: file.id,
      source: file.kind,
      date: it.date,
      description: it.description,
      amount: it.amount,
      type,
      note: it.note || '',
      uncertain: !!it.uncertain,
      isCardPayment: file.kind === 'checking' && type === 'expense' && looksLikeCardPayment(it.description),
      action: 'save',
    };
    row.categoryId = suggestFor(row);
    session.rows.push(row);
  }
  detectDuplicates();
}

function suggestFor(row) {
  const kind = row.type === 'income' ? 'income' : 'expense';
  return suggestCategory(row.description, kind)?.categoryId ?? fallbackCategory(kind);
}

const asTx = (r) => ({ date: r.date, description: r.description, amount: Number(r.amount) || 0, refund: r.type === 'refund' });

/**
 * Mark rows that duplicate an existing transaction: identical (date+description+amount), or the
 * same payment from another source (same amount, up to 3 days apart — e.g. entered by hand or
 * from Apple Pay, and now arriving from the bank). Also rows repeated across files in this batch.
 */
function detectDuplicates() {
  const claimed = new Set();
  const seen = new Map();
  for (const r of session.rows) {
    const prevDup = r.dup;
    r.dup = null;
    if (!r.date || r.amount === '') continue;
    const exact = findDuplicates(asTx(r)).find((t) => !claimed.has(t.id));
    if (exact) {
      r.dup = { kind: 'exact', tx: exact };
      claimed.add(exact.id);
    } else {
      const loose = state.transactions.find((t) => !claimed.has(t.id) && t.source !== r.source
        && t.type === (r.type === 'income' ? 'income' : 'expense')
        && Math.abs(t.amount - Number(r.amount)) < 0.005
        && Math.abs(new Date(t.date) - new Date(r.date)) <= 3 * 864e5);
      if (loose) { r.dup = { kind: 'loose', tx: loose }; claimed.add(loose.id); }
    }
    const key = duplicateKey(asTx(r));
    const other = seen.get(key);
    if (!r.dup && other && other !== r.fileId) r.dup = { kind: 'batch' };
    if (!seen.has(key)) seen.set(key, r.fileId);

    if (r.dup && (!prevDup || prevDup.kind !== r.dup.kind || prevDup.tx !== r.dup.tx)) {
      // a more detailed source replaces a less detailed one (manual < Apple Pay < bank)
      r.action = r.dup.kind === 'loose' && (SOURCE_RANK[r.source] ?? 2) > (SOURCE_RANK[r.dup.tx.source] ?? 2) ? 'merge' : 'skip';
    }
    if (!r.dup && prevDup) r.action = 'save';
  }
}

// ---------- saving ----------

async function saveReview() {
  const problems = session.rows.filter((r) => r.action !== 'skip'
    && (!r.date || !(Number(r.amount) > 0) || !r.description.trim()));
  if (problems.length) {
    toast(`יש ${problems.length} שורות בלי תאריך, תיאור או סכום — תקנו או מחקו אותן`, 'error');
    const el = $(`[data-rid="${problems[0].rid}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.querySelector('input')?.focus();
    return null;
  }
  const toSave = [];
  let merged = 0, skipped = 0;
  for (const r of session.rows) {
    if (r.action === 'skip') { skipped++; continue; }
    const tx = {
      date: r.date,
      description: r.description.trim(),
      amount: Number(r.amount),
      type: r.type === 'income' ? 'income' : 'expense',
      refund: r.type === 'refund',
      categoryId: r.categoryId,
      note: r.note,
      source: r.source || 'credit',
      isCardPayment: r.type === 'expense' && r.isCardPayment,
    };
    if (r.action === 'merge' && r.dup?.tx) {
      // keep the existing entry's id, category and note; take the more detailed source's details
      const ex = r.dup.tx;
      toSave.push({ ...ex, ...tx, id: ex.id, categoryId: ex.categoryId, note: ex.note || tx.note, createdAt: ex.createdAt });
      merged++;
    } else {
      toSave.push(tx);
    }
  }
  if (!toSave.length) { toast('אין שורות לשמירה', 'error'); return null; }
  await saveTransactions(toSave);
  const added = toSave.length - merged;
  const months = [...new Set(toSave.map((t) => budgetMonthOf(t.date)))].sort();
  session.rows = [];
  session.files = session.files.filter((f) => f.status === 'pending');
  rerenderFn();
  toast(`נשמרו ${added} תנועות${merged ? `, ${merged} מוזגו` : ''}${skipped ? `, ${skipped} דולגו` : ''}`);
  return months;
}

// ---------- events ----------

export function bindUpload(root, rerender) {
  rerenderFn = () => { if (location.hash.startsWith('#import')) rerender(); };

  // paste an image anywhere in the app (except inside a text field)
  document.addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files, 'image'); }
  });

  root.addEventListener('click', (e) => {
    const dz = e.target.closest('[data-dropzone]');
    if (dz && !e.target.matches('[data-file-input]')) $('[data-file-input="image"]', root)?.click();
  });
  root.addEventListener('keydown', (e) => {
    if (e.target.matches('[data-dropzone]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('[data-file-input="image"]', root)?.click(); }
    if (e.key === 'Enter' && e.target.closest('.review-table') && e.target.tagName === 'INPUT') {
      e.preventDefault(); // Enter moves to the same cell in the next row
      e.target.closest('tr').nextElementSibling?.querySelector(`[data-rf="${e.target.dataset.rf}"]`)?.focus();
    }
  });
  root.addEventListener('dragover', (e) => {
    if (!location.hash.startsWith('#import')) return;
    e.preventDefault();
    $('[data-dropzone]', root)?.classList.add('dragging');
  });
  root.addEventListener('dragleave', (e) => e.target.closest('[data-dropzone]')?.classList.remove('dragging'));
  root.addEventListener('drop', (e) => {
    if (!location.hash.startsWith('#import')) return;
    e.preventDefault();
    $('[data-dropzone]', root)?.classList.remove('dragging');
    addFiles(e.dataTransfer.files);
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-file-input]')) { addFiles(t.files, t.dataset.fileInput); t.value = ''; return; }

    const mapper = t.closest('[data-mapper]');
    if (mapper) {
      const f = session.files.find((x) => x.id === mapper.dataset.mapper);
      if (t.matches('[data-map-date]')) f.mapping.date = Number(t.value);
      if (t.matches('[data-map-amount]')) f.mapping.amounts[Number(t.dataset.mapAmount)] = t.value;
      f.mapperOpen = true;
      session.rows = session.rows.filter((r) => r.fileId !== f.id);
      addRows(f, buildRows(f.analysis, f.mapping, f.kind));
      rerenderFn();
      return;
    }

    const tr = t.closest('[data-rid]');
    if (!tr || !t.dataset.rf) return;
    const r = session.rows.find((x) => x.rid === tr.dataset.rid);
    const field = t.dataset.rf;
    if (field === 'amount') {
      const v = parseAmount(t.value);
      if (isFinite(v) && v !== 0) {
        r.amount = round2(Math.abs(v));
        if (v < 0 && r.type === 'expense' && r.source !== 'checking') r.type = 'refund';
      } else r.amount = '';
      r.uncertain = false;
      detectDuplicates();
      rerenderFn();
    } else if (field === 'isCardPayment') {
      r.isCardPayment = t.checked;
      updateSummary();
    } else if (field === 'type') {
      const wasIncome = r.type === 'income';
      r.type = t.value;
      if (wasIncome !== (r.type === 'income')) r.categoryId = suggestFor(r);
      if (r.type !== 'expense') r.isCardPayment = false;
      detectDuplicates();
      rerenderFn();
    } else if (field === 'categoryId') {
      r.categoryId = t.value;
      r.categoryTouched = true;
      let n = 0; // same merchant elsewhere in this import gets the same category
      for (const o of session.rows) {
        if (o !== r && !o.categoryTouched && o.type === r.type && normalizeText(o.description) === normalizeText(r.description)) { o.categoryId = r.categoryId; n++; }
      }
      if (n) { rerenderFn(); toast(`עודכנו גם ${n} שורות נוספות של "${r.description}"`); }
      offerRule(r.description, r.categoryId, r.type === 'income' ? 'income' : 'expense');
    } else if (field === 'action') {
      r.action = t.value;
      tr.classList.toggle('row-skipped', r.action === 'skip');
      updateSummary();
    } else if (field === 'date' || field === 'description') {
      r[field] = t.value;
      r.uncertain = false;
      tr.classList.remove('row-uncertain');
      if (field === 'description' && !r.categoryTouched) {
        r.categoryId = suggestFor(r);
        if (r.source === 'checking' && r.type === 'expense') r.isCardPayment = looksLikeCardPayment(r.description);
      }
      detectDuplicates();
      rerenderFn();
    } else {
      r[field] = t.value;
    }
  });

  root.addEventListener('click', async (e) => {
    const t = e.target;
    const kindBtn = t.closest('[data-file-kind]');
    if (kindBtn) { fileOf(kindBtn).kind = kindBtn.dataset.fileKind; rerenderFn(); return; }
    if (t.closest('[data-remove-file]')) {
      const f = fileOf(t);
      if (f.thumb) URL.revokeObjectURL(f.thumb);
      session.files = session.files.filter((x) => x !== f);
      session.rows = session.rows.filter((r) => r.fileId !== f.id);
      detectDuplicates();
      rerenderFn();
    }
    if (t.closest('[data-toggle-paste]')) { session.pasteOpen = !session.pasteOpen; rerenderFn(); $('[data-paste-text]', root)?.focus(); }
    if (t.closest('[data-paste-go]')) {
      const text = $('[data-paste-text]', root)?.value || '';
      if (text.trim()) { session.pasteOpen = false; addInboxText(text); }
    }
    if (t.closest('[data-process]')) processAll();
    if (t.closest('[data-del-row]')) {
      const rid = t.closest('[data-rid]').dataset.rid;
      session.rows = session.rows.filter((r) => r.rid !== rid);
      detectDuplicates();
      rerenderFn();
    }
    if (t.closest('[data-add-row]')) {
      const last = session.rows[session.rows.length - 1];
      const row = {
        rid: nid(), fileId: last?.fileId, source: last?.source || 'manual',
        date: last?.date || '', description: '', amount: '', type: 'expense', note: '', action: 'save',
        isCardPayment: false, uncertain: false, categoryId: fallbackCategory('expense'),
      };
      session.rows.push(row);
      rerenderFn();
      $(`[data-rid="${row.rid}"] [data-rf="description"]`)?.focus();
    }
    if (t.closest('[data-clear-review]')) {
      const ok = await confirmDialog('לבטל את הייבוא? השורות שבטבלה לא יישמרו.', { okText: 'ביטול הייבוא', cancelText: 'חזרה', danger: true, title: 'ביטול ייבוא' });
      if (ok) { session.rows = []; session.files = session.files.filter((f) => f.status === 'pending'); rerenderFn(); }
    }
    if (t.closest('[data-save-review]')) {
      const months = await saveReview();
      if (months?.length) {
        view.month = months[months.length - 1];
        location.hash = '#home';
      }
    }
  });
}

function fileOf(el) {
  const id = el.closest('[data-file]').dataset.file;
  return session.files.find((f) => f.id === id);
}

function updateSummary() {
  const el = $('[data-review-summary]');
  if (!el) return;
  const { active, expenses, income } = totals();
  el.innerHTML = summaryText(active.length, session.rows.length, expenses, income);
}
