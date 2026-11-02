import { budgetCatalogItem } from '../budget/budget.js';
import type { LivingExpenseInput } from '../expenses/expenses.js';
import { formatDate, type IsoDate } from '../date/date.js';
import { type Kop, rub } from '../money/money.js';

/**
 * Импорт банковской выписки: таблица (строки CSV или листа Excel) → операции → предложенные категории бюджета.
 * Разбор не привязан к одному формату: столбцы ищутся по названиям, банк определяется по характерным колонкам.
 */

export type BankId = 'tbank' | 'vtb' | 'alfa' | 'unknown';

export const BANK_NAMES: Record<BankId, string> = {
  tbank: 'Т-Банк',
  vtb: 'ВТБ',
  alfa: 'Альфа-Банк',
  unknown: 'Банк не определён',
};

export interface ColumnMapping {
  date: number;
  /** Сумма со знаком (минус — списание). */
  amount?: number;
  /** Отдельные колонки «приход» и «расход» (как в выписках Альфа-Банка). */
  income?: number;
  expense?: number;
  description: number;
  category?: number;
  mcc?: number;
  status?: number;
  currency?: number;
  /** Колонка «тип операции»: списание / зачисление. */
  direction?: number;
}

export type OperationKind = 'expense' | 'income' | 'transfer' | 'loan' | 'cash' | 'failed';

export interface StatementOperation {
  /** Номер строки в файле (с 1) — для сообщений об ошибках. */
  line: number;
  date: IsoDate;
  /** Сумма без знака. */
  amountKop: Kop;
  /** true — списание, false — поступление. */
  outflow: boolean;
  description: string;
  bankCategory: string | null;
  mcc: string | null;
  currency: string | null;
  kind: OperationKind;
  /** Ключ для защиты от повторной загрузки той же выписки. */
  importKey: string;
  /** Нормализованное название получателя — по нему запоминаются исправления пользователя. */
  merchantKey: string;
}

export interface StatementParseResult {
  bank: BankId;
  mapping: ColumnMapping | null;
  headerRow: number;
  header: string[];
  operations: StatementOperation[];
  errors: { line: number; message: string }[];
}

const norm = (s: unknown) =>
  String(s ?? '')
    .replace(/ /g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');

const COLUMN_HINTS: { key: keyof ColumnMapping; patterns: RegExp[] }[] = [
  { key: 'date', patterns: [/^дата операции$/, /^дата транзакции$/, /^дата и время/, /^дата$/, /^date$/, /^дата совершения/, /^дата проводки$/] },
  { key: 'amount', patterns: [/^сумма операции$/, /^сумма в валюте счета/, /^сумма пересчитанная/, /^сумма платежа$/, /^сумма$/, /^amount$/] },
  { key: 'income', patterns: [/^приход/, /^поступлени/, /^зачислени/, /^кредит$/] },
  { key: 'expense', patterns: [/^расход/, /^списани/, /^дебет$/] },
  { key: 'description', patterns: [/^описание операции$/, /^описание$/, /^основание операции$/, /^назначение платежа$/, /^детали операции$/, /^контрагент$/, /^получатель/, /^комментарий$/, /^description$/] },
  { key: 'category', patterns: [/^категория/] },
  { key: 'mcc', patterns: [/^mcc/] },
  { key: 'status', patterns: [/^статус/] },
  { key: 'currency', patterns: [/^валюта операции$/, /^валюта$/] },
  { key: 'direction', patterns: [/^тип операции$/, /^вид операции$/] },
];

/** Сопоставить заголовки колонкам. Возвращает null, если не нашлись дата, сумма и описание. */
export function detectColumns(header: readonly string[]): ColumnMapping | null {
  const h = header.map(norm);
  const found: Partial<Record<keyof ColumnMapping, number>> = {};
  for (const { key, patterns } of COLUMN_HINTS) {
    // порядок шаблонов — приоритет: «сумма операции» важнее «суммы платежа»
    for (const re of patterns) {
      const i = h.findIndex((x, idx) => re.test(x) && !Object.values(found).includes(idx));
      if (i >= 0) {
        found[key] = i;
        break;
      }
    }
  }
  if (found.date === undefined || found.description === undefined) return null;
  if (found.amount === undefined && found.income === undefined && found.expense === undefined) return null;
  return found as ColumnMapping;
}

/** Строка заголовков — первая, где нашлись дата и сумма (в выписках сверху бывает шапка с реквизитами). */
export function findHeaderRow(rows: readonly (readonly unknown[])[]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    if (detectColumns((rows[i] ?? []).map((c) => String(c ?? '')))) return i;
  }
  return -1;
}

export function detectBank(header: readonly string[]): BankId {
  const h = header.map(norm).join('|');
  if (/кэшбэк|инвесткопилк|бонусы \(включая/.test(h)) return 'tbank';
  if (/основание операции|сумма пересчитанная|дата обработки/.test(h)) return 'vtb';
  if (/референс проводки|код авторизации|тип счета/.test(h) || (/приход/.test(h) && /расход/.test(h))) return 'alfa';
  return 'unknown';
}

/** «-1 250,00», «−1250.5», «1 250,00 ₽», «1,250.00» → копейки со знаком. */
export function parseSignedMoney(value: unknown): Kop | null {
  if (typeof value === 'number' && Number.isFinite(value)) return rub(value);
  let s = String(value ?? '')
    .replace(/[ \s]/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/руб\.?|₽|rub|rur/gi, '');
  if (!s || !/\d/.test(s)) return null;
  const negative = s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'));
  s = s.replace(/[^\d,.]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return rub(negative ? -n : n);
}

/** «05.10.2026 14:23:11», «05.10.26», «2026-10-05», объект Date из Excel → ISO-дата. */
export function parseStatementDate(value: unknown): IsoDate | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDate({ y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() });
  }
  const s = String(value ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?:[ ,T]|$)/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const mo = Number(m[2]);
    const d = Number(m[1]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return formatDate({ y, m: mo, d });
  }
  return null;
}

/** Нормализованное имя получателя: без номеров карт, городов, кодов и знаков — по нему узнаются повторяющиеся траты. */
export function merchantKey(description: string): string {
  return norm(description)
    .replace(/\b(rus|ru|russia|moscow|moskva|g\.?\s?moskva|spb|sankt-peterburg|россия|москва)\b/g, ' ')
    .replace(/[*#№"'«»()[\],.:;/\\|+_-]+/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

const TRANSFER_RE = /перевод (между|себе|на свой|со своего)|между (своими )?счетами|пополнение (вклада|накопительного|счета|копилки|инвесткопилки)|инвесткопилк|на накопительный|с накопительного|внутренний перевод|перевод собственных средств|сбп себе/;
const LOAN_RE = /погашение (кредита|ипотеки|задолженности по кредиту)|ипотек|платеж по кредиту|оплата кредита/;
const CASH_RE = /снятие наличных|выдача наличных|банкомат|atm/;
const FAILED_RE = /^(failed|отклонен|отклонена|отменен|отменена|ошибка|не исполнен)/;
const BANK_TRANSFER_CATEGORIES = /^(переводы|перевод|пополнения|пополнение|между счетами|инвестиции|вклады)$/;
const TRANSFER_MCC = new Set(['4829', '6012', '6050', '6051', '6211', '6540', '6536', '6537', '6538']);

export function classifyOperation(op: Pick<StatementOperation, 'description' | 'bankCategory' | 'mcc' | 'outflow'>, status?: string | null): OperationKind {
  const d = norm(op.description);
  const c = norm(op.bankCategory);
  if (status && FAILED_RE.test(norm(status))) return 'failed';
  // «Пополнения» у банка — это и зарплата, и перевод себе; для поступлений решаем по описанию
  const bankSaysTransfer = BANK_TRANSFER_CATEGORIES.test(c) && (op.outflow || !/пополнени/.test(c));
  if (TRANSFER_RE.test(d) || bankSaysTransfer || (op.mcc && TRANSFER_MCC.has(op.mcc) && TRANSFER_RE.test(d))) return 'transfer';
  if (LOAN_RE.test(d)) return 'loan';
  if (CASH_RE.test(d) || op.mcc === '6011') return 'cash';
  return op.outflow ? 'expense' : 'income';
}

/** Разобрать таблицу выписки. mapping можно передать вручную, если столбцы не определились. */
export function parseStatement(rows: readonly (readonly unknown[])[], manual?: { headerRow: number; mapping: ColumnMapping }): StatementParseResult {
  const headerRow = manual?.headerRow ?? findHeaderRow(rows);
  const header = headerRow >= 0 ? (rows[headerRow] ?? []).map((c) => String(c ?? '').trim()) : [];
  const mapping = manual?.mapping ?? (headerRow >= 0 ? detectColumns(header) : null);
  const bank = detectBank(header);
  if (!mapping) return { bank, mapping: null, headerRow, header, operations: [], errors: [{ line: Math.max(1, headerRow + 1), message: 'Не нашли столбцы с датой, суммой и описанием' }] };

  const operations: StatementOperation[] = [];
  const errors: StatementParseResult['errors'] = [];
  const seen = new Map<string, number>();
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every((c) => String(c ?? '').trim() === '')) continue;
    const date = parseStatementDate(r[mapping.date]);
    let signed: Kop | null = null;
    if (mapping.amount !== undefined) signed = parseSignedMoney(r[mapping.amount]);
    if ((signed === null || signed === 0) && (mapping.income !== undefined || mapping.expense !== undefined)) {
      const inc = mapping.income !== undefined ? parseSignedMoney(r[mapping.income]) : null;
      const exp = mapping.expense !== undefined ? parseSignedMoney(r[mapping.expense]) : null;
      if (exp) signed = -Math.abs(exp);
      else if (inc) signed = Math.abs(inc);
    }
    if (!date || signed === null || signed === 0) {
      // итоговые строки («Итого», «Остаток на конец») просто пропускаем
      const text = r.map((c) => norm(c)).join(' ');
      if (!/итого|остаток|оборот|всего/.test(text)) errors.push({ line: i + 1, message: 'Не удалось прочитать дату или сумму' });
      continue;
    }
    // если сумма без знака, направление — по колонке «тип операции»
    let outflow = signed < 0;
    if (mapping.direction !== undefined && signed > 0) {
      const dir = norm(r[mapping.direction]);
      if (/списан|расход|покупк|оплат|дебет/.test(dir)) outflow = true;
    }
    const description = String(r[mapping.description] ?? '').replace(/\s+/g, ' ').trim() || 'Без описания';
    const bankCategory = mapping.category !== undefined ? String(r[mapping.category] ?? '').trim() || null : null;
    const mccRaw = mapping.mcc !== undefined ? String(r[mapping.mcc] ?? '').replace(/\D/g, '') : '';
    const currency = mapping.currency !== undefined ? String(r[mapping.currency] ?? '').trim().toUpperCase() || null : null;
    const status = mapping.status !== undefined ? String(r[mapping.status] ?? '') : null;
    const amountKop = Math.abs(signed);
    const base = `${date}|${outflow ? '-' : '+'}${amountKop}|${merchantKey(description)}`;
    // одинаковые операции в один день (два кофе) различаем порядковым номером
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const op = { description, bankCategory, mcc: mccRaw.length === 4 ? mccRaw : null, outflow };
    operations.push({
      line: i + 1,
      date,
      amountKop,
      outflow,
      description,
      bankCategory,
      mcc: op.mcc,
      currency,
      kind: classifyOperation(op, status),
      importKey: `${base}|${n}`,
      merchantKey: merchantKey(description),
    });
  }
  return { bank, mapping, headerRow, header, operations, errors };
}

// ── подбор категории ──

/** Категории банков → категории справочника бюджета. */
const BANK_CATEGORY_MAP: { re: RegExp; key: string }[] = [
  { re: /супермаркет|продукт|гипермаркет/, key: 'groceries' },
  { re: /ресторан|кафе|фастфуд|фаст-фуд|доставка еды|кофейн/, key: 'cafe' },
  { re: /такси|транспорт|метро|каршеринг|ж\/д|авиабилет/, key: 'transport' },
  { re: /топливо|азс|автоуслуг|авто|парковк/, key: 'car' },
  { re: /мобильн|связь|интернет|телеком/, key: 'mobile' },
  { re: /жкх|коммунал|квартплат/, key: 'utilities' },
  { re: /аптек|медицин|здоровье|клиник/, key: 'health' },
  { re: /одежда|обувь/, key: 'clothes' },
  { re: /развлечен|кино|театр|музе|хобби|книги/, key: 'leisure' },
  { re: /образован|обучени|спорт|фитнес/, key: 'kids_activities' },
  { re: /дом и ремонт|хозтовар|бытов/, key: 'household' },
  { re: /животн|зоотовар|ветеринар/, key: 'pets' },
  { re: /подписк|цифровые товары|сервисы/, key: 'subscriptions' },
  { re: /подарк|цветы/, key: 'gifts' },
  { re: /детск/, key: 'kids_other' },
];

/** Коды MCC → категории справочника. */
const MCC_MAP: { codes: (number | [number, number])[]; key: string }[] = [
  { codes: [5411, 5422, 5441, 5451, 5462, 5499], key: 'groceries' },
  { codes: [5811, 5812, 5813, 5814], key: 'cafe' },
  { codes: [4111, 4112, 4121, 4131, 4789, 7512], key: 'transport' },
  { codes: [5541, 5542, 5172, 7523, 7531, 7538, 7542, 5533], key: 'car' },
  { codes: [4812, 4814, 4816, 4899], key: 'mobile' },
  { codes: [4900], key: 'utilities' },
  { codes: [5912, 8011, 8021, 8031, 8041, 8042, 8043, 8049, 8050, 8062, 8071, 8099], key: 'health' },
  { codes: [5611, 5621, 5631, 5641, 5651, 5655, 5661, 5681, 5691, 5699], key: 'clothes' },
  { codes: [7832, 7841, 7922, 7929, 7932, 7933, 7941, 7991, 7996, 7998, 7999, 5942, 5945], key: 'leisure' },
  { codes: [8211, 8220, 8241, 8244, 8249, 8299, 7911, 7997], key: 'kids_activities' },
  { codes: [5200, 5211, 5251, 5261, 5712, 5719, 5722, 5251], key: 'household' },
  { codes: [742, 5995], key: 'pets' },
  { codes: [5815, 5816, 5817, 5818], key: 'subscriptions' },
  { codes: [5992, 5947], key: 'gifts' },
];

function mccToKey(mcc: string | null): string | null {
  if (!mcc) return null;
  const n = Number(mcc);
  for (const m of MCC_MAP) for (const c of m.codes) if (typeof c === 'number' ? c === n : n >= c[0] && n <= c[1]) return m.key;
  return null;
}

export type SuggestionReason = 'rule' | 'keyword' | 'bank_category' | 'mcc' | 'none';

export const SUGGESTION_REASONS: Record<SuggestionReason, string> = {
  rule: 'как вы относили раньше',
  keyword: 'по названию',
  bank_category: 'по категории банка',
  mcc: 'по коду MCC',
  none: 'не определилась',
};

export interface CategorySuggestion {
  categoryId: string | null;
  reason: SuggestionReason;
}

/** Запомненное исправление: такой получатель → такая категория. */
export interface CategorizationRule {
  merchantKey: string;
  categoryId: string;
}

/**
 * Подбор категории: сначала ваши прошлые исправления, затем слова в описании (подсказки справочника),
 * затем категория банка и код MCC.
 */
export function suggestCategory(
  op: Pick<StatementOperation, 'description' | 'bankCategory' | 'mcc' | 'merchantKey'>,
  categories: readonly Pick<LivingExpenseInput, 'id' | 'name' | 'catalogKey'>[],
  rules: readonly CategorizationRule[] = [],
): CategorySuggestion {
  const rule = rules.find((r) => r.merchantKey === op.merchantKey && categories.some((c) => c.id === r.categoryId));
  if (rule) return { categoryId: rule.categoryId, reason: 'rule' };

  const text = norm(op.description);
  let best: { id: string; len: number } | null = null;
  for (const c of categories) {
    for (const word of [norm(c.name), ...(budgetCatalogItem(c.catalogKey)?.aliases ?? [])]) {
      if (word.length < 3) continue;
      const stem = word.length > 5 ? word.slice(0, -1) : word;
      if (text.includes(stem) && (!best || stem.length > best.len)) best = { id: c.id, len: stem.length };
    }
  }
  if (best) return { categoryId: best.id, reason: 'keyword' };

  const byKey = (key: string | null) => (key ? categories.find((c) => c.catalogKey === key)?.id ?? null : null);
  const bc = norm(op.bankCategory);
  if (bc) {
    for (const m of BANK_CATEGORY_MAP) {
      if (m.re.test(bc)) {
        const id = byKey(m.key) ?? (m.key === 'car' ? byKey('transport') : null);
        if (id) return { categoryId: id, reason: 'bank_category' };
      }
    }
  }
  const mk = mccToKey(op.mcc);
  const id = byKey(mk) ?? (mk === 'car' ? byKey('transport') : null);
  if (id) return { categoryId: id, reason: 'mcc' };
  return { categoryId: null, reason: 'none' };
}

/** Разбор текста CSV: разделитель «;», «,» или табуляция определяется сам, кавычки и переводы строк внутри ячеек поддерживаются. */
export function parseCsvText(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLines = clean.split(/\r?\n/).slice(0, 10).join('\n');
  const delim = [';', '\t', ','].map((d) => ({ d, n: firstLines.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}
