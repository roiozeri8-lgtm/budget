// Initial data: categories, keyword rules and credit-card-payment keywords.
// Everything here is editable later in the Settings screen.

export const DEFAULT_CATEGORIES = [
  // expenses
  { id: 'food',          name: 'מזון וסופר',                         kind: 'expense', color: '#2a78d6', icon: '🛒' },
  { id: 'restaurants',   name: 'מסעדות ובתי קפה',                    kind: 'expense', color: '#eb6834', icon: '☕' },
  { id: 'fuel',          name: 'דלק ותחבורה',                         kind: 'expense', color: '#1baf7a', icon: '⛽' },
  { id: 'bills',         name: 'חשבונות (חשמל, מים, ארנונה, גז)',     kind: 'expense', color: '#eda100', icon: '💡' },
  { id: 'telecom',       name: 'תקשורת (סלולר, אינטרנט)',             kind: 'expense', color: '#e87ba4', icon: '📱' },
  { id: 'housing',       name: 'דיור (שכירות או משכנתא)',             kind: 'expense', color: '#008300', icon: '🏠' },
  { id: 'health',        name: 'בריאות ופארם',                        kind: 'expense', color: '#4a3aa7', icon: '💊' },
  { id: 'clothing',      name: 'ביגוד והנעלה',                        kind: 'expense', color: '#e34948', icon: '👕' },
  { id: 'leisure',       name: 'בילויים ופנאי',                       kind: 'expense', color: '#0f8a8a', icon: '🎉' },
  { id: 'kids',          name: 'ילדים וחינוך',                        kind: 'expense', color: '#b0307a', icon: '🧸' },
  { id: 'insurance',     name: 'ביטוחים',                             kind: 'expense', color: '#5b6b7f', icon: '🛡️' },
  { id: 'subscriptions', name: 'מנויים',                              kind: 'expense', color: '#4fa8d8', icon: '🔁' },
  { id: 'transfers',     name: 'העברות ומשיכות מזומן',                kind: 'expense', color: '#8a5a2b', icon: '💸' },
  { id: 'misc',          name: 'שונות',                               kind: 'expense', color: '#8a8a85', icon: '📦' },
  // income
  { id: 'salary',        name: 'משכורת',                              kind: 'income',  color: '#0ca30c', icon: '💼' },
  { id: 'other-income',  name: 'הכנסות אחרות',                        kind: 'income',  color: '#6aa84f', icon: '💰' },
].map((c, i) => ({ ...c, order: i, budget: null }));

export const DEFAULT_ICON = '🏷️';

/** Category to fall back to when nothing matches / a category is deleted. */
export const FALLBACK_CATEGORY = { expense: 'misc', income: 'other-income' };

const RULES_BY_CATEGORY = {
  food: [
    'שופרסל', 'רמי לוי', 'יוחננוף', 'ויקטורי', 'מגה בעיר', 'יינות ביתן', 'אושר עד', 'חצי חינם', 'טיב טעם',
    'קרפור', 'carrefour', 'מחסני השוק', 'פרש מרקט', 'freshmarket', 'am:pm', 'am pm', 'קשת טעמים',
    'זול ובגדול', 'היפר כהן', 'שוק העיר', 'נתיב החסד', 'סטופ מרקט', 'יש חסד', 'שפע שוק', 'קואופ', 'co-op',
    'סופר יודה', 'מינימרקט', 'מכולת', 'סופרמרקט', 'מעדניה', 'מאפיה', 'קצביה', 'ירקות', 'פירות', 'סופר דוש',
    'ברקת', 'פוליצר', 'סופר ספיר', 'shufersal', 'rami levy', 'victory', 'yochananof',
    'מרקט', 'market', 'סופר מרקט', 'נאייקס', 'nayax', 'מכונות אוטומ', 'שוק', 'מאפה', 'מאפיית',
    'osher ad', 'hazi hinam', 'tiv taam', 'mega', 'am pm', 'yeinot bitan', 'super yuda', 'keshet teamim',
  ],
  restaurants: [
    'מקדונלד', 'mcdonald', 'בורגראנץ', 'burger king', 'ארומה', 'aroma', 'קפה קפה', 'גרג', 'לנדוור', 'cofix',
    'קופיקס', 'רולדין', 'דומינו', 'domino', 'פיצה האט', 'pizza hut', 'wolt', 'וולט', 'תן ביס', '10bis',
    'סיבוס', 'cibus', 'ג\'פניקה', 'japanika', 'מסעדה', 'מסעדת', 'בית קפה', 'שווארמה', 'פלאפל', 'סושי',
    'ביסטרו', 'אגדיר', 'מוזס', 'kfc', 'ארקפה', 'קפה ג\'ו', 'בנדיקט', 'פיצה', 'המבורגר', 'גלידה', 'אנה לולו',
    'קפה', 'סביח', 'פיצרייה', 'פיצריה', 'בורגר', 'שניצל', 'חומוס', 'קונדיטוריה',
    'arcaffe', 'cafe', 'coffee', 'landwer', 'greg', 'roladin', 'mcdonalds', 'burger', 'pizza', 'sushi', 'restaurant', 'golda', 'aroma',
  ],
  fuel: [
    'פז', 'סונול', 'דלק', 'דור אלון', 'טן', 'ten', 'yellow', 'ילו', 'סדש', 'רב קו', 'רב-קו', 'rav kav',
    'רכבת ישראל', 'אגד', 'דן', 'מטרופולין', 'אפיקים', 'קווים', 'אקסטרה', 'גט טקסי', 'gett', 'yango',
    'יאנגו', 'פנגו', 'pango', 'סלופארק', 'cellopark', 'חניון', 'חניה', 'אחוזת חוף', 'כביש 6', 'כביש חוצה',
    'דרך ארץ', 'מנהרות הכרמל', 'נתיבי איילון', 'מוסך', 'צמיגים', 'טסט', 'רישוי', 'moovit', 'מוביט',
    'paz', 'sonol', 'delek', 'dor alon', 'israel railways', 'egged', 'parking',
  ],
  bills: [
    'חברת החשמל', 'חברת חשמל', 'חח"י', 'חשמל', 'תאגיד מים', 'מי אביבים', 'הגיחון', 'מי שבע', 'מי כרמל',
    'מי רעננה', 'מי נתניה', 'מיתב', 'מים', 'ארנונה', 'עירית', 'עיריית', 'מועצה', 'אמישראגז', 'אמישרגז',
    'סופרגז', 'פזגז', 'גז', 'אלקטרה פאוור', 'סלקום אנרגיה',
  ],
  telecom: [
    'סלקום', 'cellcom', 'פרטנר', 'partner', 'הוט', 'hot', 'הוט מובייל', 'בזק', 'bezeq', 'בזק בינלאומי',
    'פלאפון', 'pelephone', 'גולן טלקום', 'רמי לוי תקשורת', '012', '013', '019', 'נטוויז\'ן', 'אקספון',
    'xfone', 'we4g', 'yes', 'יס', 'וואלה מובייל',
  ],
  housing: ['שכירות', 'שכר דירה', 'משכנתא', 'משכנתה', 'ועד בית', 'דמי ניהול', 'הלוואת משכנתא'],
  health: [
    'סופר פארם', 'super-pharm', 'superpharm', 'בי פארם', 'ניו פארם', 'new pharm', 'גוד פארם', 'מכבי',
    'כללית', 'מאוחדת', 'לאומית', 'בית מרקחת', 'פארם', 'מרפאה', 'רופא', 'אופטיקה', 'משקפיים', 'שיניים',
    'אסותא', 'רפואה', 'מעבדה', 'סופרפארם', 'קליניק', 'מרפאת', 'פיזיותרפיה', 'וטרינר',
    'pharm', 'maccabi', 'clalit', 'meuhedet',
  ],
  clothing: [
    'קסטרו', 'castro', 'פוקס', 'fox', 'זארה', 'zara', 'h&m', 'אמריקן איגל', 'american eagle', 'גולף',
    'golf', 'רנואר', 'renuar', 'טרמינל איקס', 'terminal x', 'terminalx', 'נעלי', 'נעליים', 'עדיקה',
    'adika', 'asos', 'אסוס', 'shein', 'שיין', 'הודיס', 'hoodies', 'אורבניקה', 'urbanica', 'מנגו', 'mango',
    'נייקי', 'nike', 'אדידס', 'adidas', 'foot locker', 'פוט לוקר', 'תמנון', 'קרייזי ליין', 'ליבנה',
    'גלי', 'סקופ',
  ],
  leisure: [
    'סינמה סיטי', 'cinema city', 'יס פלאנט', 'yes planet', 'רב חן', 'סינמטק', 'קולנוע', 'הופעה', 'eventim',
    'לאן', 'leaan', 'תיאטרון', 'הבימה', 'הקאמרי', 'זאפה', 'בארבי', 'ספא', 'כושר', 'הולמס פלייס',
    'holmes place', 'ספורטן', 'booking', 'airbnb', 'אל על', 'el al', 'ישראייר', 'ארקיע', 'wizz', 'ryanair',
    'מלון', 'צימר', 'steam', 'playstation', 'סטימצקי', 'צומת ספרים', 'מוזיאון', 'ספארי', 'לונה פארק',
  ],
  kids: [
    'מעון', 'צהרון', 'בית ספר', 'ביה"ס', 'חוגים', 'חוג', 'גן ילדים', 'קייטנה', 'מתנ"ס', 'תשלומי הורים',
    'שכר לימוד', 'אוניברסיטה', 'מכללה', 'טויס אר אס', 'toys r us', 'כפר השעשועים', 'מוצצים', 'בייבי',
    'שילב',
  ],
  insurance: [
    'ביטוח', 'הראל ביטוח', 'הראל חברה', 'מגדל ביטוח', 'מגדל חברה', 'מגדל מקפת', 'כלל ביטוח', 'כלל חברה',
    'הפניקס', 'מנורה מבטחים', 'איילון ביטוח', 'איילון חברה', 'ביטוח ישיר', 'aig', 'שירביט', 'הכשרה ביטוח',
    'ליברה', 'wesure', '9 מיליון',
  ],
  subscriptions: [
    'נטפליקס', 'netflix', 'spotify', 'ספוטיפיי', 'apple.com', 'itunes', 'google', 'youtube', 'disney',
    'דיסני', 'amazon prime', 'prime video', 'chatgpt', 'openai', 'microsoft', 'adobe', 'icloud', 'dropbox',
    'hbo', 'anthropic', 'claude.ai', 'מנוי', 'הארץ', 'ידיעות', 'patreon', 'audible',
  ],
  transfers: [
    'משיכת מזומן', 'משיכה מכספומט', 'כספומט', 'מזומן', 'העברה', 'bit', 'ביט', 'פייבוקס', 'paybox',
    'pepper pay', 'העברת', 'צ\'ק', 'שיק', 'blink', 'investment', 'השקעות',
  ],
  misc: [
    'aliexpress', 'עלי אקספרס', 'amazon', 'אמזון', 'ebay', 'איקאה', 'ikea', 'אייס', 'ace', 'הום סנטר',
    'home center', 'טמבור', 'מקס סטוק', 'דואר ישראל', 'עמלה', 'דמי כרטיס', 'עמלת',
  ],
  // income
  salary: ['משכורת', 'שכר', 'salary', 'משכורות'],
  'other-income': ['החזר', 'זיכוי', 'ריבית', 'קצבה', 'קצבת', 'ביטוח לאומי', 'דיבידנד', 'מענק', 'הפקדה'],
};

/** Bump when keywords are added above, so existing installs receive them. */
export const RULES_VERSION = 4;

/** Built-in rules that turned out too broad ("מגדל" caught "קפה מגדל דוד"); removed on upgrade. */
export const REMOVED_RULE_IDS = ['r-insurance-הראל', 'r-insurance-מגדל', 'r-insurance-מנורה', 'r-insurance-איילון',
  'r-insurance-הכשרה', 'r-fuel-אלון'];

export const DEFAULT_RULES = Object.entries(RULES_BY_CATEGORY).flatMap(([categoryId, keywords]) =>
  [...new Set(keywords.map((k) => k.toLowerCase()))].map((keyword) => ({
    id: `r-${categoryId}-${keyword}`,
    keyword,
    categoryId,
  }))
);

/** Lines in the checking account that are the monthly card bill (detail comes from the card screenshot). */
export const DEFAULT_CARD_KEYWORDS = [
  'דיסקונט כרטיסים', 'כרטיסי אשראי', 'כרטיס אשראי', 'כאל', 'cal', 'מקס איט', 'max', 'מקס', 'ישראכרט',
  'אמריקן אקספרס', 'אמקס', 'amex', 'לאומי קארד', 'דיינרס', 'diners', 'ויזה', 'visa', 'מסטרקארד',
];
