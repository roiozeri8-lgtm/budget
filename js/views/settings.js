// Settings: categories & budgets, keyword rules, card-payment keywords, recurring items, backup.
import {
  state, categoriesOf, getCategory, saveCategory, deleteCategory, saveRule, deleteRule, setSetting,
  saveRecurring, deleteRecurring, saveTransactions, exportData, importData, mergeData, fallbackCategory,
} from '../store.js';
import { matchRule, suggestCategory, looksLikeCardPayment } from '../categorize.js';
import { escapeHtml, parseAmount, normalizeText, todayISO, currentMonth, formatDate } from '../format.js';
import { categoryOptions, confirmDialog, toast, downloadFile, $ } from '../ui.js';

const TABS = {
  categories: 'קטגוריות ותקציבים',
  rules: 'כללי סיווג',
  card: 'חיוב כרטיס אשראי',
  recurring: 'תנועות קבועות',
  backup: 'גיבוי וסנכרון',
};

let ruleSearch = '';
let ruleCatFilter = '';
let testText = '';

export function renderSettings(tab) {
  if (!TABS[tab]) tab = 'categories';
  return `
  <div class="page-head"><h1>הגדרות</h1></div>
  <nav class="tabs" role="tablist">
    ${Object.entries(TABS).map(([k, label]) => `<a role="tab" href="#settings/${k}" class="tab ${k === tab ? 'active' : ''}" aria-selected="${k === tab}">${label}</a>`).join('')}
  </nav>
  <section class="card settings-panel" data-tab="${tab}">
    ${{ categories: categoriesTab, rules: rulesTab, card: cardTab, recurring: recurringTab, backup: backupTab }[tab]()}
  </section>`;
}

// ---------- categories & budgets ----------

function categoriesTab() {
  const block = (kind, title) => `
    <h3>${title}</h3>
    <table class="settings-table">
      <thead><tr><th>צבע</th><th>שם</th>${kind === 'expense' ? '<th>תקרה חודשית (₪)</th>' : ''}<th></th></tr></thead>
      <tbody>
      ${categoriesOf(kind).map((c) => `
        <tr data-cat="${escapeHtml(c.id)}">
          <td><input type="color" value="${c.color}" data-field="color" aria-label="צבע"></td>
          <td><input value="${escapeHtml(c.name)}" data-field="name" aria-label="שם הקטגוריה"></td>
          ${kind === 'expense' ? `<td><input inputmode="decimal" class="num-input" value="${c.budget ?? ''}" placeholder="ללא" data-field="budget" aria-label="תקרה חודשית"></td>` : ''}
          <td><button type="button" class="icon-btn danger" data-del-cat title="מחיקה" aria-label="מחיקת קטגוריה">🗑</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  const total = state.settings.totalBudget;
  return `
    <p class="hint">שינויים נשמרים אוטומטית. תקרה ריקה = ללא תקציב לקטגוריה.</p>
    <label class="field inline-field">
      <span>תקציב חודשי כולל (לא חובה)</span>
      <input inputmode="decimal" class="num-input" data-total-budget value="${total ?? ''}" placeholder="סכום התקרות של הקטגוריות">
    </label>
    ${block('expense', 'קטגוריות הוצאה')}
    ${block('income', 'קטגוריות הכנסה')}
    <form class="add-row" data-add-cat>
      <h3>קטגוריה חדשה</h3>
      <input name="name" placeholder="שם הקטגוריה" required>
      <select name="kind"><option value="expense">הוצאה</option><option value="income">הכנסה</option></select>
      <input type="color" name="color" value="#2a78d6" aria-label="צבע">
      <button class="btn btn-primary">הוספה</button>
    </form>`;
}

// ---------- rules ----------

function rulesTab() {
  const q = normalizeText(ruleSearch);
  const all = [...state.rules].sort((a, b) => (getCategory(a.categoryId)?.order ?? 99) - (getCategory(b.categoryId)?.order ?? 99) || a.keyword.localeCompare(b.keyword, 'he'));
  const rows = all
    .filter((r) => !ruleCatFilter || r.categoryId === ruleCatFilter)
    .filter((r) => !q || r.keyword.includes(q));
  const allCats = [...categoriesOf('expense'), ...categoriesOf('income')];
  const test = testText.trim() ? testResult(testText) : '';

  return `
    <p class="hint">כלל = מילת מפתח שמופיעה בתיאור התנועה ← קטגוריה. אם כמה כללים מתאימים, המילה הארוכה ביותר קובעת.
    מילים של עד 3 אותיות (כמו "פז") נבדקות כמילה שלמה בלבד. תיקון ידני של קטגוריה בתנועה נזכר ועוקף את הכללים לאותו תיאור.</p>

    <form class="add-row" data-add-rule>
      <input name="keyword" placeholder="מילת מפתח, למשל: שופרסל" required>
      <select name="categoryId">${categoryOptions(allCats, 'food')}</select>
      <button class="btn btn-primary">הוספת כלל</button>
    </form>

    <div class="rule-test">
      <label class="field inline-field"><span>בדיקה: הקלידו תיאור</span>
        <input data-rule-test value="${escapeHtml(testText)}" placeholder="למשל: שופרסל דיל רמת גן"></label>
      <span data-rule-test-result>${test}</span>
    </div>

    <div class="filters">
      <input type="search" data-rule-search placeholder="חיפוש מילת מפתח…" value="${escapeHtml(ruleSearch)}">
      <select data-rule-cat><option value="">כל הקטגוריות</option>${categoryOptions(allCats, ruleCatFilter)}</select>
      <span class="muted">${rows.length} כללים</span>
      <button type="button" class="btn btn-secondary btn-sm" data-recategorize>סווג מחדש תנועות שב"שונות"</button>
    </div>

    <table class="settings-table">
      <thead><tr><th>מילת מפתח</th><th>קטגוריה</th><th></th></tr></thead>
      <tbody>
      ${rows.map((r) => `
        <tr data-rule="${escapeHtml(r.id)}">
          <td><input value="${escapeHtml(r.keyword)}" data-field="keyword" aria-label="מילת מפתח"></td>
          <td><select data-field="categoryId" aria-label="קטגוריה">${categoryOptions(allCats, r.categoryId)}</select></td>
          <td><button type="button" class="icon-btn danger" data-del-rule aria-label="מחיקת כלל">🗑</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function testResult(text) {
  const exp = suggestCategory(text, 'expense');
  const inc = matchRule(normalizeText(text), 'income');
  const parts = [];
  if (exp) parts.push(`הוצאה ← <b>${escapeHtml(getCategory(exp.categoryId)?.name)}</b> ${exp.reason === 'history' ? '(לפי תנועות קודמות)' : `(כלל "${escapeHtml(exp.keyword)}")`}`);
  if (inc) parts.push(`הכנסה ← <b>${escapeHtml(getCategory(inc.categoryId)?.name)}</b> (כלל "${escapeHtml(inc.keyword)}")`);
  if (looksLikeCardPayment(text)) parts.push('<b>יזוהה כחיוב כרטיס אשראי</b> בעו"ש');
  return parts.length ? parts.join(' · ') : '<span class="muted">אין כלל מתאים — תסווג ל"שונות"</span>';
}

// ---------- card payments ----------

function cardTab() {
  const list = state.settings.cardKeywords || [];
  return `
    <p class="hint">שורה בעו"ש שהתיאור שלה מכיל אחת מהמילים האלה תסומן אוטומטית כ"חיוב כרטיס אשראי" ולא תיספר בהוצאות,
    כי הפירוט שלה מגיע מצילום הכרטיס. בכל תנועה אפשר לסמן או לבטל את זה ידנית (כפתור 💳 ברשימה).</p>
    <div class="chips">
      ${list.map((k, i) => `<span class="chip">${escapeHtml(k)}<button type="button" data-del-card="${i}" aria-label="הסרה">✕</button></span>`).join('')}
    </div>
    <form class="add-row" data-add-card>
      <input name="keyword" placeholder="למשל: ויזה כאל" required>
      <button class="btn btn-primary">הוספה</button>
    </form>`;
}

// ---------- recurring ----------

function recurringTab() {
  const recs = [...state.recurring].sort((a, b) => a.description.localeCompare(b.description, 'he'));
  return `
    <p class="hint">תנועה קבועה נוספת אוטומטית פעם בחודש (בפתיחת האפליקציה). מסמנים תנועה כקבועה בטופס "הוספת תנועה".
    עצירה או מחיקה כאן לא מוחקות תנועות שכבר נוצרו.</p>
    ${recs.length === 0 ? '<p class="empty">אין תנועות קבועות. למשל: משכורת, שכירות, מנוי — סמנו "תנועה קבועה" בטופס ההוספה.</p>' : `
    <table class="settings-table">
      <thead><tr><th>תיאור</th><th>סוג</th><th>סכום</th><th>קטגוריה</th><th>יום בחודש</th><th>פעילה</th><th></th></tr></thead>
      <tbody>
      ${recs.map((r) => `
        <tr data-rec="${escapeHtml(r.id)}">
          <td><input value="${escapeHtml(r.description)}" data-field="description" aria-label="תיאור"></td>
          <td>${r.type === 'income' ? 'הכנסה' : 'הוצאה'}</td>
          <td><input inputmode="decimal" class="num-input" value="${r.amount}" data-field="amount" aria-label="סכום"></td>
          <td><select data-field="categoryId" aria-label="קטגוריה">${categoryOptions(categoriesOf(r.type), r.categoryId)}</select></td>
          <td><input type="number" min="1" max="31" class="day-input" value="${r.day}" data-field="day" aria-label="יום בחודש"></td>
          <td><input type="checkbox" ${r.active ? 'checked' : ''} data-field="active" aria-label="פעילה"></td>
          <td><button type="button" class="btn btn-ghost btn-sm danger" data-del-rec>ביטול</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`}`;
}

// ---------- backup ----------

function backupTab() {
  const { lastBackup, lastSync } = state.settings;
  return `
    <p class="hint">הנתונים נשמרים רק במכשיר הזה (בדפדפן). קובץ הגיבוי משמש גם לגיבוי וגם לסנכרון בין המחשב לאייפון.
    שמרו אותו בתיקייה בענן (iCloud Drive או OneDrive) כדי שיהיה זמין בשני המכשירים.</p>
    <p>${state.transactions.length} תנועות · ${state.categories.length} קטגוריות · ${state.rules.length} כללים.<br>
      ${lastBackup ? `ייצוא אחרון: ${formatDate(lastBackup.slice(0, 10))}` : '<b>עדיין לא בוצע גיבוי.</b>'}
      ${lastSync ? ` · סנכרון אחרון: ${formatDate(lastSync.slice(0, 10))}` : ''}</p>

    <h3>1. ייצוא</h3>
    <div class="form-actions">
      <button type="button" class="btn btn-primary" data-export>ייצוא גיבוי</button>
    </div>

    <h3>2. סנכרון — מיזוג גיבוי ממכשיר אחר</h3>
    <p class="hint">מוסיף את מה שחדש בקובץ ומעדכן את מה שהשתנה, בלי למחוק את מה שהזנת במכשיר הזה.
    תנועה שנמחקה באחד המכשירים תימחק גם כאן. לסנכרון מלא בשני הכיוונים: מייצאים ממכשיר א',
    ממזגים במכשיר ב', ואז מייצאים ממכשיר ב' וממזגים במכשיר א'.</p>
    <label class="btn btn-secondary">מיזוג מקובץ גיבוי…<input type="file" accept=".json,application/json" data-import="merge" class="visually-hidden"></label>

    <h3>3. שחזור מלא</h3>
    <p class="hint">מחליף את <b>כל</b> הנתונים במכשיר הזה בנתונים שבקובץ. מתאים לשחזור אחרי תקלה או למכשיר חדש.</p>
    <label class="btn btn-ghost">שחזור מלא מקובץ…<input type="file" accept=".json,application/json" data-import="replace" class="visually-hidden"></label>`;
}

/** Export: share sheet on phones (save to Files / iCloud / OneDrive), download elsewhere. */
async function exportBackup() {
  const name = `budget-backup-${todayISO()}.json`;
  const json = JSON.stringify(exportData(), null, 1);
  const file = new File([json], name, { type: 'application/json' });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
    } catch (err) {
      if (err.name === 'AbortError') return; // user closed the share sheet
      downloadFile(name, json);
    }
  } else {
    downloadFile(name, json);
  }
  await setSetting('lastBackup', new Date().toISOString());
  toast(touch ? 'הגיבוי נוצר' : 'קובץ הגיבוי נשמר בתיקיית ההורדות');
}

// ---------- events ----------

export function bindSettings(root, rerender) {
  root.addEventListener('change', async (e) => {
    const t = e.target;

    if (t.matches('[data-total-budget]')) {
      const v = parseAmount(t.value);
      await setSetting('totalBudget', isFinite(v) && v > 0 ? Math.abs(v) : null);
      toast('נשמר');
      return;
    }

    const catRow = t.closest('[data-cat]');
    if (catRow && t.dataset.field) {
      const cat = { ...getCategory(catRow.dataset.cat) };
      if (t.dataset.field === 'name') {
        if (!t.value.trim()) { t.value = cat.name; return; }
        cat.name = t.value.trim();
      } else if (t.dataset.field === 'color') {
        cat.color = t.value;
      } else if (t.dataset.field === 'budget') {
        const v = parseAmount(t.value);
        cat.budget = isFinite(v) && v > 0 ? Math.abs(v) : null;
      }
      await saveCategory(cat);
      toast('נשמר');
      return;
    }

    const ruleRow = t.closest('[data-rule]');
    if (ruleRow && t.dataset.field) {
      const rule = { ...state.rules.find((r) => r.id === ruleRow.dataset.rule) };
      if (t.dataset.field === 'keyword') {
        if (!t.value.trim()) { t.value = rule.keyword; return; }
        rule.keyword = t.value;
      } else rule.categoryId = t.value;
      await saveRule(rule);
      toast('הכלל עודכן');
      return;
    }

    if (t.matches('[data-rule-cat]')) { ruleCatFilter = t.value; rerender(); return; }

    const recRow = t.closest('[data-rec]');
    if (recRow && t.dataset.field) {
      const rec = { ...state.recurring.find((r) => r.id === recRow.dataset.rec) };
      const f = t.dataset.field;
      if (f === 'amount') {
        const v = parseAmount(t.value);
        if (!isFinite(v) || v === 0) { t.value = rec.amount; return; }
        rec.amount = Math.abs(v);
      } else if (f === 'day') {
        rec.day = Math.min(31, Math.max(1, parseInt(t.value, 10) || 1));
      } else if (f === 'active') {
        rec.active = t.checked;
        // resuming starts from next month, paused months are not back-filled
        if (rec.active && (!rec.lastGenerated || rec.lastGenerated < currentMonth())) rec.lastGenerated = currentMonth();
      } else if (f === 'description') {
        if (!t.value.trim()) { t.value = rec.description; return; }
        rec.description = t.value.trim();
      } else rec[f] = t.value;
      await saveRecurring(rec);
      toast(f === 'active' ? (rec.active ? 'התנועה הקבועה הופעלה (מהחודש הבא)' : 'התנועה הקבועה נעצרה') : 'נשמר — יחול מהחודש הבא');
      return;
    }

    if (t.matches('[data-import]') && t.files[0]) {
      const file = t.files[0];
      const mode = t.dataset.import;
      t.value = '';
      let data;
      try { data = JSON.parse(await file.text()); } catch { toast('הקובץ אינו קובץ גיבוי תקין', 'error'); return; }
      try {
        if (mode === 'merge') {
          const s = await mergeData(data);
          toast(`הסנכרון הושלם: ${s.added} תנועות חדשות, ${s.updated} עודכנו, ${s.deleted} נמחקו`);
        } else {
          const ok = await confirmDialog(`לשחזר מ-"${escapeHtml(file.name)}"? <b>כל הנתונים הנוכחיים במכשיר הזה יוחלפו</b> בנתונים שבקובץ.`, { okText: 'שחזור', danger: true, title: 'שחזור מלא' });
          if (!ok) return;
          await importData(data);
          toast('הגיבוי שוחזר בהצלחה');
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-rule-search]')) {
      ruleSearch = t.value;
      rerender();
      const input = $('[data-rule-search]', root);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    if (t.matches('[data-rule-test]')) {
      testText = t.value;
      $('[data-rule-test-result]', root).innerHTML = testText.trim() ? testResult(testText) : '';
    }
  });

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.matches('[data-add-cat]')) {
      const name = form.elements.name.value.trim();
      if (!name) return;
      const kind = form.elements.kind.value;
      await saveCategory({ name, kind, color: form.elements.color.value, order: Math.max(0, ...state.categories.map((c) => c.order)) + 1 });
      toast(`הקטגוריה "${name}" נוספה`);
    }
    if (form.matches('[data-add-rule]')) {
      const keyword = form.elements.keyword.value.trim().toLowerCase();
      if (!keyword) return;
      const existing = state.rules.find((r) => r.keyword === keyword);
      await saveRule({ ...(existing || {}), keyword, categoryId: form.elements.categoryId.value });
      toast(existing ? `הכלל "${keyword}" עודכן` : `הכלל "${keyword}" נוסף`);
    }
    if (form.matches('[data-add-card]')) {
      const kw = form.elements.keyword.value.trim();
      if (!kw) return;
      const list = state.settings.cardKeywords || [];
      if (!list.includes(kw)) await setSetting('cardKeywords', [...list, kw]);
    }
  });

  root.addEventListener('click', async (e) => {
    const t = e.target;

    if (t.closest('[data-del-cat]')) {
      const cat = getCategory(t.closest('[data-cat]').dataset.cat);
      const same = categoriesOf(cat.kind).filter((c) => c.id !== cat.id);
      if (!same.length) { toast('חייבת להישאר לפחות קטגוריה אחת מהסוג הזה', 'error'); return; }
      const fb = fallbackCategory(cat.kind);
      const moveTo = fb && fb !== cat.id ? getCategory(fb) : same[0];
      const count = state.transactions.filter((t2) => t2.categoryId === cat.id).length;
      const ok = await confirmDialog(
        `למחוק את הקטגוריה "${escapeHtml(cat.name)}"?${count ? ` ${count} תנועות יועברו ל"${escapeHtml(moveTo.name)}".` : ''} הכללים שלה יימחקו.`,
        { okText: 'מחיקה', danger: true, title: 'מחיקת קטגוריה' });
      if (ok) { await deleteCategory(cat.id, moveTo.id); toast('הקטגוריה נמחקה'); }
    }

    if (t.closest('[data-del-rule]')) {
      await deleteRule(t.closest('[data-rule]').dataset.rule);
      toast('הכלל נמחק');
    }

    if (t.closest('[data-del-card]')) {
      const i = Number(t.closest('[data-del-card]').dataset.delCard);
      const list = [...(state.settings.cardKeywords || [])];
      list.splice(i, 1);
      await setSetting('cardKeywords', list);
    }

    if (t.closest('[data-del-rec]')) {
      const rec = state.recurring.find((r) => r.id === t.closest('[data-rec]').dataset.rec);
      const ok = await confirmDialog(`לבטל את התנועה הקבועה "${escapeHtml(rec.description)}"? תנועות שכבר נוצרו יישארו.`, { okText: 'ביטול התנועה הקבועה', cancelText: 'חזרה', danger: true, title: 'ביטול תנועה קבועה' });
      if (ok) { await deleteRecurring(rec.id); toast('התנועה הקבועה בוטלה'); }
    }

    if (t.closest('[data-recategorize]')) {
      const changed = [];
      for (const tx of state.transactions) {
        if (tx.categoryId !== fallbackCategory(tx.type)) continue;
        const r = matchRule(normalizeText(tx.description), tx.type);
        if (r && r.categoryId !== tx.categoryId) changed.push({ ...tx, categoryId: r.categoryId });
      }
      if (changed.length) await saveTransactions(changed);
      toast(changed.length ? `${changed.length} תנועות סווגו מחדש` : 'לא נמצאו תנועות לסיווג מחדש');
    }

    if (t.closest('[data-export]')) await exportBackup();
  });
}
