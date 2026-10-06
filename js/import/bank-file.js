// Import of bank / credit-card exports (Excel .xlsx/.xls or CSV) downloaded from the bank site.
// Columns are found by their header names (not by position), calibrated on Discount's
// "כרטיסי אשראי" export: כרטיס | בית עסק | תאריך עסקה | סכום העסקה | ... | פירוט | תאריך החיוב | סכום החיוב
import { parseAmount, parseDateCell, round2 } from '../format.js';

const COLS = {
  date: ['תאריך עסקה', 'תאריך העסקה', 'תאריך רכישה', 'תאריך'],
  chargeDate: ['תאריך החיוב', 'תאריך חיוב'],
  valueDate: ['יום ערך', 'תאריך ערך'],
  description: ['בית עסק', 'שם בית העסק', 'שם בית עסק', 'תיאור התנועה', 'תיאור', 'הפעולה', 'פרטים'],
  chargeAmount: ['סכום החיוב', 'סכום חיוב'],
  dealAmount: ['סכום העסקה', 'סכום עסקה'],
  signed: ['זכות/חובה', 'סכום', 'סכום בש"ח'],
  debit: ['חובה'],
  credit: ['זכות'],
  balance: ['יתרה'],
  details: ['פירוט', 'פרטים נוספים', 'הערות'],
  card: ['כרטיס'],
};

const cleanHeader = (s) => String(s ?? '').replace(/₪|\(.*?\)|["״]/g, (c) => (c === '"' || c === '״' ? '"' : ''))
  .replace(/\s+/g, ' ').trim();

/** Map header cells to roles. Exact names first, then "contains", never two roles on one column. */
function mapHeader(row) {
  const cells = row.map(cleanHeader);
  const map = {};
  const used = new Set();
  for (const exact of [true, false]) {
    for (const [role, names] of Object.entries(COLS)) {
      if (map[role] != null) continue;
      for (const name of names) {
        const i = cells.findIndex((c, idx) => !used.has(idx) && c && (exact ? c === name : c.includes(name)));
        if (i >= 0) { map[role] = i; used.add(i); break; }
      }
    }
  }
  return map;
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const map = mapHeader(rows[i]);
    const hasAmount = ['chargeAmount', 'dealAmount', 'signed', 'debit', 'credit'].some((r) => map[r] != null);
    if (map.date != null && map.description != null && hasAmount) return { index: i, map };
  }
  return null;
}

function cell(row, i) {
  return i == null ? '' : row[i];
}

function amountOf(v) {
  if (v === '' || v == null) return NaN;
  return typeof v === 'number' ? v : parseAmount(v);
}

/**
 * Parse a workbook (from SheetJS) into review rows.
 * @param {object} opts { dateMode: 'deal' | 'charge' }
 * @returns {{kind, items, total, columns}}
 */
export function parseWorkbook(wb, opts = {}) {
  const XLSX = window.XLSX;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    const header = findHeader(rows);
    if (!header) continue;
    const { map } = header;
    const before = rows.slice(0, header.index).flat().map(String).join(' ');

    const isChecking = map.chargeAmount == null && map.dealAmount == null
      && (map.debit != null || map.credit != null || map.balance != null || map.signed != null)
      && !/כרטיס/.test(before.slice(0, 40));
    const kind = isChecking ? 'checking' : 'credit';

    const items = [];
    for (const row of rows.slice(header.index + 1)) {
      const description = String(cell(row, map.description) ?? '').replace(/\s+/g, ' ').trim();
      let date = parseDateCell(cell(row, map.date));
      if (!date || !description) continue; // footer / notes / empty lines

      const details = String(cell(row, map.details) ?? '').replace(/\s+/g, ' ').trim();
      const card = String(cell(row, map.card) ?? '').trim();
      let desc = description;
      let type = 'expense';
      let refund = false;
      let amount;

      if (kind === 'credit') {
        amount = amountOf(cell(row, map.chargeAmount));
        if (!isFinite(amount)) amount = amountOf(cell(row, map.dealAmount));
        if (!isFinite(amount) || amount === 0) continue;
        refund = amount < 0;
        const chargeDate = parseDateCell(cell(row, map.chargeDate));
        const inst = details.match(/תשלום\s*(\d+)\s*מתוך\s*(\d+)/);
        if (inst) {
          // each installment is charged on its own month: use the charge date so it is counted
          // there (and is not mistaken for a duplicate of last month's installment)
          desc = `${description} (תשלום ${inst[1]}/${inst[2]})`;
          if (chargeDate) date = chargeDate;
        } else if (opts.dateMode === 'charge' && chargeDate) {
          date = chargeDate;
        }
      } else {
        if (map.debit != null || map.credit != null) {
          const debit = amountOf(cell(row, map.debit));
          const credit = amountOf(cell(row, map.credit));
          if (isFinite(debit) && debit !== 0) amount = -Math.abs(debit);
          else if (isFinite(credit) && credit !== 0) amount = Math.abs(credit);
        } else {
          amount = amountOf(cell(row, map.signed));
        }
        if (!isFinite(amount) || amount === 0) continue;
        type = amount < 0 ? 'expense' : 'income';
        if (map.valueDate != null && map.date == null) date = parseDateCell(cell(row, map.valueDate)) || date;
      }

      const noteParts = [card, /מזהה כרטיס/.test(details) || /תשלום\s*\d+\s*מתוך/.test(details) ? '' : details]
        .filter(Boolean);
      items.push({
        date,
        description: desc,
        amount: round2(Math.abs(amount)),
        type,
        refund,
        note: noteParts.join(' · '),
        confidence: 1,
      });
    }

    // "סה"כ חיוב: + ₪10112.16" in the lines above the table
    let total = null;
    const m = before.match(/סה["״]?כ\s*חיוב[^\d\-+]*([\-+])?\s*₪?\s*([\d,]+(?:\.\d+)?)/);
    if (m) total = (m[1] === '-' ? -1 : 1) * parseAmount(m[2]);

    const columns = Object.entries(map).map(([role, i]) => `${role}: ${rows[header.index][i]}`);
    return { kind, items, total, columns };
  }
  throw new Error('לא נמצאה בקובץ טבלת תנועות (שורת כותרות עם תאריך, תיאור וסכום)');
}

let loading;
function loadSheetJs() {
  if (window.XLSX) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/xlsx/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('טעינת רכיב האקסל נכשלה'));
      document.head.appendChild(s);
    });
  }
  return loading;
}

export async function parseBankFile(file, opts) {
  await loadSheetJs();
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, codepage: 1255 });
  return parseWorkbook(wb, opts);
}

export function isSpreadsheet(file) {
  return /\.(xlsx|xls|csv)$/i.test(file.name) || /spreadsheet|excel|csv/.test(file.type);
}
