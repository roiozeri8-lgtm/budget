// Settings: a list of sections, each opening its own page.
import {
  state, categoriesOf, getCategory, saveCategory, deleteCategory, saveRule, deleteRule, setSetting,
  saveRecurring, deleteRecurring, saveTransactions, exportData, importData, mergeData, fallbackCategory,
  monthStartDay, periodOf, currentBudgetMonth,
} from '../store.js';
import { matchRule, suggestCategory, looksLikeCardPayment } from '../categorize.js';
import { escapeHtml, parseAmount, normalizeText, todayISO, currentMonth, formatDate, formatShortDate } from '../format.js';
import { categoryOptions, confirmDialog, toast, downloadFile, view, $ } from '../ui.js';
import { icon } from '../icons.js';
import { lockEnabled, enableLock, disableLock, addBiometrics, biometricsAvailable } from '../lock.js';

const SECTIONS = {
  general: { title: 'חודש ותקציב כולל', icon: 'calendar', render: generalPage },
  categories: { title: 'קטגוריות ותקציבים', icon: 'tag', render: categoriesPage },
  rules: { title: 'כללי סיווג', icon: 'sparkles', render: rulesPage },
  recurring: { title: 'תנועות וחיובים קבועים', icon: 'repeat', render: recurringPage },
  card: { title: 'חיוב כרטיס אשראי בעו"ש', icon: 'card', render: cardPage },
  applepay: { title: 'קליטה מ-Apple Pay', icon: 'phone', render: applePayPage },
  security: { title: 'נעילה ופרטיות', icon: 'lock', render: securityPage },
  backup: { title: 'גיבוי וסנכרון', icon: 'backup', render: backupPage },
};

let ruleSearch = '';
let ruleCatFilter = '';
let testText = '';
let bioAvailable = null;

export function renderSettings(sub) {
  const s = SECTIONS[sub];
  if (!s) return indexPage();
  return `
  <div class="page-head">
    <a href="#settings" class="back-link">${icon('prev', 18)} הגדרות</a>
    <h1>${s.title}</h1>
  </div>
  <div class="settings-page" data-section="${sub}">${s.render()}</div>`;
}

function subtitle(key) {
  const budgets = categoriesOf('expense').filter((c) => c.budget > 0).length;
  const { lastBackup, lastSync } = state.settings;
  const last = [lastBackup, lastSync].filter(Boolean).sort().pop();
  return {
    general: monthStartDay() === 1 ? 'החודש מתחיל ב-1 לחודש' : `החודש מתחיל ב-${monthStartDay()} לחודש`,
    categories: `${state.categories.length} קטגוריות · ${budgets ? `${budgets} עם תקציב` : 'בלי תקציבים'}`,
    rules: `${state.rules.length} כללים`,
    recurring: `${state.recurring.length ? `${state.recurring.length} פעילות` : 'אין עדיין'}`,
    card: `${(state.settings.cardKeywords || []).length} מילות זיהוי`,
    applepay: 'הגדרת הקיצור באייפון',
    security: lockEnabled() ? 'הנעילה פעילה' : 'כבויה',
    backup: last ? `אחרון: ${formatDate(last.slice(0, 10))}` : 'עוד לא בוצע',
  }[key];
}

function indexPage() {
  const groups = [
    ['תקציב', ['general', 'categories', 'recurring']],
    ['סיווג וקליטה', ['rules', 'card', 'applepay']],
    ['המכשיר והנתונים', ['security', 'backup']],
  ];
  return `
  <div class="page-head"><h1>הגדרות</h1></div>
  ${groups.map(([title, keys]) => `
  <h2 class="group-title">${title}</h2>
  <nav class="card list-card">
    ${keys.map((k) => `
    <a href="#settings/${k}" class="list-row">
      <span class="list-icon">${icon(SECTIONS[k].icon, 18)}</span>
      <span class="list-main"><span class="list-title">${SECTIONS[k].title}</span><span class="list-sub">${subtitle(k)}</span></span>
      ${icon('next', 18, 'chev')}
    </a>`).join('')}
  </nav>`).join('')}
  <p class="footnote">${icon('shield', 14)} כל הנתונים נשמרים רק במכשיר הזה. שום תנועה לא נשלחת לשרת.</p>`;
}

// ---------- general ----------

function generalPage() {
  const start = monthStartDay();
  const p = periodOf(currentBudgetMonth());
  return `
  <section class="card">
    <label class="field">
      <span class="field-label">החודש התקציבי מתחיל ב־</span>
      <select class="input" data-month-start>
        ${Array.from({ length: 28 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${d === start ? 'selected' : ''}>${d} לחודש${d === 1 ? ' (רגיל)' : ''}</option>`).join('')}
      </select>
    </label>
    <p class="hint">אם המשכורת נכנסת למשל ב-10, בחרו 10: "נובמבר" יכלול את ה-10/11 עד ה-9/12, וכך כל משכורת והוצאות שהיא מממנת נמצאות באותו חודש.
    החודש הנוכחי: ${formatShortDate(p.from)}–${formatShortDate(p.to)}.</p>
  </section>
  <section class="card">
    <label class="field">
      <span class="field-label">תקציב חודשי כולל (לא חובה)</span>
      <input class="input num-input" inputmode="decimal" data-total-budget value="${state.settings.totalBudget ?? ''}" placeholder="ריק = סכום התקרות של הקטגוריות">
    </label>
    <p class="hint">"נשאר לך להוציא" מחושב מהתקציב הכולל. בלי תקציב כולל — מסכום התקרות של הקטגוריות, ואם גם הן לא הוגדרו — מההכנסות של החודש.</p>
  </section>`;
}

// ---------- categories & budgets ----------

function categoriesPage() {
  const block = (kind, title) => `
    <h2 class="group-title">${title}</h2>
    <div class="card list-card">
      ${categoriesOf(kind).map((c) => `
      <div class="cat-edit" data-cat="${escapeHtml(c.id)}">
        <input class="emoji-input" value="${escapeHtml(c.icon || '')}" data-field="icon" maxlength="4" aria-label="אייקון">
        <input type="color" value="${c.color}" data-field="color" aria-label="צבע">
        <input class="input" value="${escapeHtml(c.name)}" data-field="name" aria-label="שם הקטגוריה">
        ${kind === 'expense' ? `<label class="budget-input"><input class="input num-input" inputmode="decimal" value="${c.budget ?? ''}" placeholder="ללא תקרה" data-field="budget" aria-label="תקרה חודשית"><span>₪</span></label>` : ''}
        <button type="button" class="icon-btn" data-del-cat aria-label="מחיקת קטגוריה">${icon('trash', 18)}</button>
      </div>`).join('')}
    </div>`;
  return `
    <p class="hint">שינויים נשמרים לבד. תקרה = התקציב החודשי של הקטגוריה; בלוח הבקרה יופיע פס התקדמות והתראה כשמתקרבים אליה.</p>
    ${block('expense', 'הוצאות')}
    ${block('income', 'הכנסות')}
    <h2 class="group-title">קטגוריה חדשה</h2>
    <form class="card add-row" data-add-cat>
      <input class="emoji-input" name="icon" value="🏷️" maxlength="4" aria-label="אייקון">
      <input type="color" name="color" value="#2a78d6" aria-label="צבע">
      <input class="input" name="name" placeholder="שם הקטגוריה" required>
      <select class="input" name="kind"><option value="expense">הוצאה</option><option value="income">הכנסה</option></select>
      <button class="btn btn-primary">הוספה</button>
    </form>`;
}

// ---------- rules ----------

function rulesPage() {
  const q = normalizeText(ruleSearch);
  const all = [...state.rules].sort((a, b) => (getCategory(a.categoryId)?.order ?? 99) - (getCategory(b.categoryId)?.order ?? 99) || a.keyword.localeCompare(b.keyword, 'he'));
  const rows = all.filter((r) => !ruleCatFilter || r.categoryId === ruleCatFilter).filter((r) => !q || r.keyword.includes(q));
  const allCats = [...categoriesOf('expense'), ...categoriesOf('income')];
  return `
    <p class="hint">כלל = מילת מפתח בתיאור ← קטגוריה. אם כמה כללים מתאימים, המילה הארוכה קובעת. מילים של עד 3 אותיות (כמו "פז") נבדקות כמילה שלמה.
    כשמתקנים קטגוריה של תנועה, האפליקציה זוכרת את התיקון ומציעה ליצור כלל.</p>
    <section class="card">
      <label class="field"><span class="field-label">בדיקה: הקלידו תיאור של עסקה</span>
        <input class="input" data-rule-test value="${escapeHtml(testText)}" placeholder="למשל: שופרסל דיל רמת גן"></label>
      <p class="rule-result" data-rule-test-result>${testText.trim() ? testResult(testText) : ''}</p>
    </section>
    <form class="card add-row" data-add-rule>
      <input class="input" name="keyword" placeholder="מילת מפתח חדשה" required>
      <select class="input" name="categoryId">${categoryOptions(allCats, 'food')}</select>
      <button class="btn btn-primary">הוספת כלל</button>
    </form>
    <div class="toolbar">
      <label class="search">${icon('search', 18)}<input type="search" data-rule-search placeholder="חיפוש מילת מפתח" value="${escapeHtml(ruleSearch)}"></label>
      <div class="chip-row">
        <select class="chip chip-select ${ruleCatFilter ? 'active' : ''}" data-rule-cat><option value="">כל הקטגוריות</option>${categoryOptions(allCats, ruleCatFilter)}</select>
        <span class="muted small">${rows.length} כללים</span>
        <button type="button" class="chip" data-recategorize>${icon('sparkles', 14)} סיווג מחדש של "שונות"</button>
      </div>
    </div>
    <div class="card list-card">
      ${rows.map((r) => `
      <div class="rule-row" data-rule="${escapeHtml(r.id)}">
        <input class="input" value="${escapeHtml(r.keyword)}" data-field="keyword" aria-label="מילת מפתח">
        <select class="input" data-field="categoryId" aria-label="קטגוריה">${categoryOptions(allCats, r.categoryId)}</select>
        <button type="button" class="icon-btn" data-del-rule aria-label="מחיקת כלל">${icon('trash', 18)}</button>
      </div>`).join('')}
    </div>`;
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

function cardPage() {
  const list = state.settings.cardKeywords || [];
  return `
    <p class="hint">בעו"ש מופיע פעם בחודש חיוב מרוכז של כרטיס האשראי. שורה שהתיאור שלה מכיל אחת מהמילים האלה מסומנת אוטומטית
    כ"חיוב כרטיס אשראי" ולא נספרת בהוצאות — כי כל עסקה בכרטיס כבר נספרה בנפרד. בכל תנועה אפשר לשנות את הסימון בעריכה.</p>
    <section class="card">
      <div class="chips">
        ${list.map((k, i) => `<span class="tag">${escapeHtml(k)}<button type="button" data-del-card="${i}" aria-label="הסרה">${icon('close', 14)}</button></span>`).join('')}
      </div>
      <form class="add-row" data-add-card>
        <input class="input" name="keyword" placeholder="למשל: ויזה כאל" required>
        <button class="btn btn-primary">הוספה</button>
      </form>
    </section>`;
}

// ---------- recurring ----------

function recurringPage() {
  const recRow = (r) => `
    <div class="rec-row" data-rec="${escapeHtml(r.id)}">
      <div class="rec-top">
        <input class="input" value="${escapeHtml(r.description)}" data-field="description" aria-label="תיאור">
        <label class="switch" title="פעילה"><input type="checkbox" ${r.active ? 'checked' : ''} data-field="active" aria-label="פעילה"><span></span></label>
      </div>
      <div class="rec-grid">
        <label><span class="field-label">סכום</span><input class="input num-input" inputmode="decimal" value="${r.amount}" data-field="amount"></label>
        <label><span class="field-label">קטגוריה</span><select class="input" data-field="categoryId">${categoryOptions(categoriesOf(r.type), r.categoryId)}</select></label>
        <label><span class="field-label">יום בחודש</span><input class="input day-input" type="number" min="1" max="31" value="${r.day}" data-field="day"></label>
        <button type="button" class="btn btn-ghost btn-sm danger" data-del-rec>ביטול</button>
      </div>
    </div>`;
  const auto = state.recurring.filter((r) => r.mode !== 'expected');
  const expected = state.recurring.filter((r) => r.mode === 'expected');
  const dismissed = (state.settings.dismissedRecurring || []).length;
  return `
    <h2 class="group-title">תנועות קבועות — נוצרות לבד כל חודש</h2>
    <p class="hint">למשל משכורת, שכירות או חוג שאינם מגיעים מהבנק. מסמנים "תנועה קבועה" בטופס ההוספה.</p>
    <div class="card list-card">${auto.length ? auto.map(recRow).join('') : '<p class="muted pad">אין תנועות קבועות.</p>'}</div>

    <h2 class="group-title">חיובים קבועים צפויים — מגיעים מהבנק</h2>
    <p class="hint">מנויים והוראות קבע שמגיעים עם נתוני הבנק או Apple Pay. לא נוצרת עבורם תנועה — הם רק נכנסים לתחזית
    ול"חיובים צפויים" עד שהחיוב האמיתי מופיע. האפליקציה מזהה אותם לבד ומציעה אותם בלוח הבקרה.</p>
    <div class="card list-card">${expected.length ? expected.map(recRow).join('') : '<p class="muted pad">עדיין לא סומנו חיובים קבועים.</p>'}</div>
    ${dismissed ? `<p class="hint">${dismissed} הצעות נדחו. <button type="button" class="link-btn" data-reset-dismissed>להציע אותן שוב</button></p>` : ''}`;
}

// ---------- Apple Pay guide ----------

function applePayPage() {
  return `
  <section class="card guide">
    <p>מגדירים פעם אחת באייפון אוטומציה שרושמת כל תשלום ב-Apple Pay כשורה בקובץ ב-iCloud Drive.
    אחר כך, מתי שנוח (למשל פעם ביום), קולטים את הקובץ באפליקציה בכמה לחיצות.</p>
    <ol class="steps">
      <li>פותחים את אפליקציית <b>קיצורים</b> (Shortcuts) ← לשונית <b>אוטומציה</b> ← <b>+</b>.</li>
      <li>בוחרים <b>עסקה</b> (Transaction), מסמנים את הכרטיסים שב-Wallet, בוחרים <b>הפעל מיד</b> (Run Immediately) ← <b>הבא</b> ← <b>אוטומציה ריקה חדשה</b>.</li>
      <li>מוסיפים פעולה <b>טקסט</b> (Text) ובונים בה את השורה:<br>
        <code class="code-line">תאריך נוכחי | סכום | סוחר | כרטיס</code>
        <ul>
          <li><b>תאריך נוכחי</b> (Current Date): מקישים עליו ← פורמט תאריך ← <b>מותאם אישית</b> ← <code>yyyy-MM-dd</code></li>
          <li><b>סכום</b>, <b>סוחר</b> ו<b>כרטיס</b>: מקישים על <b>קלט קיצור</b> (Shortcut Input) ובוחרים Amount / Merchant / Card</li>
          <li>בין השדות מקלידים את התו <code>|</code></li>
        </ul></li>
      <li>מוסיפים פעולה <b>הוסף לקובץ טקסט</b> (Append to Text File): הקובץ <code>budget-inbox.txt</code>, בתיקייה <b>Shortcuts</b> ב-iCloud Drive, עם <b>שורה חדשה</b> מופעל.</li>
      <li>שומרים. מעכשיו כל תשלום ב-Apple Pay נוסף לקובץ — בלי שום פעולה מצדך.</li>
      <li>לקליטה: <a href="#import">ייבוא</a> ← <b>בחירת קובץ התשלומים</b> ← קבצים ← iCloud Drive ← Shortcuts ← <code>budget-inbox.txt</code>.</li>
    </ol>
    <p class="hint">${icon('info', 14)} תשלומים שכבר נקלטו מדולגים לבד, אז אין צורך לרוקן את הקובץ. כשיגיעו הנתונים מהבנק (צילום מסך),
    האפליקציה תזהה שזו אותה עסקה ותציע למזג, כך ששום הוצאה לא נספרת פעמיים.</p>
    <p class="hint">שורה לדוגמה בקובץ: <code dir="ltr">2026-11-18|₪42.50|ARCAFFE|Visa</code>. שמות הפעולות באייפון עשויים להיות מעט שונים לפי גרסת iOS.</p>
  </section>`;
}

// ---------- security ----------

function securityPage() {
  if (bioAvailable === null) biometricsAvailable().then((v) => { bioAvailable = v; if (location.hash === '#settings/security') window.dispatchEvent(new HashChangeEvent('hashchange')); });
  const lock = state.settings.lock || {};
  return `
  <section class="card">
    ${lockEnabled() ? `
      <p class="status-line ok">${icon('lock', 18)} הנעילה פעילה במכשיר הזה. האפליקציה ננעלת בפתיחה ואחרי דקה ברקע.</p>
      ${bioAvailable ? `<button type="button" class="btn btn-secondary" data-add-bio>${icon('faceid', 18)} ${lock.credId ? 'רישום מחדש של Face ID' : 'הפעלת Face ID / טביעת אצבע'}</button>` : ''}
      ${lock.credId ? '<p class="hint">Face ID מופעל. הקוד נשאר כגיבוי.</p>' : ''}
      <form class="pin-form" data-change-pin>
        <span class="field-label">שינוי קוד</span>
        <input class="input pin-input" name="pin" type="password" inputmode="numeric" maxlength="8" placeholder="קוד חדש (4–8 ספרות)" required>
        <button class="btn btn-ghost">שמירת קוד חדש</button>
      </form>
      <button type="button" class="btn btn-ghost danger" data-disable-lock>כיבוי הנעילה</button>`
    : `
      <p>נעילה מונעת ממי שמחזיק את הטלפון או המחשב לראות את המצב הכספי שלך. פותחים עם Face ID (או טביעת אצבע) או עם קוד.</p>
      <form class="pin-form" data-enable-lock>
        <input class="input pin-input" name="pin" type="password" inputmode="numeric" maxlength="8" placeholder="קוד (4–8 ספרות)" required>
        <input class="input pin-input" name="pin2" type="password" inputmode="numeric" maxlength="8" placeholder="שוב, לאימות" required>
        <button class="btn btn-primary">${icon('lock', 18)} הפעלת נעילה</button>
      </form>`}
    <p class="hint">${icon('info', 14)} זו נעילת פרטיות: היא חוסמת את המסך, אבל הנתונים עצמם לא מוצפנים בדפדפן. ההגדרה נפרדת לכל מכשיר.</p>
  </section>`;
}

// ---------- backup ----------

function backupPage() {
  const { lastBackup, lastSync } = state.settings;
  return `
    <section class="card">
      <p>${state.transactions.length} תנועות · ${state.categories.length} קטגוריות · ${state.rules.length} כללים<br>
        <span class="muted">${lastBackup ? `ייצוא אחרון: ${formatDate(lastBackup.slice(0, 10))}` : 'עדיין לא בוצע גיבוי'}${lastSync ? ` · סנכרון אחרון: ${formatDate(lastSync.slice(0, 10))}` : ''}</span></p>
      <p class="hint">הנתונים נשמרים רק במכשיר הזה. קובץ הגיבוי משמש גם לסנכרון בין המחשב לאייפון —
      שמרו אותו ב-iCloud Drive או ב-OneDrive כדי שיהיה זמין בשני המכשירים.</p>
    </section>

    <h2 class="group-title">1 · ייצוא</h2>
    <section class="card">
      <button type="button" class="btn btn-primary" data-export>${icon('backup', 18)} ייצוא גיבוי</button>
      <p class="hint">באייפון נפתח תפריט השיתוף — בחרו "שמירה בקבצים". במחשב הקובץ נשמר בהורדות.</p>
    </section>

    <h2 class="group-title">2 · סנכרון עם מכשיר אחר</h2>
    <section class="card">
      <label class="btn btn-secondary">${icon('sync', 18)} מיזוג מקובץ גיבוי…<input type="file" accept=".json,application/json" data-import="merge" class="visually-hidden"></label>
      <p class="hint">מוסיף את מה שחדש בקובץ ומעדכן את מה שהשתנה, בלי למחוק את מה שהזנת כאן. מחיקות עוברות גם הן.
      בשני הכיוונים: ייצוא בטלפון ← מיזוג במחשב ← ייצוא במחשב ← מיזוג בטלפון.</p>
    </section>

    <h2 class="group-title">3 · שחזור מלא</h2>
    <section class="card">
      <label class="btn btn-ghost">שחזור מלא מקובץ…<input type="file" accept=".json,application/json" data-import="replace" class="visually-hidden"></label>
      <p class="hint">מחליף את <b>כל</b> הנתונים במכשיר הזה בנתונים שבקובץ — לשחזור אחרי תקלה או במכשיר חדש.</p>
    </section>`;
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
      if (err.name === 'AbortError') return;
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
    if (!t.closest('.settings-page')) return;

    if (t.matches('[data-month-start]')) {
      await setSetting('monthStartDay', Number(t.value));
      view.month = currentBudgetMonth();
      toast('נשמר');
      return;
    }
    if (t.matches('[data-total-budget]')) {
      const v = parseAmount(t.value);
      await setSetting('totalBudget', isFinite(v) && v > 0 ? Math.abs(v) : null);
      toast('נשמר');
      return;
    }

    const catRow = t.closest('[data-cat]');
    if (catRow && t.dataset.field) {
      const cat = { ...getCategory(catRow.dataset.cat) };
      const f = t.dataset.field;
      if (f === 'name') {
        if (!t.value.trim()) { t.value = cat.name; return; }
        cat.name = t.value.trim();
      } else if (f === 'icon') {
        cat.icon = t.value.trim() || '🏷️';
      } else if (f === 'color') {
        cat.color = t.value;
      } else if (f === 'budget') {
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
      toast(f === 'active' ? (rec.active ? 'הופעל (מהחודש הבא)' : 'הושהה') : 'נשמר');
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
          toast(`הסנכרון הושלם: ${s.added} חדשות, ${s.updated} עודכנו, ${s.deleted} נמחקו`);
        } else {
          const ok = await confirmDialog(`לשחזר מ-"${escapeHtml(file.name)}"? <b>כל הנתונים הנוכחיים במכשיר הזה יוחלפו</b> בנתונים שבקובץ.`, { okText: 'שחזור', danger: true, title: 'שחזור מלא' });
          if (!ok) return;
          await importData(data);
          toast('הגיבוי שוחזר');
        }
        view.month = currentBudgetMonth();
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
    const form = e.target;
    if (!form.closest('.settings-page')) return;
    e.preventDefault();
    if (form.matches('[data-add-cat]')) {
      const name = form.elements.name.value.trim();
      if (!name) return;
      await saveCategory({
        name, kind: form.elements.kind.value, color: form.elements.color.value, icon: form.elements.icon.value.trim() || '🏷️',
        order: Math.max(0, ...state.categories.map((c) => c.order)) + 1,
      });
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
      const list = state.settings.cardKeywords || [];
      if (kw && !list.includes(kw)) await setSetting('cardKeywords', [...list, kw]);
    }
    if (form.matches('[data-enable-lock]')) {
      const { pin, pin2 } = form.elements;
      if (!/^\d{4,8}$/.test(pin.value)) { toast('הקוד צריך להיות 4–8 ספרות', 'error'); return; }
      if (pin.value !== pin2.value) { toast('הקודים לא זהים', 'error'); pin2.value = ''; pin2.focus(); return; }
      await enableLock(pin.value);
      toast('הנעילה הופעלה');
      if (await biometricsAvailable()) {
        const ok = await confirmDialog('להפעיל גם פתיחה עם Face ID / טביעת אצבע?', { okText: 'כן, להפעיל', cancelText: 'רק קוד', title: 'Face ID' });
        if (ok) { const done = await addBiometrics(); toast(done ? 'Face ID הופעל' : 'לא הצלחתי להפעיל Face ID — הקוד פעיל', done ? 'ok' : 'error'); }
      }
      rerender();
    }
    if (form.matches('[data-change-pin]')) {
      const pin = form.elements.pin.value;
      if (!/^\d{4,8}$/.test(pin)) { toast('הקוד צריך להיות 4–8 ספרות', 'error'); return; }
      const credId = state.settings.lock?.credId || null;
      await enableLock(pin);
      if (credId) await setSetting('lock', { ...state.settings.lock, credId });
      toast('הקוד עודכן');
    }
  });

  root.addEventListener('click', async (e) => {
    const t = e.target;
    if (!t.closest('.settings-page')) return;

    if (t.closest('[data-del-cat]')) {
      const cat = getCategory(t.closest('[data-cat]').dataset.cat);
      const same = categoriesOf(cat.kind).filter((c) => c.id !== cat.id);
      if (!same.length) { toast('חייבת להישאר לפחות קטגוריה אחת מהסוג הזה', 'error'); return; }
      const fb = fallbackCategory(cat.kind);
      const moveTo = fb && fb !== cat.id ? getCategory(fb) : same[0];
      const count = state.transactions.filter((x) => x.categoryId === cat.id).length;
      const ok = await confirmDialog(
        `למחוק את "${escapeHtml(cat.name)}"?${count ? ` ${count} תנועות יעברו ל"${escapeHtml(moveTo.name)}".` : ''} הכללים שלה יימחקו.`,
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
      const ok = await confirmDialog(`לבטל את "${escapeHtml(rec.description)}"? תנועות שכבר נוצרו יישארו.`, { okText: 'ביטול', cancelText: 'חזרה', danger: true, title: 'ביטול חיוב קבוע' });
      if (ok) { await deleteRecurring(rec.id); toast('בוטל'); }
    }
    if (t.closest('[data-reset-dismissed]')) {
      await setSetting('dismissedRecurring', []);
      toast('ההצעות יופיעו שוב בלוח הבקרה');
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
    if (t.closest('[data-add-bio]')) {
      const done = await addBiometrics();
      toast(done ? 'Face ID הופעל' : 'לא הצלחתי להפעיל Face ID במכשיר הזה', done ? 'ok' : 'error');
      rerender();
    }
    if (t.closest('[data-disable-lock]')) {
      const ok = await confirmDialog('לכבות את הנעילה במכשיר הזה?', { okText: 'כיבוי', danger: true, title: 'נעילה' });
      if (ok) { await disableLock(); toast('הנעילה כובתה'); }
    }
  });
}

