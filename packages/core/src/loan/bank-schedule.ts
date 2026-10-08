import { daysBetween, type IsoDate, formatDate } from '../date/date.js';
import { type Kop, rub } from '../money/money.js';
import type { LoanSchedule } from './types.js';

export interface BankScheduleRow {
  date: IsoDate;
  paymentKop: Kop;
  interestKop: Kop | null;
  principalKop: Kop | null;
  balanceKop: Kop | null;
}

export interface CsvParseResult {
  rows: BankScheduleRow[];
  errors: { line: number; message: string }[];
}

const HEADER_ALIASES: Record<keyof BankScheduleRow, RegExp> = {
  date: /^(дата|date|дата платежа|дата погашения)/i,
  paymentKop: /^(сумма платежа|платеж|платёж|ежемесячный платеж|ежемесячный платёж|итого|payment|сумма)/i,
  interestKop: /(процент|interest)/i,
  principalKop: /(основн|тело|principal|погашение долга)/i,
  balanceKop: /(остаток|balance)/i,
};

function detectDelimiter(line: string): string {
  const counts = [';', '\t', ','].map((d) => ({ d, n: line.split(d).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.d;
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delim && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** «1 234 567,89», «1234567.89», «172 805,20 ₽» → копейки. */
export function parseMoneyCell(cell: string): Kop | null {
  const cleaned = cell
    .replace(/руб\.?|₽/gi, '')
    .replace(/[\s ]/g, '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.$/, '');
  if (!cleaned) return null;
  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.');
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return rub(n);
}

/** «15.03.2027», «2027-03-15», «15/03/2027» → ISO. */
export function parseDateCell(cell: string): IsoDate | null {
  const s = cell.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return formatDate({ y, m: Number(m[2]), d: Number(m[1]) });
  }
  return null;
}

/** Разбор CSV-графика из банка. Колонки определяются по заголовкам. */
export function parseBankScheduleCsv(text: string): CsvParseResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const errors: CsvParseResult['errors'] = [];
  const headerIdx = lines.findIndex((l) => /дата|date/i.test(l));
  if (headerIdx < 0) return { rows: [], errors: [{ line: 1, message: 'Не нашли строку заголовков с колонкой «Дата».' }] };
  const delim = detectDelimiter(lines[headerIdx]!);
  const headers = splitCsvLine(lines[headerIdx]!, delim);
  const col: Partial<Record<keyof BankScheduleRow, number>> = {};
  headers.forEach((h, i) => {
    for (const key of Object.keys(HEADER_ALIASES) as (keyof BankScheduleRow)[]) {
      if (col[key] === undefined && HEADER_ALIASES[key].test(h)) {
        col[key] = i;
        break;
      }
    }
  });
  if (col.date === undefined || col.paymentKop === undefined) {
    return { rows: [], errors: [{ line: headerIdx + 1, message: 'Нужны колонки «Дата» и «Сумма платежа».' }] };
  }
  const rows: BankScheduleRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const cells = splitCsvLine(line, delim);
    const date = parseDateCell(cells[col.date] ?? '');
    const payment = parseMoneyCell(cells[col.paymentKop] ?? '');
    if (!date || payment === null) {
      errors.push({ line: i + 1, message: 'Не удалось прочитать дату или сумму.' });
      continue;
    }
    const pick = (k: keyof BankScheduleRow) => (col[k] === undefined ? null : parseMoneyCell(cells[col[k]!] ?? ''));
    rows.push({ date, paymentKop: payment, interestKop: pick('interestKop'), principalKop: pick('principalKop'), balanceKop: pick('balanceKop') });
  }
  return { rows, errors };
}

export interface ReconcileItem {
  bank: BankScheduleRow;
  calculatedDate: IsoDate | null;
  paymentDiffKop: Kop | null;
  interestDiffKop: Kop | null;
  balanceDiffKop: Kop | null;
  ok: boolean;
}

export interface ReconcileResult {
  items: ReconcileItem[];
  matched: number;
  mismatched: number;
  /** Подсказка, если расхождения системные (например, банк считает проценты по дням). */
  hint: string | null;
}

/**
 * Сверка графика банка с расчётным. Строки сопоставляются по ближайшей дате (±5 дней),
 * расхождение до `toleranceKop` (по умолчанию 1 ₽) считается совпадением.
 */
export function reconcileWithBank(bank: readonly BankScheduleRow[], calculated: LoanSchedule, toleranceKop: Kop = 100): ReconcileResult {
  const payments = calculated.rows.filter((r) => r.kind === 'payment');
  let cursor = 0;
  const items: ReconcileItem[] = bank.map((b) => {
    let best: (typeof payments)[number] | undefined;
    let bestGap = Infinity;
    for (let k = cursor; k < payments.length; k++) {
      const gap = Math.abs(daysBetween(b.date, payments[k]!.date));
      if (gap < bestGap) {
        bestGap = gap;
        best = payments[k];
        cursor = k;
      }
      if (payments[k]!.date > b.date && gap > bestGap) break;
    }
    if (!best || bestGap > 5) {
      return { bank: b, calculatedDate: null, paymentDiffKop: null, interestDiffKop: null, balanceDiffKop: null, ok: false };
    }
    const paymentDiff = b.paymentKop - best.paymentKop;
    const interestDiff = b.interestKop === null ? null : b.interestKop - best.interestKop;
    const balanceDiff = b.balanceKop === null ? null : b.balanceKop - best.balanceKop;
    const ok = [paymentDiff, interestDiff, balanceDiff].every((d) => d === null || Math.abs(d) <= toleranceKop);
    return { bank: b, calculatedDate: best.date, paymentDiffKop: paymentDiff, interestDiffKop: interestDiff, balanceDiffKop: balanceDiff, ok };
  });
  const mismatched = items.filter((i) => !i.ok).length;
  const interestOnlyMismatch =
    mismatched > 0 &&
    items.filter((i) => !i.ok).every((i) => i.paymentDiffKop !== null && Math.abs(i.paymentDiffKop) <= toleranceKop);
  return {
    items,
    matched: items.length - mismatched,
    mismatched,
    hint: interestOnlyMismatch
      ? 'Платёж совпадает, а проценты различаются: похоже, банк начисляет проценты по фактическим дням. Попробуйте в настройках кредита режим «по дням».'
      : null,
  };
}
