import {
  addDays,
  addMonths,
  daysBetween,
  daysInYear,
  type IsoDate,
  parseDate,
  formatDateRu,
} from '../date/date.js';
import { D, type Dec, type Kop, formatRub, rateToFraction, roundKop } from '../money/money.js';
import { annuityPayment, remainingPayments } from './math.js';
import type {
  LoanInput,
  LoanSchedule,
  PrepaymentInput,
  PrepaymentMode,
  ScheduleRow,
  ScheduleWarning,
} from './types.js';

interface RatePoint {
  fromDate: IsoDate;
  rate: string;
}

function buildRateTimeline(loan: LoanInput): RatePoint[] {
  const changes = [...(loan.rateChanges ?? [])].sort((a, b) => (a.fromDate < b.fromDate ? -1 : 1));
  return [{ fromDate: '0000-01-01', rate: loan.annualRate }, ...changes.map((c) => ({ fromDate: c.fromDate, rate: c.annualRate }))];
}

function rateAt(timeline: RatePoint[], date: IsoDate): string {
  let rate = timeline[0]!.rate;
  for (const p of timeline) {
    if (p.fromDate <= date) rate = p.rate;
    else break;
  }
  return rate;
}

export function paymentDate(loan: LoanInput, index: number): IsoDate {
  const day = loan.paymentDay ?? parseDate(loan.issueDate).d;
  return addMonths(loan.issueDate, index, day);
}

/**
 * Проценты за отрезок [from, to) при постоянном остатке.
 * Отрезок делится по датам смены ставки и границам года (для ежедневного режима важна длина года).
 */
function accrue(
  timeline: RatePoint[],
  mode: 'monthly' | 'daily',
  balanceKop: Kop,
  from: IsoDate,
  to: IsoDate,
  periodDays: number,
): Dec {
  if (balanceKop <= 0 || from >= to) return new D(0);
  const cuts = new Set<IsoDate>([from, to]);
  for (const p of timeline) if (p.fromDate > from && p.fromDate < to) cuts.add(p.fromDate);
  if (mode === 'daily') {
    for (let y = parseDate(from).y + 1; y <= parseDate(to).y; y++) {
      const jan1 = `${String(y).padStart(4, '0')}-01-01`;
      if (jan1 > from && jan1 < to) cuts.add(jan1);
    }
  }
  const points = [...cuts].sort();
  let total = new D(0);
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k]!;
    const b = points[k + 1]!;
    const days = daysBetween(a, b);
    const r = rateToFraction(rateAt(timeline, a));
    if (mode === 'daily') {
      total = total.plus(new D(balanceKop).mul(r).mul(days).div(daysInYear(parseDate(a).y)));
    } else {
      total = total.plus(new D(balanceKop).mul(r).div(12).mul(days).div(periodDays));
    }
  }
  return total;
}

interface PendingPrepayment {
  id: string;
  date: IsoDate;
  amountKop: Kop;
  mode: PrepaymentMode;
}

/**
 * Строит полный график платежей с учётом смены ставки и досрочных погашений.
 *
 * Упрощения (зафиксированы в тестах):
 * - досрочка между датами платежей целиком идёт в основной долг, проценты за дни до неё
 *   остаются в ближайшем обязательном платеже;
 * - при закрытии кредита досрочкой между датами нужно внести остаток + проценты за прошедшие дни;
 * - новая ставка меняет размер платежа с ближайшей даты платежа, проценты по новой ставке считаются с даты смены.
 */
export function buildSchedule(loan: LoanInput, prepayments: readonly PrepaymentInput[] = []): LoanSchedule {
  if (!Number.isSafeInteger(loan.principalKop) || loan.principalKop <= 0) {
    throw new RangeError('principalKop must be a positive integer');
  }
  if (!Number.isInteger(loan.termMonths) || loan.termMonths <= 0) {
    throw new RangeError('termMonths must be a positive integer');
  }
  const mode = loan.interestMode ?? 'monthly';
  const timeline = buildRateTimeline(loan);
  const rules = loan.bankRules;
  const warnings: ScheduleWarning[] = [];
  const rows: ScheduleRow[] = [];

  const own = prepayments.filter((p) => p.loanId === loan.id && p.amountKop > 0);
  const oneOffs: PendingPrepayment[] = [];
  for (const p of own) {
    if (p.kind !== 'one_off' || !p.date) continue;
    if (p.date <= loan.issueDate) {
      warnings.push({ code: 'before_issue', date: p.date, prepaymentId: p.id, message: 'Досрочный платёж раньше выдачи кредита не учитывается.' });
      continue;
    }
    if (rules && rules.minAmountKop > 0 && p.amountKop < rules.minAmountKop) {
      warnings.push({
        code: 'below_minimum',
        date: p.date,
        prepaymentId: p.id,
        message: `Банк принимает досрочку от ${formatRub(rules.minAmountKop)}. Платёж ${formatRub(p.amountKop)} не учтён.`,
      });
      continue;
    }
    oneOffs.push({ id: p.id, date: p.date, amountKop: p.amountKop, mode: p.mode });
  }
  oneOffs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const monthly = own.filter((p) => p.kind === 'monthly');

  let balance = loan.principalKop;
  let remaining = loan.termMonths;
  let rateForPayment = rateAt(timeline, addDays(loan.issueDate, 1));
  let payment = annuityPayment(balance, rateForPayment, remaining);
  let principalPart = roundKop(new D(balance).div(remaining));
  let keepTarget: Kop | null = null;
  let lastDue: Kop = loan.type === 'annuity' ? payment : 0;
  let accrued = new D(0);
  let lastAccrual = loan.issueDate;
  let periodStart = loan.issueDate;
  let totalInterest = 0;
  let totalPrepaid = 0;
  let oneOffCursor = 0;
  let closed = false;

  const recalcAfterPrepayment = (m: PrepaymentMode) => {
    if (balance <= 0) return;
    if (loan.type === 'annuity') {
      if (m === 'reduce_term') {
        const n = remainingPayments(balance, rateForPayment, payment);
        if (n !== null) remaining = Math.min(remaining, n);
      } else {
        if (m === 'reduce_payment_keep_amount' && keepTarget === null) keepTarget = payment;
        payment = annuityPayment(balance, rateForPayment, remaining);
      }
    } else {
      if (m === 'reduce_term') {
        remaining = Math.min(remaining, Math.max(1, Math.ceil(balance / principalPart)));
      } else {
        if (m === 'reduce_payment_keep_amount' && keepTarget === null) keepTarget = lastDue;
        principalPart = roundKop(new D(balance).div(remaining));
      }
    }
  };

  const maxPeriods = loan.termMonths * 3 + 12;
  for (let index = 1; index <= maxPeriods && !closed; index++) {
    const periodEnd = paymentDate(loan, index);
    const periodDays = Math.max(1, daysBetween(periodStart, periodEnd));

    // 1. Разовые досрочки внутри периода (строго между датами платежей)
    const onDate: PendingPrepayment[] = [];
    while (oneOffCursor < oneOffs.length && oneOffs[oneOffCursor]!.date <= periodEnd) {
      const p = oneOffs[oneOffCursor++]!;
      if (p.date === periodEnd) {
        onDate.push(p);
        continue;
      }
      if (rules?.onlyOnPaymentDate) {
        warnings.push({
          code: 'moved_to_payment_date',
          date: p.date,
          prepaymentId: p.id,
          message: `Банк принимает досрочку только в дату платежа: платёж перенесён на ${formatDateRu(periodEnd)}.`,
        });
        onDate.push({ ...p, date: periodEnd });
        continue;
      }
      accrued = accrued.plus(accrue(timeline, mode, balance, lastAccrual, p.date, periodDays));
      lastAccrual = p.date;
      const accruedKop = roundKop(accrued);
      if (p.amountKop >= balance + accruedKop) {
        if (p.amountKop > balance + accruedKop) {
          warnings.push({
            code: 'exceeds_balance',
            date: p.date,
            prepaymentId: p.id,
            message: `Для полного закрытия достаточно ${formatRub(balance + accruedKop)}.`,
          });
        }
        rows.push(row('prepayment', index, p.date, 0, accruedKop, 0, balance, 0, 0, rateAt(timeline, p.date), [p.id]));
        totalInterest += accruedKop;
        totalPrepaid += balance;
        balance = 0;
        closed = true;
        break;
      }
      balance -= p.amountKop;
      totalPrepaid += p.amountKop;
      rows.push(row('prepayment', index, p.date, 0, 0, 0, p.amountKop, 0, balance, rateAt(timeline, p.date), [p.id]));
      recalcAfterPrepayment(p.mode);
    }
    if (closed) break;

    // 2. Обязательный платёж
    accrued = accrued.plus(accrue(timeline, mode, balance, lastAccrual, periodEnd, periodDays));
    const interest = roundKop(accrued);
    accrued = new D(0);
    lastAccrual = periodEnd;
    let principal: Kop;
    let due: Kop;
    if (loan.type === 'annuity') {
      due = payment;
      if (remaining <= 1 || due >= balance + interest) {
        principal = balance;
        due = balance + interest;
      } else {
        principal = due - interest;
        if (principal < 0) {
          warnings.push({
            code: 'interest_exceeds_payment',
            date: periodEnd,
            message: 'Платёж не покрывает начисленные проценты.',
          });
          principal = 0;
          due = interest;
        }
      }
    } else {
      principal = remaining <= 1 ? balance : Math.min(principalPart, balance);
      due = principal + interest;
    }
    balance -= principal;
    remaining -= 1;
    totalInterest += interest;
    lastDue = due;

    // 3. Досрочки в дату платежа: разовые и ежемесячные
    let prepaidToday = 0;
    let keepExtra = 0;
    const ids: string[] = [];
    const todays: PendingPrepayment[] = [...onDate];
    for (const m of monthly) {
      const start = m.startDate ?? loan.issueDate;
      if (periodEnd < start || (m.endDate && periodEnd > m.endDate)) continue;
      if (rules && rules.minAmountKop > 0 && m.amountKop < rules.minAmountKop) {
        if (!warnings.some((w) => w.prepaymentId === m.id && w.code === 'below_minimum')) {
          warnings.push({
            code: 'below_minimum',
            date: periodEnd,
            prepaymentId: m.id,
            message: `Банк принимает досрочку от ${formatRub(rules.minAmountKop)}. Ежемесячная доплата ${formatRub(m.amountKop)} не учтена.`,
          });
        }
        continue;
      }
      todays.push({ id: m.id, date: periodEnd, amountKop: m.amountKop, mode: m.mode });
    }
    for (const p of todays) {
      if (balance <= 0) {
        warnings.push({ code: 'after_payoff', date: p.date, prepaymentId: p.id, message: 'Кредит к этой дате уже погашен.' });
        continue;
      }
      let amt = p.amountKop;
      if (amt > balance) {
        warnings.push({
          code: 'exceeds_balance',
          date: p.date,
          prepaymentId: p.id,
          message: `Остаток долга ${formatRub(balance)} — больше внести нельзя.`,
        });
        amt = balance;
      }
      balance -= amt;
      prepaidToday += amt;
      ids.push(p.id);
      recalcAfterPrepayment(p.mode);
    }
    if (keepTarget !== null && balance > 0 && remaining > 0) {
      const extra = Math.min(Math.max(0, keepTarget - due), balance);
      if (extra > 0) {
        balance -= extra;
        prepaidToday += extra;
        keepExtra = extra;
        recalcAfterPrepayment('reduce_payment');
      }
    }
    totalPrepaid += prepaidToday;
    rows.push(row('payment', index, periodEnd, due, interest, principal, prepaidToday, keepExtra, balance, rateAt(timeline, periodEnd), ids));

    if (balance <= 0) {
      closed = true;
      break;
    }

    // 4. Смена ставки: новый платёж с ближайшего периода
    const nextRate = rateAt(timeline, addDays(periodEnd, 1));
    if (nextRate !== rateForPayment) {
      rateForPayment = nextRate;
      if (loan.type === 'annuity') payment = annuityPayment(balance, rateForPayment, Math.max(1, remaining));
    }
    if (remaining <= 0) remaining = 1;
    periodStart = periodEnd;
  }

  for (let k = oneOffCursor; k < oneOffs.length; k++) {
    const p = oneOffs[k]!;
    warnings.push({ code: 'after_payoff', date: p.date, prepaymentId: p.id, message: 'Кредит к этой дате уже погашен.' });
  }

  const payments = rows.filter((r) => r.kind === 'payment');
  const last = rows[rows.length - 1]!;
  return {
    loanId: loan.id,
    rows,
    warnings,
    summary: {
      totalInterestKop: totalInterest,
      totalPrepaidKop: totalPrepaid,
      totalPaidKop: loan.principalKop + totalInterest,
      payoffDate: last.date,
      paymentsCount: payments.length,
      firstPaymentKop: payments[0]?.paymentKop ?? 0,
      maxPaymentKop: payments.reduce((m, r) => Math.max(m, r.paymentKop), 0),
    },
  };
}

function row(
  kind: ScheduleRow['kind'],
  index: number,
  date: IsoDate,
  paymentKop: Kop,
  interestKop: Kop,
  principalKop: Kop,
  prepaymentKop: Kop,
  keepExtraKop: Kop,
  balanceKop: Kop,
  annualRate: string,
  prepaymentIds: string[],
): ScheduleRow {
  return { kind, index, date, paymentKop, interestKop, principalKop, prepaymentKop, keepExtraKop, balanceKop, annualRate, prepaymentIds };
}

/** Обязательный платёж, который действует на дату (по ближайшей будущей строке графика). */
export function paymentDueOnOrAfter(schedule: LoanSchedule, date: IsoDate): ScheduleRow | undefined {
  return schedule.rows.find((r) => r.kind === 'payment' && r.date >= date);
}

/** Остаток долга на дату. */
export function balanceAt(schedule: LoanSchedule, principalKop: Kop, date: IsoDate): Kop {
  let balance = principalKop;
  for (const r of schedule.rows) {
    if (r.date > date) break;
    balance = r.balanceKop;
  }
  return balance;
}
