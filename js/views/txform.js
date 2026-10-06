// "הוספת תנועה" form — quick manual entry, also used to edit any transaction.
import {
  state, categoriesOf, getCategory, saveTransaction, saveRecurring, deleteRecurring, generateRecurring, fallbackCategory,
} from '../store.js';
import { suggestCategory, looksLikeCardPayment, knownDescriptions, findDuplicates } from '../categorize.js';
import { parseAmount, todayISO, escapeHtml, formatDate, money } from '../format.js';
import { openModal, categoryOptions, confirmDialog, toast, sourceBadge } from '../ui.js';

/**
 * Open the transaction form.
 * @param {object|null} existing transaction to edit, or null for a new one
 */
export function openTxForm(existing = null) {
  const isEdit = !!existing;
  const tx = existing || { type: 'expense', date: todayISO(), source: 'manual' };
  const rec = tx.recurringId ? state.recurring.find((r) => r.id === tx.recurringId) : null;
  let addedCount = 0;
  let categoryTouched = isEdit;
  let cardTouched = isEdit;

  const { el, close } = openModal({
    title: isEdit ? 'עריכת תנועה' : 'הוספת תנועה',
    body: `
    <form class="tx-form" novalidate autocomplete="off">
      <div class="segmented" role="radiogroup" aria-label="סוג">
        <label><input type="radio" name="type" value="expense" ${tx.type !== 'income' ? 'checked' : ''}><span>הוצאה</span></label>
        <label><input type="radio" name="type" value="income" ${tx.type === 'income' ? 'checked' : ''}><span>הכנסה</span></label>
      </div>

      <div class="form-row two">
        <label class="field">
          <span>סכום</span>
          <div class="input-suffix">
            <input name="amount" inputmode="decimal" required placeholder="0.00" value="${isEdit ? tx.amount : ''}">
            <span>₪</span>
          </div>
        </label>
        <label class="field">
          <span>תאריך</span>
          <input name="date" type="date" required value="${escapeHtml(tx.date)}">
        </label>
      </div>

      <label class="field">
        <span>תיאור / שם בית העסק</span>
        <input name="description" list="desc-list" required placeholder="למשל: שופרסל דיל" value="${escapeHtml(tx.description || '')}">
        <datalist id="desc-list">${knownDescriptions().slice(0, 300).map((d) => `<option value="${escapeHtml(d)}">`).join('')}</datalist>
      </label>

      <label class="field">
        <span>קטגוריה <small class="hint" data-suggest-hint></small></span>
        <select name="categoryId"></select>
      </label>

      <label class="field">
        <span>הערה <small class="muted">(לא חובה)</small></span>
        <input name="note" value="${escapeHtml(tx.note || '')}">
      </label>

      <div class="checks">
        <label class="check"><input type="checkbox" name="recurring" ${rec ? 'checked' : ''}>
          <span>תנועה קבועה — תתווסף אוטומטית בכל חודש</span></label>
        <label class="check" data-expense-only><input type="checkbox" name="isCardPayment" ${tx.isCardPayment ? 'checked' : ''}>
          <span>חיוב כרטיס אשראי מרוכז — <b>לא</b> נספר בהוצאות (הפירוט מגיע מצילום הכרטיס)</span></label>
        <label class="check" data-expense-only><input type="checkbox" name="refund" ${tx.refund ? 'checked' : ''}>
          <span>זיכוי / החזר — מקטין את ההוצאות בקטגוריה</span></label>
      </div>
      ${rec ? '<p class="hint">שינוי בסכום, בתיאור או בקטגוריה יחול גם על החודשים הבאים.</p>' : ''}
      ${isEdit && tx.source !== 'manual' ? `<p class="hint">מקור: ${sourceBadge(tx.source)}</p>` : ''}

      <p class="form-error" data-error role="alert"></p>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">שמירה <kbd>Enter</kbd></button>
        ${isEdit ? '' : '<button type="button" class="btn btn-secondary" data-save-more>שמור והוסף עוד <kbd>Ctrl+Enter</kbd></button>'}
        <button type="button" class="btn btn-ghost" data-cancel>ביטול</button>
        <span class="added-count" data-added aria-live="polite"></span>
      </div>
    </form>`,
  });

  const form = el.querySelector('form');
  const f = form.elements;
  const hint = el.querySelector('[data-suggest-hint]');
  const errorEl = el.querySelector('[data-error]');
  const currentType = () => form.querySelector('input[name=type]:checked').value;

  function fillCategories(selected) {
    const cats = categoriesOf(currentType());
    f.categoryId.innerHTML = categoryOptions(cats, selected);
    if (!cats.some((c) => c.id === selected)) f.categoryId.value = fallbackCategory(currentType()) ?? '';
  }

  function applySuggestion() {
    const type = currentType();
    const s = suggestCategory(f.description.value, type);
    if (!categoryTouched) {
      fillCategories(s?.categoryId ?? fallbackCategory(type));
    }
    if (s && f.categoryId.value === s.categoryId) {
      hint.textContent = s.reason === 'history' ? '· הוצע לפי תנועות קודמות' : `· הוצע לפי הכלל "${s.keyword}"`;
    } else if (s) {
      hint.textContent = `· הצעה: ${getCategory(s.categoryId)?.name}`;
    } else {
      hint.textContent = '';
    }
    if (!cardTouched) f.isCardPayment.checked = type === 'expense' && looksLikeCardPayment(f.description.value);
    el.querySelectorAll('[data-expense-only]').forEach((row) => { row.hidden = type !== 'expense'; });
  }

  fillCategories(tx.categoryId ?? fallbackCategory(tx.type));
  applySuggestion();

  form.addEventListener('change', (e) => {
    if (e.target.name === 'type') { categoryTouched = false; applySuggestion(); }
    if (e.target.name === 'categoryId') categoryTouched = true;
    if (e.target.name === 'isCardPayment') cardTouched = true;
  });
  f.description.addEventListener('input', applySuggestion);
  // A hint like "הצעה: X" is clickable through the select; clicking the hint applies it.
  hint.addEventListener('click', () => {
    const s = suggestCategory(f.description.value, currentType());
    if (s) { fillCategories(s.categoryId); categoryTouched = false; applySuggestion(); }
  });

  async function submit(keepOpen) {
    errorEl.textContent = '';
    const amount = parseAmount(f.amount.value);
    const description = f.description.value.trim();
    if (!isFinite(amount) || amount === 0) return showError('נא להזין סכום תקין', f.amount);
    if (!f.date.value) return showError('נא לבחור תאריך', f.date);
    if (!description) return showError('נא להזין תיאור', f.description);

    const type = currentType();
    const data = {
      ...tx,
      type,
      amount: Math.abs(amount),
      date: f.date.value,
      description,
      categoryId: f.categoryId.value,
      note: f.note.value,
      isCardPayment: type === 'expense' && f.isCardPayment.checked,
      refund: type === 'expense' && f.refund.checked,
    };

    if (!isEdit) {
      const dups = findDuplicates(data);
      if (dups.length) {
        const ok = await confirmDialog(
          `כבר קיימת תנועה זהה: ${escapeHtml(dups[0].description)}, ${money(dups[0].amount)} בתאריך ${formatDate(dups[0].date)} (${sourceBadge(dups[0].source)}).<br>לשמור בכל זאת?`,
          { okText: 'שמור בכל זאת', title: 'תנועה כפולה?' }
        );
        if (!ok) return;
      }
    }

    // recurring handling
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
      };
      if (!rec) {
        template.startMonth = saved.date.slice(0, 7);
        template.lastGenerated = saved.date.slice(0, 7);
      }
      const savedRec = await saveRecurring(template);
      if (saved.recurringId !== savedRec.id) await saveTransaction({ ...saved, recurringId: savedRec.id });
      const created = await generateRecurring();
      if (created) toast(`נוצרו ${created} תנועות קבועות לחודשים הבאים עד היום`);
    }

    if (keepOpen) {
      addedCount++;
      el.querySelector('[data-added]').textContent = `✓ נוספו ${addedCount} תנועות`;
      f.amount.value = '';
      f.description.value = '';
      f.note.value = '';
      f.recurring.checked = false;
      f.isCardPayment.checked = false;
      f.refund.checked = false;
      categoryTouched = false;
      cardTouched = false;
      applySuggestion();
      f.amount.focus();
    } else {
      close();
      toast(isEdit ? 'התנועה עודכנה' : 'התנועה נשמרה');
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
  el.querySelector('[data-cancel]').addEventListener('click', close);

  (isEdit ? f.description : f.amount).focus();
}
