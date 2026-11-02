/**
 * Календарные даты без времени и часовых поясов в формате ISO `YYYY-MM-DD`.
 * Строки удобно хранить, передавать по API и сравнивать лексикографически.
 */
export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface Ymd {
  y: number;
  m: number; // 1..12
  d: number; // 1..31
}

export function parseDate(date: IsoDate): Ymd {
  const match = ISO_RE.exec(date);
  if (!match) throw new TypeError(`Invalid ISO date: ${date}`);
  const ymd = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  if (ymd.m < 1 || ymd.m > 12 || ymd.d < 1 || ymd.d > daysInMonth(ymd.y, ymd.m)) {
    throw new TypeError(`Invalid ISO date: ${date}`);
  }
  return ymd;
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
}

export function formatDate({ y, m, d }: Ymd): IsoDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInYear(y: number): number {
  return isLeapYear(y) ? 366 : 365;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

/** Номер дня от 1970-01-01 (для разницы дат). */
export function toDayNumber(date: IsoDate): number {
  const { y, m, d } = parseDate(date);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function fromDayNumber(n: number): IsoDate {
  const dt = new Date(n * 86_400_000);
  return formatDate({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Сдвиг на N месяцев; если такого дня нет (31 февраля) — последний день месяца. */
export function addMonths(date: IsoDate, months: number, preferredDay?: number): IsoDate {
  const { y, m, d } = parseDate(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(preferredDay ?? d, daysInMonth(ny, nm));
  return formatDate({ y: ny, m: nm, d: day });
}

export function addYears(date: IsoDate, years: number): IsoDate {
  return addMonths(date, years * 12);
}

/** Дата с заданным днём месяца в том же месяце (с поправкой на длину месяца). */
export function withDay(date: IsoDate, day: number): IsoDate {
  const { y, m } = parseDate(date);
  return formatDate({ y, m, d: Math.min(day, daysInMonth(y, m)) });
}

export function startOfMonth(date: IsoDate): IsoDate {
  return withDay(date, 1);
}

export function endOfMonth(date: IsoDate): IsoDate {
  const { y, m } = parseDate(date);
  return formatDate({ y, m, d: daysInMonth(y, m) });
}

/** Ключ месяца `YYYY-MM`. */
export function monthKey(date: IsoDate): string {
  return date.slice(0, 7);
}

/** Количество полных месячных шагов от a до b (по номеру месяца, без учёта дня). */
export function monthsBetween(a: IsoDate, b: IsoDate): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return (pb.y - pa.y) * 12 + (pb.m - pa.m);
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b;
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** «15 марта 2027» */
export function formatDateRu(date: IsoDate, opts: { year?: boolean } = {}): string {
  const { y, m, d } = parseDate(date);
  return `${d} ${MONTHS_GEN[m - 1]}${opts.year === false ? '' : ` ${y}`}`;
}

/** Единый числовой формат для людей: 18/11/2026. */
export function formatDateNum(date: IsoDate): string {
  const { y, m, d } = parseDate(date);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

const MONTHS_NOM = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/** «март 2027» */
export function formatMonthRu(date: IsoDate): string {
  const { y, m } = parseDate(date);
  return `${MONTHS_NOM[m - 1]} ${y}`;
}

export const MONTH_NAMES_GENITIVE = MONTHS_GEN;
