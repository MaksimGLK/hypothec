import type { BankId } from './statement.js';

/**
 * PDF-выписка → таблица строк для parseStatement.
 *
 * В PDF нет таблицы — есть только кусочки текста с координатами. Столбцы у банков разные и часто
 * переносятся на несколько строк, поэтому разбор не опирается на сетку: операция начинается со строки,
 * которая открывается датой, и продолжается следующими строками до новой даты. Внутри операции
 * находим сумму, а всё, что не дата, не время, не сумма и не номер карты, — описание.
 */

export interface PdfTextItem {
  page: number;
  /** Левый край, в единицах PDF. */
  x: number;
  /** Расстояние от верха страницы (растёт вниз). */
  y: number;
  /** Ширина текста — чтобы склеивать соседние кусочки в одну ячейку. */
  width?: number;
  str: string;
}

export interface PdfLine {
  page: number;
  y: number;
  cells: string[];
}

export interface PdfStatementResult {
  bank: BankId;
  /** Первая строка — заголовок «Дата операции; Сумма операции; Описание операции». */
  rows: string[][];
  /** Сколько строк с датой не удалось превратить в операцию (нет суммы). */
  skipped: number;
}

const LINE_TOLERANCE = 2.5;
const CELL_GAP = 6;

/** Собрать кусочки текста в строки (по высоте) и ячейки (по промежуткам между словами). */
export function pdfItemsToLines(items: readonly PdfTextItem[]): PdfLine[] {
  const sorted = items.filter((i) => i.str.trim() !== '').sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const lines: { page: number; y: number; items: PdfTextItem[] }[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= LINE_TOLERANCE) last.items.push(it);
    else lines.push({ page: it.page, y: it.y, items: [it] });
  }
  return lines.map((l) => {
    const row = [...l.items].sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    let prevEnd: number | null = null;
    for (const it of row) {
      const gap = prevEnd === null || it.width === undefined ? Infinity : it.x - prevEnd;
      if (cells.length && gap <= CELL_GAP) {
        const joiner = gap > 0.8 && !cells[cells.length - 1]!.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '';
        cells[cells.length - 1] += joiner + it.str;
      } else cells.push(it.str);
      prevEnd = it.width === undefined ? null : it.x + it.width;
    }
    return { page: l.page, y: l.y, cells: cells.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean) };
  });
}

const DATE_START = /^(\d{2})\.(\d{2})\.(\d{4}|\d{2})(?!\d)/;
const DATE_ANY = /\b\d{2}\.\d{2}\.(?:\d{4}|\d{2})\b/g;
const TIME_ANY = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const MONEY_CELL = /^([+\-−–]?)\s?(\d{1,3}(?:[\s ]\d{3})*|\d+)[.,]\d{2}\s*(?:₽|RUB|RUR|руб\.?)?$/i;
const MONEY_IN_TEXT = /([+\-−–])\s?(?:\d{1,3}(?:[\s ]\d{3})+|\d+)[.,]\d{2}(?:\s*(?:₽|RUB|RUR|руб\.?))?|(?:\d{1,3}(?:[\s ]\d{3})+|\d+)[.,]\d{2}\s*(?:₽|RUB|RUR|руб\.?)/gi;
const CARD = /\b\d{4}\s?\d{0,2}[*xх]{2,}[\s*xх]*\d{4}\b|\*{1,4}\s?\d{4}\b|\b\d{6}[*xх]{4,}\d{4}\b/gi;
const NOISE_DESCRIPTION = /остаток|итого|обороты? за|баланс на|всего (поступлений|списаний|расходов|приходов)/i;
const STOP_LINE = /(пополнения|поступления|расходы|списания|всего|итого)\s*:|^(страница|стр\.)\s*\d|^\d+\s*(из|\/)\s*\d+$|^продолжение|^итого|^исходящий остаток|^остаток на/i;
const HEADER_LINE = /дата/i;
const INCOME_HINT = /зачислени|поступлени|пополнени|возврат|перевод от|заработн|зарплат|кэшб[еэ]к|проценты (на|по)|входящий перевод|refund/i;

export function detectBankFromText(text: string): BankId {
  const t = text.slice(0, 3000).toLowerCase().replace(/ё/g, 'е');
  const hits: { bank: BankId; at: number }[] = [
    { bank: 'tbank' as const, at: t.search(/(?<![а-яa-z])т[-‑]?банк|тинькофф|tinkoff|t-?bank/) },
    { bank: 'vtb' as const, at: t.search(/(?<![а-яa-z])втб(?![а-яa-z])|vtb/) },
    { bank: 'alfa' as const, at: t.search(/альфа-банк|альфа банк|alfa-?bank|альфа-?банк/) },
  ].filter((h) => h.at >= 0);
  hits.sort((a, b) => a.at - b.at);
  return hits[0]?.bank ?? 'unknown';
}

/** Сумма из ячеек операции: сначала со знаком «+»/«−», иначе первая похожая на деньги. */
function pickAmount(cells: readonly string[]): { text: string; signed: boolean } | null {
  const whole = cells.map((c) => MONEY_CELL.exec(c)).filter((m): m is RegExpExecArray => m !== null);
  const signedCell = whole.find((m) => m[1]);
  if (signedCell) return { text: signedCell[0], signed: true };
  const inText = [...cells.join('  ').matchAll(MONEY_IN_TEXT)];
  const signedText = inText.find((m) => m[1]);
  if (signedText) return { text: signedText[0], signed: true };
  if (whole[0]) return { text: whole[0][0], signed: false };
  if (inText[0]) return { text: inText[0][0], signed: false };
  return null;
}

function cleanDescription(cells: readonly string[], amountText: string): string {
  return cells
    .filter((c) => !MONEY_CELL.test(c))
    .join(' ')
    .replace(amountText, ' ')
    .replace(MONEY_IN_TEXT, ' ')
    .replace(DATE_ANY, ' ')
    .replace(TIME_ANY, ' ')
    .replace(CARD, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s|,;-]+|[\s|,;-]+$/g, '')
    .trim();
}

/** Строки PDF → таблица операций. */
export function pdfLinesToRows(lines: readonly PdfLine[], bank: BankId = 'unknown'): PdfStatementResult {
  // обычный шаг между строками на странице — чтобы не приклеивать к операции подвал страницы
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) if (lines[i]!.page === lines[i - 1]!.page) gaps.push(lines[i]!.y - lines[i - 1]!.y);
  gaps.sort((a, b) => a - b);
  const step = Math.min(20, Math.max(8, gaps[Math.floor(gaps.length / 2)] ?? 12));

  const blocks: { cells: string[] }[] = [];
  let cur: { cells: string[]; page: number; y: number } | null = null;
  for (const line of lines) {
    const first = line.cells[0] ?? '';
    const text = line.cells.join(' ');
    if (DATE_START.test(first)) {
      cur = { cells: [...line.cells], page: line.page, y: line.y };
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    const far = line.page !== cur.page || line.y - cur.y > step * 2.6;
    const header = HEADER_LINE.test(text) && /сумм/i.test(text);
    if (far || header || STOP_LINE.test(text)) {
      cur = null;
      continue;
    }
    cur.cells.push(...line.cells);
    cur.y = line.y;
  }

  const rows: string[][] = [['Дата операции', 'Сумма операции', 'Описание операции']];
  let skipped = 0;
  for (const b of blocks) {
    const date = DATE_START.exec(b.cells[0]!)![0];
    const amount = pickAmount(b.cells);
    if (!amount) {
      skipped++;
      continue;
    }
    const description = cleanDescription(b.cells, amount.text);
    if (NOISE_DESCRIPTION.test(description)) continue;
    let value = amount.text.replace(/\s*(₽|RUB|RUR|руб\.?)$/i, '').trim();
    if (!amount.signed) value = (INCOME_HINT.test(description) ? '' : '-') + value;
    rows.push([date, value.replace(/^\+/, ''), description || 'Без описания']);
  }
  return { bank, rows, skipped };
}

/** Кусочки текста PDF → таблица операций и банк. */
export function parsePdfStatement(items: readonly PdfTextItem[]): PdfStatementResult {
  const lines = pdfItemsToLines(items);
  const head = lines
    .filter((l) => l.page === 1)
    .map((l) => l.cells.join(' '))
    .join('\n');
  return pdfLinesToRows(lines, detectBankFromText(head));
}
