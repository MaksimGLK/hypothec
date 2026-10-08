import { addMonths, type IsoDate, maxDate, minDate, monthsBetween, parseDate } from '../date/date.js';
import { D, type Kop, roundKop } from '../money/money.js';

export type ExpenseCategory = 'mandatory' | 'optional' | 'after_keys';
export type Recurrence = 'once' | 'monthly' | 'yearly';

export interface ExpenseInput {
  id: string;
  name: string;
  category: ExpenseCategory;
  catalogKey?: string;
  stageId?: string;
  planKop: Kop;
  /** Фактически потрачено. Если задано — расход считается оплаченным. */
  factKop?: Kop | null;
  date?: IsoDate | null;
  recurrence: Recurrence;
  endDate?: IsoDate | null;
  /** Приоритет «после ключей»: 1 — самое нужное (кухня, кровати, свет), 3 — можно подождать. */
  priority?: 1 | 2 | 3;
  /** Страховка по ипотеке: повторяется, пока не погашен этот кредит. */
  loanId?: string | null;
  /** Сумма как процент от остатка долга на дату (страхование по ипотеке). Если задано — planKop игнорируется для будущих лет. */
  percentOfLoanBalance?: string | null;
  /** Покупка в кредит или рассрочку. */
  credit?: { annualRate: string; months: number } | null;
  /** Дата расхода привязана к получению ключей. */
  atKeys?: boolean;
}

/** Ежемесячные траты семьи (еда, коммуналка, транспорт, аренда до переезда). */
export interface LivingExpenseInput {
  id: string;
  name: string;
  amountKop: Kop;
  kind?: 'rent' | 'other';
  startDate?: IsoDate | null;
  endDate?: IsoDate | null;
  /** Например, аренда заканчивается после переезда. */
  endsAtKeys?: boolean;
  startsAtKeys?: boolean;
}

export interface ExpenseOccurrence {
  expenseId: string;
  name: string;
  category: ExpenseCategory;
  recurrence: Recurrence;
  date: IsoDate;
  amountKop: Kop;
  paid: boolean;
}

export interface ExpenseContext {
  keysDate?: IsoDate | null;
  /** Дата погашения кредита — до неё повторяется страховка. */
  loanPayoff?: Record<string, IsoDate>;
  /** Остаток долга по кредиту на дату. */
  loanBalanceAt?: (loanId: string, date: IsoDate) => Kop;
}

export function expenseDate(e: ExpenseInput, ctx: ExpenseContext): IsoDate | null {
  if (e.atKeys && ctx.keysDate) return ctx.keysDate;
  return e.date ?? null;
}

/** Все платежи по расходам в интервале [from, to]. */
export function expandExpenses(expenses: readonly ExpenseInput[], from: IsoDate, to: IsoDate, ctx: ExpenseContext = {}): ExpenseOccurrence[] {
  const out: ExpenseOccurrence[] = [];
  for (const e of expenses) {
    const first = expenseDate(e, ctx);
    if (!first) continue;
    const paid = e.factKop !== undefined && e.factKop !== null;
    if (e.recurrence === 'once') {
      if (first >= from && first <= to) {
        out.push({ expenseId: e.id, name: e.name, category: e.category, recurrence: e.recurrence, date: first, amountKop: paid ? e.factKop! : e.planKop, paid });
      }
      continue;
    }
    let end = e.endDate ?? to;
    if (e.loanId && ctx.loanPayoff?.[e.loanId]) end = minDate(end, ctx.loanPayoff[e.loanId]!);
    end = minDate(end, to);
    const step = e.recurrence === 'monthly' ? 1 : 12;
    const day = parseDate(first).d;
    let k = Math.max(0, Math.floor(monthsBetween(first, maxDate(from, first)) / step) - 1);
    for (;; k++) {
      const date = addMonths(first, k * step, day);
      if (date > end) break;
      if (date < from) continue;
      let amount = e.planKop;
      if (e.percentOfLoanBalance && e.loanId && ctx.loanBalanceAt) {
        amount = roundKop(new D(ctx.loanBalanceAt(e.loanId, date)).mul(e.percentOfLoanBalance).div(100));
        if (amount <= 0) continue;
      }
      // первый период может быть уже оплачен
      const isFirst = k === 0;
      out.push({
        expenseId: e.id,
        name: e.name,
        category: e.category,
        recurrence: e.recurrence,
        date,
        amountKop: isFirst && paid ? e.factKop! : amount,
        paid: isFirst && paid,
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function livingActiveOn(l: LivingExpenseInput, date: IsoDate, ctx: ExpenseContext = {}): boolean {
  let start = l.startDate ?? null;
  let end = l.endDate ?? null;
  if (l.startsAtKeys && ctx.keysDate) start = start ? maxDate(start, ctx.keysDate) : ctx.keysDate;
  if (l.endsAtKeys && ctx.keysDate) end = end ? minDate(end, ctx.keysDate) : ctx.keysDate;
  return (!start || start <= date) && (!end || end >= date);
}

/** Базовые траты семьи в месяц на дату. */
export function livingMonthlyAt(living: readonly LivingExpenseInput[], date: IsoDate, ctx: ExpenseContext = {}): Kop {
  return living.filter((l) => livingActiveOn(l, date, ctx)).reduce((s, l) => s + l.amountKop, 0);
}

export interface ExpenseTotals {
  planKop: Kop;
  factKop: Kop;
  /** Разница факт − план по оплаченным расходам (положительная — потратили больше). */
  overspendKop: Kop;
  unpaidPlanKop: Kop;
}

/** Итоги план/факт по разовым расходам (без повторов). */
export function expenseTotals(expenses: readonly ExpenseInput[], filter?: (e: ExpenseInput) => boolean): ExpenseTotals {
  let planKop = 0;
  let factKop = 0;
  let overspendKop = 0;
  let unpaidPlanKop = 0;
  for (const e of expenses) {
    if (filter && !filter(e)) continue;
    planKop += e.planKop;
    if (e.factKop !== undefined && e.factKop !== null) {
      factKop += e.factKop;
      overspendKop += e.factKop - e.planKop;
    } else unpaidPlanKop += e.planKop;
  }
  return { planKop, factKop, overspendKop, unpaidPlanKop };
}
