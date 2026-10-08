import { addDays, type IsoDate } from '../date/date.js';
import type { Kop } from '../money/money.js';
import { formatRub } from '../money/money.js';
import type { Transfer } from '../allocation/allocation.js';
import type { ExpenseOccurrence } from '../expenses/expenses.js';
import type { IncomeEvent } from '../income/income.js';
import type { LoanInput, LoanSchedule, PrepaymentInput } from '../loan/types.js';
import type { TaxResult } from '../tax/tax.js';

export type CalendarEventType =
  | 'loan_payment'
  | 'income'
  | 'transfer'
  | 'stage'
  | 'insurance'
  | 'expense'
  | 'prepayment'
  | 'prepayment_notice'
  | 'tax_declaration';

export interface CalendarEvent {
  /** Стабильный идентификатор: по нему же строятся напоминания без дублей. */
  id: string;
  date: IsoDate;
  type: CalendarEventType;
  title: string;
  amountKop?: Kop;
  refId?: string;
  details?: string;
}

export interface CalendarInput {
  from: IsoDate;
  to: IsoDate;
  loans: LoanInput[];
  schedules: LoanSchedule[];
  prepayments: PrepaymentInput[];
  incomeEvents: IncomeEvent[];
  transfers: Transfer[];
  stages: { id: string; title: string; status: string; plannedDate: IsoDate | null }[];
  expenseOccurrences: ExpenseOccurrence[];
  tax: TaxResult;
}

/** Единая лента событий: платежи, поступления, переводы, этапы, страховка, досрочка, декларация. */
export function buildCalendar(input: CalendarInput): CalendarEvent[] {
  const { from, to } = input;
  const inRange = (d: IsoDate) => d >= from && d <= to;
  const events: CalendarEvent[] = [];

  for (const s of input.schedules) {
    const loan = input.loans.find((l) => l.id === s.loanId);
    for (const r of s.rows) {
      if (r.kind !== 'payment' || !inRange(r.date)) continue;
      events.push({
        id: `pay:${s.loanId}:${r.date}`,
        date: r.date,
        type: 'loan_payment',
        title: `Платёж по ипотеке${loan?.name ? ` («${loan.name}»)` : ''}`,
        amountKop: r.paymentKop + r.keepExtraKop,
        refId: s.loanId,
      });
    }
  }

  for (const p of input.prepayments) {
    if (p.kind !== 'one_off' || !p.date) continue;
    const loan = input.loans.find((l) => l.id === p.loanId);
    if (inRange(p.date)) {
      events.push({ id: `prep:${p.id}`, date: p.date, type: 'prepayment', title: 'Досрочный платёж', amountKop: p.amountKop, refId: p.id });
    }
    const notice = loan?.bankRules?.noticeDays ?? 0;
    if (notice > 0) {
      const d = addDays(p.date, -notice);
      if (inRange(d)) {
        events.push({
          id: `prep-notice:${p.id}`,
          date: d,
          type: 'prepayment_notice',
          title: 'Подать заявление на досрочку',
          details: `Банк просит подать заявление за ${notice} дн. до платежа`,
          amountKop: p.amountKop,
          refId: p.id,
        });
      }
    }
  }

  for (const e of input.incomeEvents) {
    if (!inRange(e.date)) continue;
    events.push({ id: `inc:${e.incomeId}:${e.date}`, date: e.date, type: 'income', title: e.name, amountKop: e.amountKop, refId: e.incomeId });
  }

  for (const t of input.transfers) {
    if (!inRange(t.date)) continue;
    const lines = t.lines.filter((l) => l.purpose !== 'free');
    if (lines.length === 0) continue;
    events.push({
      id: `tr:${t.incomeId}:${t.date}`,
      date: t.date,
      type: 'transfer',
      title: `Разложить «${t.incomeName}» по счетам`,
      amountKop: lines.reduce((s, l) => s + l.amountKop, 0),
      details: lines.map((l) => `${formatRub(l.amountKop, { kopecks: 'never' })} → ${l.label}`).join('; '),
      refId: t.incomeId,
    });
  }

  for (const s of input.stages) {
    if (!s.plannedDate || s.status === 'done' || s.status === 'skipped' || !inRange(s.plannedDate)) continue;
    events.push({ id: `stage:${s.id}`, date: s.plannedDate, type: 'stage', title: s.title, refId: s.id });
  }

  for (const o of input.expenseOccurrences) {
    if (o.paid || !inRange(o.date)) continue;
    const isInsurance = o.recurrence === 'yearly' && /страх/i.test(o.name);
    events.push({
      id: `exp:${o.expenseId}:${o.date}`,
      date: o.date,
      type: isInsurance ? 'insurance' : 'expense',
      title: isInsurance ? `Продление: ${o.name.toLowerCase()}` : o.name,
      amountKop: o.amountKop,
      refId: o.expenseId,
    });
  }

  const claimedMembers = new Set(input.tax.members.filter((m) => m.claimed).map((m) => m.memberId));
  const years = new Set(input.tax.years.filter((y) => !claimedMembers.has(y.memberId)).map((y) => y.taxYear));
  for (const y of years) {
    const d = `${y + 1}-02-01`;
    if (!inRange(d)) continue;
    const amount = input.tax.years.filter((x) => x.taxYear === y).reduce((s, x) => s + x.propertyRefundKop + x.interestRefundKop, 0);
    events.push({
      id: `tax:${y}`,
      date: d,
      type: 'tax_declaration',
      title: `Можно подать декларацию 3-НДФЛ за ${y} год`,
      amountKop: amount,
      details: 'Справку об уплаченных процентах можно заказать в банке',
    });
  }

  const order: Record<CalendarEventType, number> = {
    prepayment_notice: 0,
    income: 1,
    transfer: 2,
    loan_payment: 3,
    prepayment: 4,
    insurance: 5,
    expense: 6,
    stage: 7,
    tax_declaration: 8,
  };
  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : order[a.type] - order[b.type]));
}
