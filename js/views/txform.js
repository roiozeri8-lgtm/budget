// "הוספת תנועה" sheet — fast manual entry; also edits and deletes any transaction.
import {
  state, categoriesOf, saveTransaction, saveTransactions, deleteTransactions, saveRecurring,
  deleteRecurring, generateRecurring, fallbackCategory, uid,
} from '../store.js';
import { suggestCategory, looksLikeCardPayment, knownDescriptions, findDuplicates } from '../categorize.js';
import { installmentOf } from '../analytics.js';
import { parseAmount, todayISO, addDays, addMonthsToDate, escapeHtml, formatDate, money, round2, formatMoneyText } from '../format.js';
import { openModal, confirmDialog, choiceDialog, toast, sourceBadge } from '../ui.js';
import { icon } from '../icons.js';
import { offerRule } from './ruleoffer.js';

const shortName = (name) => name.replace(/\s*\(.*\)\s*/, '');

/**
 * Open the transaction sheet.
 * @param {object|null} existing transaction to edit, or null for a new one
 * @param {object} preset optional initial values for a new transaction
 */
export function openTxForm(existing = null, preset = {}) {
  const isEdit = !!existing;
  const tx = existing || { type: 'expense', date: todayISO(), source: 'manual', ...preset };
  const rec = tx.recurringId ? state.recurring.find((r) => r.id === tx.recurringId) : null;
  const inst = isEdit ? installmentOf(tx) : null;
  let addedCount = 0;
  let categoryTouched = isEdit;
  let cardTouched = isEdit;
  let suggestion = null;
  const today = todayISO();
  const yesterday = addDays(today, -1);

  const { el, close } = openModal({
    title: isEdit ? 'עריכת תנועה' : 'הוספת תנועה',
    className: 'tx-sheet',
    body: `
    <form class="txf" novalidate autocomplete="off">
      <div class="segmented" role="radiogroup" aria-label="סוג">
        <label><input type="radio" name="type" value="expense" ${tx.type !== 'income' ? 'checked' : ''}><span>הוצאה</span></label>
        <label><input type="radio" name="type" value="income" ${tx.type === 'income' ? 'checked' : ''}><span>הכנסה</span></label>
      </div>

      <label class="amount-field">
        <span class="visually-hidden" data-amount-label>סכום</span>
        <input name="amount" inputmode="decimal" placeholder="0" value="${isEdit ? tx.amount : ''}" aria-label="סכום">
        <span class="amount-cur">₪</span>
      </label>
      <p class="amount-hint" data-installment-preview></p>

      <label class="field">
        <span class="field-label">על מה?</span>
        <input class="input" name="description" list="desc-list" placeholder="שם העסק או תיאור — למשל: שופרסל" value="${escapeHtml(tx.description || '')}">
        <datalist id="desc-list">${knownDescriptions().slice(0, 300).map((d) => `<option value="${escapeHtml(d)}">`).join('')}</datalist>
      </label>

      <div class="field">
        <span class="field-label">קטגוריה <span class="suggest-hint" data-suggest-hint></span></span>
        <div class="cat-grid" role="radiogroup" aria-label="קטגוריה" data-cat-grid></div>
      </div>

      <div class="field">
        <span class="field-label">תאריך</span>
        <div class="date-row">
          <button type="button" class="chip" data-date="${today}">היום</button>
          <button type="button" class="chip" data-date="${yesterday}">אתמול</button>
          <input class="input date-input" name="date" type="date" value="${escapeHtml(tx.date)}" aria-label="תאריך">
        </div>
      </div>

      <details class="more" ${isEdit && (tx.note || tx.isCardPayment || tx.refund) ? 'open' : ''}>
        <summary>${icon('settings', 16)} אפשרויות נוספות</summary>
        <label class="field"><span class="field-label">הערה</span>
          <input class="input" name="note" value="${escapeHtml(tx.note || '')}" placeholder="לא חובה"></label>
        <div class="checks">
          <label class="check"><input type="checkbox" name="recurring" ${rec ? 'checked' : ''}>
            <span><b>תנועה קבועה</b> — תתווסף לבד בכל חודש (משכורת, שכירות, חוג)</span></label>
          ${isEdit ? '' : `
          <div data-expense-only>
            <label class="check"><input type="checkbox" name="installments">
              <span><b>עסקה בתשלומים</b> — הסכום יתחלק על פני כמה חודשים</span></label>
            <div class="inst-row" data-inst-row hidden>
              <label>מספר תשלומים
                <select class="input" name="instCount">${Array.from({ length: 35 }, (_, i) => i + 2).map((n) => `<option ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            </div>
          </div>`}
          <label class="check" data-expense-only><input type="checkbox" name="isCardPayment" ${tx.isCardPayment ? 'checked' : ''}>
            <span><b>חיוב כרטיס אשראי מרוכז</b> — לא נספר בהוצאות (הפירוט מגיע בנפרד)</span></label>
          <label class="check" data-expense-only><input type="checkbox" name="refund" ${tx.refund ? 'checked' : ''}>
            <span><b>זיכוי / החזר</b> — מקטין את ההוצאות בקטגוריה</span></label>
        </div>
      </details>
      ${rec ? `<p class="hint">${icon('repeat', 14)} תנועה קבועה: שינוי בסכום, בתיאור או בקטגוריה יחול גם על החודשים הבאים.</p>` : ''}
      ${inst ? `<p class="hint">${icon('layers', 14)} תשלום ${inst.n} מתוך ${inst.of}.</p>` : ''}
      ${isEdit && tx.source !== 'manual' ? `<p class="hint">מקור: ${sourceBadge(tx.source)}</p>` : ''}

      <p class="form-error" data-error role="alert"></p>

      <div class="sheet-actions">
        <button type="submit" class="btn btn-primary btn-lg">שמירה</button>
        ${isEdit ? `<button type="button" class="btn btn-ghost danger" data-delete>${icon('trash', 18)} מחיקה</button>`
          : '<button type="button" class="btn btn-secondary btn-lg" data-save-more>שמירה והוספת עוד</button>'}
        <span class="added-count" data-added aria-live="polite"></span>
      </div>
      <p class="kbd-hint">Enter שומר · Ctrl+Enter שומר וממשיך לתנועה הבאה</p>
    </form>`,
  });

  const form = el.querySelector('form');
  const f = form.elements;
  const hint = el.querySelector('[data-suggest-hint]');
  const grid = el.querySelector('[data-cat-grid]');
  const errorEl = el.querySelector('[data-error]');
  const currentType = () => form.querySelector('input[name=type]:checked').value;
  let selectedCat = tx.categoryId ?? null;

  function renderGrid() {
    const cats = categoriesOf(currentType());
    if (!cats.some((c) => c.id === selectedCat)) selectedCat = fallbackCategory(currentType());
    grid.innerHTML = cats.map((c) => `
      <button type="button" class="cat-tile ${c.id === selectedCat ? 'selected' : ''} ${suggestion?.categoryId === c.id ? 'suggested' : ''}"
        role="radio" aria-checked="${c.id === selectedCat}" data-cat="${escapeHtml(c.id)}" title="${escapeHtml(c.name)}" style="--c:${c.color}">
        <span class="cat-emoji">${escapeHtml(c.icon || '🏷️')}</span><span class="cat-name">${escapeHtml(shortName(c.name))}</span>
      </button>`).join('');
  }

  function applySuggestion() {
    const type = currentType();
    suggestion = suggestCategory(f.description.value, type);
    if (!categoryTouched) selectedCat = suggestion?.categoryId ?? fallbackCategory(type);
    if (suggestion) {
      hint.innerHTML = `${icon('sparkles', 14)} ${suggestion.reason === 'history' ? 'לפי תנועות קודמות' : `לפי "${escapeHtml(suggestion.keyword)}"`}`;
    } else hint.textContent = '';
    if (!cardTouched && f.isCardPayment) f.isCardPayment.checked = type === 'expense' && looksLikeCardPayment(f.description.value);
    el.querySelectorAll('[data-expense-only]').forEach((row) => { row.hidden = type !== 'expense'; });
    renderGrid();
  }

  function updateDateChips() {
    el.querySelectorAll('[data-date]').forEach((b) => b.classList.toggle('active', b.dataset.date === f.date.value));
  }

  function updateInstallments() {
    const on = f.installments?.checked && currentType() === 'expense';
    const row = el.querySelector('[data-inst-row]');
    if (row) row.hidden = !on;
    el.querySelector('[data-amount-label]').textContent = on ? 'סכום העסקה הכולל' : 'סכום';
    const prev = el.querySelector('[data-installment-preview]');
    const total = parseAmount(f.amount.value);
    if (on && isFinite(total) && total > 0) {
      const n = Number(f.instCount.value);
      const last = addMonthsToDate(f.date.value || today, n - 1);
      prev.textContent = `${n} תשלומים של ${formatMoneyText(Math.abs(total) / n)} · עד ${formatDate(last)}`;
    } else prev.textContent = on ? 'הזינו את הסכום הכולל של העסקה' : '';
    if (on && f.recurring.checked) f.recurring.checked = false;
  }

  applySuggestion();
  updateDateChips();

  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    selectedCat = b.dataset.cat;
    categoryTouched = true;
    renderGrid();
  });
  el.querySelectorAll('[data-date]').forEach((b) => b.addEventListener('click', () => { f.date.value = b.dataset.date; updateDateChips(); updateInstallments(); }));
  form.addEventListener('change', (e) => {
    const n = e.target.name;
    if (n === 'type') { categoryTouched = false; applySuggestion(); updateInstallments(); }
    if (n === 'isCardPayment') cardTouched = true;
    if (n === 'date') updateDateChips();
    if (n === 'recurring' && f.recurring.checked && f.installments) f.installments.checked = false;
    if (['installments', 'instCount', 'date', 'recurring'].includes(n)) updateInstallments();
  });
  f.amount.addEventListener('input', updateInstallments);
  f.description.addEventListener('input', applySuggestion);

  async function submit(keepOpen) {
    errorEl.textContent = '';
    const amount = parseAmount(f.amount.value);
    const description = f.description.value.trim();
    if (!isFinite(amount) || amount === 0) return showError('נא להזין סכום', f.amount);
    if (!description) return showError('נא לכתוב על מה ההוצאה או ההכנסה', f.description);
    if (!f.date.value) return showError('נא לבחור תאריך', f.date);

    const type = currentType();
    const data = {
      ...tx,
      type,
      amount: Math.abs(amount),
      date: f.date.value,
      description,
      categoryId: selectedCat,
      note: f.note.value,
      isCardPayment: type === 'expense' && f.isCardPayment.checked,
      refund: type === 'expense' && f.refund.checked,
    };

    if (!isEdit) {
      const dups = findDuplicates(data);
      if (dups.length) {
        const ok = await confirmDialog(
          `כבר קיימת תנועה זהה: ${escapeHtml(dups[0].description)}, ${money(dups[0].amount)} בתאריך ${formatDate(dups[0].date)} (${sourceBadge(dups[0].source)}).<br>לשמור בכל זאת?`,
          { okText: 'שמירה בכל זאת', title: 'תנועה כפולה?' }
        );
        if (!ok) return;
      }
    }

    // installments: one transaction per month
    if (!isEdit && type === 'expense' && f.installments?.checked) {
      const n = Number(f.instCount.value);
      const plan = uid();
      const per = round2(data.amount / n);
      const first = round2(data.amount - per * (n - 1)); // rounding difference goes to the first payment
      const list = Array.from({ length: n }, (_, i) => ({
        ...data,
        id: undefined,
        amount: i === 0 ? first : per,
        date: addMonthsToDate(data.date, i),
        description: `${description} (תשלום ${i + 1}/${n})`,
        installment: { plan, n: i + 1, of: n },
      }));
      await saveTransactions(list);
      finish(keepOpen, `נשמרו ${n} תשלומים`);
      return;
    }

    const wantsRecurring = f.recurring.checked;
    if (rec && !wantsRecurring) {
      await deleteRecurring(rec.id);
      data.recurringId = null;
    }
    const saved = await saveTransaction(data);
    if (wantsRecurring) {
      const template = {
        ...(rec || {}),
        type: saved.type,
        amount: saved.amount,
        description: saved.description,
        categoryId: saved.categoryId,
        note: saved.note,
        isCardPayment: saved.isCardPayment,
        day: Number(saved.date.slice(8, 10)),
        mode: 'auto',
      };
      if (!rec) {
        template.startMonth = saved.date.slice(0, 7);
        template.lastGenerated = saved.date.slice(0, 7);
      }
      const savedRec = await saveRecurring(template);
      if (saved.recurringId !== savedRec.id) await saveTransaction({ ...saved, recurringId: savedRec.id });
      const created = await generateRecurring();
      if (created) toast(`נוצרו ${created} תנועות קבועות לחודשים שעברו מאז`);
    }

    // a manual correction of the category: offer a rule
    const corrected = categoryTouched && selectedCat !== fallbackCategory(type)
      && (isEdit ? existing.categoryId !== selectedCat : suggestion && suggestion.categoryId !== selectedCat);
    finish(keepOpen, isEdit ? 'התנועה עודכנה' : 'התנועה נשמרה');
    if (corrected) setTimeout(() => offerRule(description, selectedCat, type), 400);
  }

  function finish(keepOpen, message) {
    if (keepOpen) {
      addedCount++;
      el.querySelector('[data-added]').textContent = `✓ נוספו ${addedCount}`;
      f.amount.value = '';
      f.description.value = '';
      f.note.value = '';
      f.recurring.checked = false;
      if (f.installments) f.installments.checked = false;
      f.isCardPayment.checked = false;
      f.refund.checked = false;
      categoryTouched = false;
      cardTouched = false;
      applySuggestion();
      updateInstallments();
      f.amount.focus();
      toast(message);
    } else {
      close();
      toast(message);
    }
  }

  function showError(msg, field) {
    errorEl.textContent = msg;
    field.focus();
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(false); });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isEdit) { e.preventDefault(); submit(true); }
  });
  el.querySelector('[data-save-more]')?.addEventListener('click', () => submit(true));
  el.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const ids = await askDelete(tx);
    if (!ids) return;
    await deleteTransactions(ids);
    close();
    toast(ids.length > 1 ? `נמחקו ${ids.length} תנועות` : 'התנועה נמחקה');
  });

  // phones: don't pop the keyboard over the sheet when editing
  if (!isEdit && !matchMedia('(pointer: coarse)').matches) f.amount.focus();
  else if (!isEdit) setTimeout(() => f.amount.focus(), 250);
}

/** Which transactions to delete (installment plans may delete the rest of the plan). */
export async function askDelete(tx) {
  const inst = installmentOf(tx);
  const siblings = inst?.plan ? state.transactions.filter((t) => t.installment?.plan === inst.plan) : [];
  if (siblings.length > 1) {
    const v = await choiceDialog(`"${escapeHtml(tx.description)}" היא תשלום ${inst.n} מתוך ${inst.of}. מה למחוק?`, [
      { value: 'one', label: 'רק את התשלום הזה', danger: true },
      { value: 'future', label: 'את התשלום הזה וכל הבאים' },
      { value: 'all', label: `את כל ${siblings.length} התשלומים` },
      { value: null, label: 'ביטול' },
    ], 'מחיקת תשלום');
    if (!v) return null;
    if (v === 'one') return [tx.id];
    if (v === 'future') return siblings.filter((t) => t.installment.n >= inst.n).map((t) => t.id);
    return siblings.map((t) => t.id);
  }
  const ok = await confirmDialog(`למחוק את "${escapeHtml(tx.description)}" (${money(tx.amount)})?`, { okText: 'מחיקה', danger: true, title: 'מחיקת תנועה' });
  return ok ? [tx.id] : null;
}
