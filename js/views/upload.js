// Upload screen: bank Excel exports or screenshots (OCR) -> review table -> save.
import { state, categoriesOf, fallbackCategory, saveTransactions } from '../store.js';
import { suggestCategory, looksLikeCardPayment, duplicateKey, findDuplicates } from '../categorize.js';
import { escapeHtml, money, parseAmount, formatDate, normalizeText, round2 } from '../format.js';
import { categoryOptions, toast, sourceBadge, confirmDialog, view, $ } from '../ui.js';
import { parseBankFile, isSpreadsheet } from '../import/bank-file.js';
import { ocrImage, analyseLines, defaultMapping, buildRows, AMOUNT_ROLES } from '../import/ocr.js';

const KIND_LABEL = { checking: 'עו"ש', credit: 'כרטיס אשראי' };

/** Everything here lives only in memory; images are never stored. */
const session = {
  files: [], // {id, file, name, isSheet, kind, status, progress, error, thumb, analysis, mapping, total}
  rows: [], // review rows
  dateMode: 'deal',
  busy: false,
};
let seq = 0;
const nid = () => `n${++seq}`;
let rerenderFn = () => {};

// ---------- rendering ----------

export function renderUpload() {
  return `
  <div class="page-head"><h1>ייבוא תנועות</h1></div>
  ${session.rows.length ? reviewHtml() : ''}
  <section class="card">
    <div class="dropzone" data-dropzone tabindex="0" role="button" aria-label="בחירת קבצים">
      <div class="dz-icon" aria-hidden="true">⬆</div>
      <p><b>גררו לכאן קובץ אקסל מאתר הבנק או צילומי מסך</b></p>
      <p class="muted">או הדביקו צילום מסך עם <kbd>Ctrl+V</kbd> · או לחצו לבחירת קבצים · אפשר כמה קבצים בבת אחת</p>
      <input type="file" multiple accept=".xlsx,.xls,.csv,image/*" data-file-input class="visually-hidden">
    </div>
    <p class="hint">💡 הכי מדויק: באתר דיסקונט, במסך התנועות או פירוט הכרטיס, לחצו על <b>ייצוא לאקסל</b> והעלו את הקובץ.
      צילומי מסך מפוענחים ב-OCR מקומי ודורשים בדיקה. הקבצים והתמונות לא נשמרים — רק התנועות שאישרתם.</p>
    ${session.files.length ? queueHtml() : ''}
  </section>`;
}

function queueHtml() {
  const pending = session.files.filter((f) => f.status === 'pending');
  const missingKind = pending.some((f) => !f.isSheet && !f.kind);
  const hasCreditSheet = pending.some((f) => f.isSheet && f.kind !== 'checking');
  return `
  <h2 class="queue-title">קבצים</h2>
  <ul class="queue">
    ${session.files.map((f) => `
    <li class="queue-item status-${f.status}" data-file="${f.id}">
      ${f.thumb ? `<img src="${f.thumb}" alt="" class="thumb">` : `<span class="thumb thumb-file" aria-hidden="true">${f.isSheet ? 'XLS' : '?'}</span>`}
      <div class="queue-main">
        <div class="queue-name">${escapeHtml(f.name)}</div>
        <div class="queue-status">${statusText(f)}</div>
        ${f.status === 'processing' ? `<div class="bar"><div class="bar-fill lvl-ok" style="width:${Math.round((f.progress || 0) * 100)}%"></div></div>` : ''}
      </div>
      <select data-file-kind aria-label="סוג" ${f.status !== 'pending' ? 'disabled' : ''}>
        ${f.isSheet ? `<option value="" ${!f.kind ? 'selected' : ''}>זיהוי אוטומטי</option>` : `<option value="" ${!f.kind ? 'selected' : ''} disabled>בחרו סוג…</option>`}
        <option value="checking" ${f.kind === 'checking' ? 'selected' : ''}>עו"ש</option>
        <option value="credit" ${f.kind === 'credit' ? 'selected' : ''}>כרטיס אשראי</option>
      </select>
      <button type="button" class="icon-btn danger" data-remove-file aria-label="הסרה" ${f.status === 'processing' ? 'disabled' : ''}>✕</button>
    </li>`).join('')}
  </ul>
  ${pending.length ? `
  <div class="form-actions">
    ${hasCreditSheet ? `<label class="inline-field">שיוך עסקאות אשראי לחודש לפי:
      <select data-date-mode>
        <option value="deal" ${session.dateMode === 'deal' ? 'selected' : ''}>תאריך העסקה (מומלץ)</option>
        <option value="charge" ${session.dateMode === 'charge' ? 'selected' : ''}>תאריך החיוב</option>
      </select></label>` : ''}
    <button type="button" class="btn btn-primary" data-process ${missingKind || session.busy ? 'disabled' : ''}>פענוח ${pending.length} קבצים</button>
    ${missingKind ? '<span class="hint">בחרו לכל צילום מסך אם הוא של עו"ש או של כרטיס אשראי</span>' : ''}
  </div>` : ''}`;
}

function statusText(f) {
  if (f.status === 'pending') return f.isSheet ? 'קובץ אקסל — מוכן לפענוח' : 'צילום מסך — מוכן לפענוח';
  if (f.status === 'processing') return escapeHtml(f.progressText || 'מפענח…');
  if (f.status === 'error') return `<span class="text-bad">שגיאה: ${escapeHtml(f.error)}</span>`;
  const count = session.rows.filter((r) => r.fileId === f.id).length;
  return `פוענח: ${count} שורות · ${KIND_LABEL[f.kind] || ''}`;
}

function reviewHtml() {
  const rows = session.rows;
  const active = rows.filter((r) => r.action !== 'skip');
  const expenses = active.filter((r) => r.type !== 'income' && !r.isCardPayment).reduce((s, r) => s + (r.type === 'refund' ? -1 : 1) * (Number(r.amount) || 0), 0);
  const income = active.filter((r) => r.type === 'income').reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const dups = rows.filter((r) => r.dup).length;
  const uncertain = rows.filter((r) => r.uncertain).length;

  return `
  <section class="card review" id="review">
    <div class="section-head">
      <h2>בדיקה ותיקון לפני שמירה <span class="muted">(${rows.length} שורות)</span></h2>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-add-row>＋ הוספת שורה</button>
        <button type="button" class="btn btn-ghost btn-sm danger" data-clear-review>ביטול הייבוא</button>
      </div>
    </div>
    ${checksHtml()}
    ${session.files.filter((f) => f.analysis).map(mapperHtml).join('')}
    <div class="review-legend">
      ${uncertain ? `<span class="legend-chip chip-uncertain">${uncertain} שורות שה-OCR לא בטוח בהן — מסומנות בצהוב</span>` : ''}
      ${dups ? `<span class="legend-chip chip-dup">${dups} כפילויות אפשריות — מסומנות באדום, בחרו מה לעשות</span>` : ''}
    </div>
    <div class="table-wrap">
    <table class="review-table">
      <thead><tr>
        <th>תאריך</th><th>תיאור</th><th>סכום (₪)</th><th>סוג</th><th>קטגוריה</th><th title="חיוב כרטיס אשראי מרוכז — לא נספר">חיוב אשראי</th><th>הערה</th><th>כפילות</th><th></th>
      </tr></thead>
      <tbody>
        ${rows.map(rowHtml).join('')}
      </tbody>
    </table>
    </div>
    <div class="review-footer">
      <div data-review-summary>${summaryText(active.length, rows.length, expenses, income)}</div>
      <button type="button" class="btn btn-primary btn-lg" data-save-review>אישור ושמירה</button>
    </div>
  </section>`;
}

function summaryText(saving, all, expenses, income) {
  return `יישמרו <b>${saving}</b> מתוך ${all} שורות · הוצאות ${money(expenses)} · הכנסות ${money(income)}`;
}

function checksHtml() {
  return session.files.filter((f) => f.total != null).map((f) => {
    const rows = session.rows.filter((r) => r.fileId === f.id && !r.manualRow);
    const sum = round2(rows.reduce((s, r) => s + (r.type === 'refund' ? -1 : 1) * (Number(r.amount) || 0), 0));
    const ok = Math.abs(sum - f.total) < 0.05;
    return `<div class="alert ${ok ? 'lvl-ok-soft' : 'lvl-warn'}"><span class="alert-icon" aria-hidden="true">${ok ? '✓' : '⚠️'}</span>
      <span>${escapeHtml(f.name)}: סכום השורות ${money(sum)} ${ok ? 'תואם' : '<b>לא תואם</b>'} לסה"כ החיוב בקובץ (${money(f.total)})</span></div>`;
  }).join('');
}

function mapperHtml(f) {
  const a = f.analysis;
  const dateOpts = a.dateCols.map((c, i) => `<option value="${i}" ${f.mapping.date === i ? 'selected' : ''}>עמודה ${i + 1} מימין — למשל ${escapeHtml(c.samples.join(', '))}</option>`).join('');
  return `
  <details class="mapper" ${f.mapperOpen ? 'open' : ''} data-mapper="${f.id}">
    <summary>מבנה העמודות שזוהה ב-${escapeHtml(f.name)} — לחצו לתיקון אם התאריכים או הסכומים לא נכונים</summary>
    <div class="mapper-body">
      <label class="field inline-field"><span>עמודת התאריך</span>
        <select data-map-date>${dateOpts || '<option>לא נמצאו תאריכים</option>'}</select></label>
      ${a.amountCols.map((c, i) => `
        <label class="field inline-field"><span>עמודת סכום ${i + 1} מימין <span class="muted">(${escapeHtml(c.samples.join(', '))})</span></span>
          <select data-map-amount="${i}">
            ${Object.entries(AMOUNT_ROLES).map(([k, label]) => `<option value="${k}" ${f.mapping.amounts[i] === k ? 'selected' : ''}>${label}</option>`).join('')}
          </select></label>`).join('')}
      <p class="hint">שינוי כאן בונה מחדש את השורות של הקובץ הזה (תיקונים ידניים בשורות שלו יתאפסו).</p>
      <details><summary>הטקסט הגולמי שזוהה</summary><pre class="raw-text">${escapeHtml(f.rawText || '')}</pre></details>
    </div>
  </details>`;
}

function rowHtml(r) {
  const kindCats = categoriesOf(r.type === 'income' ? 'income' : 'expense');
  const cls = [r.dup ? 'row-dup' : '', r.uncertain ? 'row-uncertain' : '', r.action === 'skip' ? 'row-skipped' : ''].join(' ');
  return `
  <tr data-rid="${r.rid}" class="${cls}">
    <td><input type="date" value="${escapeHtml(r.date)}" data-rf="date" aria-label="תאריך"></td>
    <td><input value="${escapeHtml(r.description)}" data-rf="description" class="desc-input" aria-label="תיאור"></td>
    <td><input value="${r.amount === '' ? '' : Number(r.amount).toFixed(2)}" data-rf="amount" class="num-input amount-input" inputmode="decimal" aria-label="סכום"></td>
    <td><select data-rf="type" aria-label="סוג">
      <option value="expense" ${r.type === 'expense' ? 'selected' : ''}>הוצאה</option>
      <option value="refund" ${r.type === 'refund' ? 'selected' : ''}>זיכוי</option>
      <option value="income" ${r.type === 'income' ? 'selected' : ''}>הכנסה</option>
    </select></td>
    <td><select data-rf="categoryId" aria-label="קטגוריה">${categoryOptions(kindCats, r.categoryId)}</select></td>
    <td class="center">${r.type === 'expense' ? `<input type="checkbox" data-rf="isCardPayment" ${r.isCardPayment ? 'checked' : ''} aria-label="חיוב כרטיס אשראי">` : ''}</td>
    <td><input value="${escapeHtml(r.note)}" data-rf="note" class="note-input" aria-label="הערה"></td>
    <td>${r.dup ? dupCell(r) : ''}</td>
    <td><button type="button" class="icon-btn danger" data-del-row aria-label="מחיקת שורה">🗑</button></td>
  </tr>`;
}

function dupCell(r) {
  const d = r.dup;
  const what = d.kind === 'batch' ? 'שורה זהה בקובץ אחר בייבוא הזה'
    : d.kind === 'manual' ? `ייתכן שזו התנועה שהוזנה ידנית: ${escapeHtml(d.tx.description)} ${money(d.tx.amount)} (${formatDate(d.tx.date)})`
    : `כבר קיימת: ${escapeHtml(d.tx.description)} ${sourceBadge(d.tx.source)}`;
  return `<div class="dup-cell"><span class="dup-text">${what}</span>
    <select data-rf="action" aria-label="מה לעשות בכפילות">
      <option value="skip" ${r.action === 'skip' ? 'selected' : ''}>לדלג</option>
      ${d.tx ? `<option value="merge" ${r.action === 'merge' ? 'selected' : ''}>למזג עם הקיימת</option>` : ''}
      <option value="save" ${r.action === 'save' ? 'selected' : ''}>לשמור בכל זאת</option>
    </select></div>`;
}

// ---------- adding & processing files ----------

function addFiles(fileList) {
  const files = [...fileList].filter((f) => isSpreadsheet(f) || f.type.startsWith('image/'));
  if (!files.length) { toast('אפשר להעלות קובצי אקסל/CSV או תמונות', 'error'); return; }
  for (const file of files) {
    const isSheet = isSpreadsheet(file);
    session.files.push({
      id: nid(),
      file,
      name: file.name || 'צילום מסך מודבק',
      isSheet,
      kind: null,
      status: 'pending',
      thumb: isSheet ? null : URL.createObjectURL(file),
    });
  }
  if (!location.hash.startsWith('#upload')) location.hash = '#upload';
  rerenderFn();
}

async function processAll() {
  if (session.busy) return;
  session.busy = true;
  const pending = session.files.filter((f) => f.status === 'pending');
  for (const f of pending) {
    f.status = 'processing';
    f.progress = 0;
    rerenderFn();
    try {
      if (f.isSheet) {
        const res = await parseBankFile(f.file, { dateMode: session.dateMode });
        f.kind = f.kind || res.kind;
        f.total = f.kind === 'credit' ? res.total : null;
        addRows(f, res.items);
      } else {
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
        if (!f.analysis.lines.length) f.error = 'לא זוהו שורות עם תאריך או סכום';
      }
      f.status = 'done';
    } catch (err) {
      console.error(err);
      f.status = 'error';
      f.error = err.message || String(err);
    }
    if (f.thumb) { URL.revokeObjectURL(f.thumb); f.thumb = null; }
    f.file = null; // drop the image/file from memory
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
 * Mark rows that duplicate an existing transaction (same date+description+amount),
 * a manual entry with the same amount within 3 days, or a row from another file in this batch.
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
      const manual = state.transactions.find((t) => !claimed.has(t.id) && t.source === 'manual'
        && t.type === (r.type === 'income' ? 'income' : 'expense')
        && Math.abs(t.amount - Number(r.amount)) < 0.005
        && Math.abs(new Date(t.date) - new Date(r.date)) <= 3 * 864e5);
      if (manual) { r.dup = { kind: 'manual', tx: manual }; claimed.add(manual.id); }
    }
    const key = duplicateKey(asTx(r));
    const other = seen.get(key);
    if (!r.dup && other && other !== r.fileId) r.dup = { kind: 'batch' };
    if (!seen.has(key)) seen.set(key, r.fileId);

    // pick a default action only when the duplicate status changed
    if (r.dup && (!prevDup || prevDup.kind !== r.dup.kind || prevDup.tx !== r.dup.tx)) {
      r.action = r.dup.kind === 'manual' ? 'merge' : 'skip';
    }
    if (!r.dup && prevDup) r.action = 'save';
  }
}

// ---------- saving ----------

async function saveReview() {
  const problems = session.rows.filter((r) => r.action !== 'skip'
    && (!r.date || !(Number(r.amount) > 0) || !r.description.trim()));
  if (problems.length) {
    toast(`יש ${problems.length} שורות בלי תאריך, תיאור או סכום תקין — תקנו או מחקו אותן`, 'error');
    const el = $(`[data-rid="${problems[0].rid}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.querySelector('input')?.focus();
    return;
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
      // keep the manual entry's id, category and note; take the bank's details
      const ex = r.dup.tx;
      toSave.push({ ...ex, ...tx, id: ex.id, categoryId: ex.categoryId, note: ex.note || tx.note, createdAt: ex.createdAt });
      merged++;
    } else {
      toSave.push(tx);
    }
  }
  if (!toSave.length) { toast('אין שורות לשמירה', 'error'); return; }
  await saveTransactions(toSave);
  const added = toSave.length - merged;
  const months = [...new Set(toSave.map((t) => t.date.slice(0, 7)))].sort();
  session.rows = [];
  session.files = session.files.filter((f) => f.status === 'pending');
  rerenderFn();
  toast(`נשמרו ${added} תנועות${merged ? `, ${merged} מוזגו` : ''}${skipped ? `, ${skipped} דולגו` : ''}`);
  return months;
}

// ---------- events ----------

export function bindUpload(root, rerender) {
  rerenderFn = () => { if (location.hash.startsWith('#upload')) rerender(); };

  // paste anywhere in the app (except inside a text field)
  document.addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea') && !e.target.closest('[data-dropzone]')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  root.addEventListener('click', (e) => {
    const dz = e.target.closest('[data-dropzone]');
    if (dz && !e.target.matches('[data-file-input]')) $('[data-file-input]', root)?.click();
  });
  root.addEventListener('keydown', (e) => {
    if (e.target.matches('[data-dropzone]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('[data-file-input]', root)?.click(); }
    // Enter in a review cell moves to the same cell in the next row
    if (e.key === 'Enter' && e.target.closest('.review-table') && e.target.tagName === 'INPUT') {
      e.preventDefault();
      const tr = e.target.closest('tr').nextElementSibling;
      tr?.querySelector(`[data-rf="${e.target.dataset.rf}"]`)?.focus();
    }
  });
  root.addEventListener('dragover', (e) => {
    const dz = e.target.closest('[data-dropzone]');
    if (dz) { e.preventDefault(); dz.classList.add('dragging'); }
  });
  root.addEventListener('dragleave', (e) => e.target.closest('[data-dropzone]')?.classList.remove('dragging'));
  root.addEventListener('drop', (e) => {
    const dz = e.target.closest('[data-dropzone]');
    if (!dz) return;
    e.preventDefault();
    dz.classList.remove('dragging');
    addFiles(e.dataTransfer.files);
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-file-input]')) { addFiles(t.files); t.value = ''; return; }
    if (t.matches('[data-file-kind]')) {
      const f = fileOf(t);
      f.kind = t.value || null;
      rerenderFn();
      return;
    }
    if (t.matches('[data-date-mode]')) { session.dateMode = t.value; return; }

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
        if (v < 0 && r.type === 'expense' && r.source === 'credit') r.type = 'refund';
        t.value = r.amount.toFixed(2);
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
      // same merchant elsewhere in this import gets the same category
      let n = 0;
      for (const o of session.rows) {
        if (o !== r && !o.categoryTouched && o.type === r.type && normalizeText(o.description) === normalizeText(r.description)) { o.categoryId = r.categoryId; n++; }
      }
      if (n) { rerenderFn(); toast(`עודכנו גם ${n} שורות נוספות של "${r.description}"`); }
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
    if (t.closest('[data-remove-file]')) {
      const f = fileOf(t);
      if (f.thumb) URL.revokeObjectURL(f.thumb);
      session.files = session.files.filter((x) => x !== f);
      session.rows = session.rows.filter((r) => r.fileId !== f.id);
      detectDuplicates();
      rerenderFn();
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
        rid: nid(), fileId: last?.fileId, source: last?.source || 'credit', manualRow: true,
        date: last?.date || '', description: '', amount: '', type: 'expense', note: '', action: 'save',
        isCardPayment: false, uncertain: false,
      };
      row.categoryId = fallbackCategory('expense');
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
        location.hash = '#dashboard';
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
  const active = session.rows.filter((r) => r.action !== 'skip');
  const expenses = active.filter((r) => r.type !== 'income' && !r.isCardPayment).reduce((s, r) => s + (r.type === 'refund' ? -1 : 1) * (Number(r.amount) || 0), 0);
  const income = active.filter((r) => r.type === 'income').reduce((s, r) => s + (Number(r.amount) || 0), 0);
  el.innerHTML = summaryText(active.length, session.rows.length, expenses, income);
}

