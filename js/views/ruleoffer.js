// After the user corrects a category, offer to turn it into a keyword rule
// (so other branches of the same business are categorised too).
import { getCategory, saveRule, saveTransactions, state, fallbackCategory } from '../store.js';
import { matchRule } from '../categorize.js';
import { normalizeText } from '../format.js';
import { toast, promptDialog } from '../ui.js';

/** "רמי לוי - חולון בע"מ 1234" -> "רמי לוי" (first words, no numbers / company suffix). */
export function suggestKeyword(description) {
  const words = normalizeText(description)
    .replace(/בע["״]?מ|ltd|inc/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[\d\-–_/\\|.,:;*#'"]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1);
  return words.slice(0, words.length >= 3 ? 2 : words.length).join(' ') || normalizeText(description);
}

export function offerRule(description, categoryId, type = 'expense') {
  const cat = getCategory(categoryId);
  if (!cat || !description.trim()) return;
  const existing = matchRule(normalizeText(description), type);
  if (existing?.categoryId === categoryId) return;
  toast(`לסווג תמיד עסקים כאלה ל"${cat.name}"?`, 'ok', {
    label: 'יצירת כלל',
    onClick: async () => {
      const keyword = await promptDialog({
        title: 'כלל סיווג חדש',
        message: `כל תנועה שהתיאור שלה מכיל את המילים האלה תסווג ל"${cat.name}". כדאי לקצר לשם העסק בלבד, בלי שם הסניף.`,
        value: suggestKeyword(description),
        okText: 'יצירת הכלל',
      });
      if (!keyword) return;
      await saveRule({ keyword, categoryId });
      // apply to transactions that are still in the fallback category
      const fb = fallbackCategory(type);
      const kw = normalizeText(keyword);
      const fix = state.transactions.filter((t) => t.type === type && t.categoryId === fb && normalizeText(t.description).includes(kw))
        .map((t) => ({ ...t, categoryId }));
      if (fix.length) await saveTransactions(fix);
      toast(`הכלל נשמר${fix.length ? ` ו-${fix.length} תנועות נוספות סווגו` : ''}`);
    },
  });
}
