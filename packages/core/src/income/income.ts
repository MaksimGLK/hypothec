import {
  addMonths,
  type IsoDate,
  maxDate,
  minDate,
  monthsBetween,
  parseDate,
  startOfMonth,
  withDay,
} from '../date/date.js';
import type { Kop } from '../money/money.js';

export type IncomeType =
  | 'salary'
  | 'advance'
  | 'bonus'
  | 'self_employed'
  | 'rent'
  | 'one_off'
  | 'tax_refund'
  | 'gift'
  | 'property_sale'
  | 'other';

export type Periodicity = 'monthly' | 'quarterly' | 'yearly' | 'once';

/**
 * - `stable` — приходит регулярно и предсказуемо (зарплата);
 * - `unstable` — приходит, но сумма или факт не гарантированы (премия, подработка);
 * - `expected` — ещё не начал приходить (будущая аренда, вычет, продажа квартиры).
 * Нестабильные и ожидаемые деньги по умолчанию не идут на ипотеку — только на цели.
 */
export type Reliability = 'stable' | 'unstable' | 'expected';

export interface IncomeInput {
  id: string;
  name: string;
  type: IncomeType;
  amountKop: Kop;
  periodicity: Periodicity;
  /** День поступления в месяце (для ежемесячных). */
  dayOfMonth?: number;
  /** Дата разового поступления или первая дата для квартальных/годовых. */
  date?: IsoDate;
  startDate?: IsoDate;
  endDate?: IsoDate;
  reliability: Reliability;
  memberId?: string;
  /** Доход начинается с даты получения ключей (например, аренда после переезда). */
  startsAtKeys?: boolean;
  /** Доход заканчивается в дату получения ключей. */
  endsAtKeys?: boolean;
  /** Прежняя сумма и дата изменения — для рекомендации «доход вырос». */
  previousAmountKop?: Kop;
  changedAt?: IsoDate;
}

export interface IncomeEvent {
  incomeId: string;
  name: string;
  type: IncomeType;
  date: IsoDate;
  amountKop: Kop;
  reliability: Reliability;
}

export interface IncomeContext {
  keysDate?: IsoDate | null;
}

export function effectiveIncomeWindow(income: IncomeInput, ctx: IncomeContext = {}): { start: IsoDate | null; end: IsoDate | null } {
  let start = income.startDate ?? null;
  let end = income.endDate ?? null;
  if (income.startsAtKeys && ctx.keysDate) start = start ? maxDate(start, ctx.keysDate) : ctx.keysDate;
  if (income.endsAtKeys && ctx.keysDate) end = end ? minDate(end, ctx.keysDate) : ctx.keysDate;
  return { start, end };
}

/** Все поступления в интервале [from, to] по датам. */
export function expandIncomes(incomes: readonly IncomeInput[], from: IsoDate, to: IsoDate, ctx: IncomeContext = {}): IncomeEvent[] {
  const events: IncomeEvent[] = [];
  for (const inc of incomes) {
    if (inc.amountKop <= 0) continue;
    const { start, end } = effectiveIncomeWindow(inc, ctx);
    const lo = start ? maxDate(from, start) : from;
    const hi = end ? minDate(to, end) : to;
    if (lo > hi) continue;
    const push = (date: IsoDate) => {
      if (date >= lo && date <= hi) {
        events.push({ incomeId: inc.id, name: inc.name, type: inc.type, date, amountKop: inc.amountKop, reliability: inc.reliability });
      }
    };
    switch (inc.periodicity) {
      case 'once':
        if (inc.date) push(inc.date);
        break;
      case 'monthly': {
        const day = inc.dayOfMonth ?? (inc.startDate ? parseDate(inc.startDate).d : 1);
        const n = monthsBetween(lo, hi);
        for (let k = 0; k <= n; k++) push(withDay(addMonths(startOfMonth(lo), k), day));
        break;
      }
      case 'quarterly':
      case 'yearly': {
        const step = inc.periodicity === 'quarterly' ? 3 : 12;
        const anchor = inc.date ?? inc.startDate ?? lo;
        const day = parseDate(anchor).d;
        let k = Math.max(0, Math.floor(monthsBetween(anchor, lo) / step) - 1);
        for (;; k++) {
          const d = addMonths(anchor, k * step, day);
          if (d > hi) break;
          push(d);
        }
        break;
      }
    }
  }
  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.incomeId < b.incomeId ? -1 : 1));
}

/** Средний доход в месяц (для стабильных — на ипотеку и подушку). */
export function monthlyEquivalent(income: IncomeInput): Kop {
  switch (income.periodicity) {
    case 'monthly':
      return income.amountKop;
    case 'quarterly':
      return Math.round(income.amountKop / 3);
    case 'yearly':
      return Math.round(income.amountKop / 12);
    case 'once':
      return 0;
  }
}

export function isActiveOn(income: IncomeInput, date: IsoDate, ctx: IncomeContext = {}): boolean {
  const { start, end } = effectiveIncomeWindow(income, ctx);
  if (income.periodicity === 'once') return false;
  return (!start || start <= date) && (!end || end >= date);
}

/** Сумма стабильного дохода в месяц на дату. */
export function stableMonthlyIncome(incomes: readonly IncomeInput[], date: IsoDate, ctx: IncomeContext = {}): Kop {
  return incomes
    .filter((i) => i.reliability === 'stable' && isActiveOn(i, date, ctx))
    .reduce((s, i) => s + monthlyEquivalent(i), 0);
}

export function defaultReliability(type: IncomeType): Reliability {
  switch (type) {
    case 'salary':
    case 'advance':
    case 'rent':
      return 'stable';
    case 'bonus':
    case 'self_employed':
    case 'other':
      return 'unstable';
    default:
      return 'expected';
  }
}

export const INCOME_TYPE_LABELS: Record<IncomeType, string> = {
  salary: 'Зарплата',
  advance: 'Аванс',
  bonus: 'Премия',
  self_employed: 'Самозанятость',
  rent: 'Сдача квартиры',
  one_off: 'Разовое поступление',
  tax_refund: 'Налоговый вычет',
  gift: 'Подарок',
  property_sale: 'Продажа квартиры',
  other: 'Другой доход',
};
