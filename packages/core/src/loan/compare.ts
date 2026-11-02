import { type IsoDate, monthsBetween } from '../date/date.js';
import type { Kop } from '../money/money.js';
import { buildSchedule } from './schedule.js';
import type { LoanInput, LoanSchedule, PrepaymentInput, PrepaymentMode } from './types.js';

export interface PrepaymentScenarioInput {
  id: string;
  name: string;
  prepayments: PrepaymentInput[];
}

export interface ScenarioResult {
  scenarioId: string;
  name: string;
  schedule: LoanSchedule;
  totalInterestKop: Kop;
  /** Экономия на процентах относительно графика без досрочек. */
  savingsKop: Kop;
  payoffDate: IsoDate;
  /** На сколько месяцев раньше закроется кредит. */
  monthsSaved: number;
  totalPrepaidKop: Kop;
  /** Обязательный платёж сразу после первой досрочки (для сравнения режимов). */
  paymentAfterFirstPrepaymentKop: Kop;
}

export interface ScenarioComparison {
  baseline: ScenarioResult;
  scenarios: ScenarioResult[];
}

export const MAX_COMPARED_SCENARIOS = 4;

function toResult(id: string, name: string, schedule: LoanSchedule, baseline: LoanSchedule | null): ScenarioResult {
  const firstPrepay = schedule.rows.findIndex((r) => r.prepaymentKop > 0);
  const after = firstPrepay >= 0 ? schedule.rows.slice(firstPrepay + 1).find((r) => r.kind === 'payment') : undefined;
  return {
    scenarioId: id,
    name,
    schedule,
    totalInterestKop: schedule.summary.totalInterestKop,
    savingsKop: baseline ? baseline.summary.totalInterestKop - schedule.summary.totalInterestKop : 0,
    payoffDate: schedule.summary.payoffDate,
    monthsSaved: baseline ? monthsBetween(schedule.summary.payoffDate, baseline.summary.payoffDate) : 0,
    totalPrepaidKop: schedule.summary.totalPrepaidKop,
    paymentAfterFirstPrepaymentKop: after?.paymentKop ?? schedule.summary.firstPaymentKop,
  };
}

/** Сравнение до 4 сценариев досрочки с графиком без досрочек. */
export function compareScenarios(loan: LoanInput, scenarios: readonly PrepaymentScenarioInput[]): ScenarioComparison {
  if (scenarios.length > MAX_COMPARED_SCENARIOS) {
    throw new RangeError(`Можно сравнить не больше ${MAX_COMPARED_SCENARIOS} сценариев`);
  }
  const base = buildSchedule(loan, []);
  return {
    baseline: toResult('baseline', 'Без досрочки', base, null),
    scenarios: scenarios.map((s) => toResult(s.id, s.name, buildSchedule(loan, s.prepayments), base)),
  };
}

export interface TimingPoint {
  date: IsoDate;
  savingsKop: Kop;
  monthsSaved: number;
}

/**
 * «1 млн сейчас экономит X, тот же 1 млн через 5 лет — Y».
 * Считает экономию от одного и того же разового платежа в разные даты поверх уже запланированных досрочек.
 */
export function prepaymentTimingEffect(
  loan: LoanInput,
  amountKop: Kop,
  dates: readonly IsoDate[],
  mode: PrepaymentMode = 'reduce_term',
  existing: readonly PrepaymentInput[] = [],
): TimingPoint[] {
  const base = buildSchedule(loan, existing);
  return dates.map((date) => {
    const s = buildSchedule(loan, [
      ...existing,
      { id: '__timing__', loanId: loan.id, kind: 'one_off', amountKop, date, mode },
    ]);
    return {
      date,
      savingsKop: base.summary.totalInterestKop - s.summary.totalInterestKop,
      monthsSaved: monthsBetween(s.summary.payoffDate, base.summary.payoffDate),
    };
  });
}

export interface ModeComparison {
  reduceTerm: ScenarioResult;
  reducePayment: ScenarioResult;
  reducePaymentKeepAmount: ScenarioResult;
}

/** Те же досрочки в трёх режимах — для рекомендации «сравните с уменьшением срока». */
export function compareModes(loan: LoanInput, prepayments: readonly PrepaymentInput[]): ModeComparison {
  const base = buildSchedule(loan, []);
  const withMode = (mode: PrepaymentMode) =>
    buildSchedule(
      loan,
      prepayments.map((p) => (p.loanId === loan.id ? { ...p, mode } : p)),
    );
  return {
    reduceTerm: toResult('reduce_term', 'Сокращение срока', withMode('reduce_term'), base),
    reducePayment: toResult('reduce_payment', 'Уменьшение платежа', withMode('reduce_payment'), base),
    reducePaymentKeepAmount: toResult(
      'reduce_payment_keep_amount',
      'Уменьшить платёж, платить прежнюю сумму',
      withMode('reduce_payment_keep_amount'),
      base,
    ),
  };
}

export interface CandidateModeResult {
  /** Экономия на процентах именно от этой досрочки — поверх уже запланированных. */
  savingsKop: Kop;
  monthsSaved: number;
  /** Обязательный платёж сразу после этой досрочки; 0 — кредит закрылся. */
  paymentAfterKop: Kop;
}

export interface CandidateModeComparison {
  reduceTerm: CandidateModeResult;
  reducePayment: CandidateModeResult;
  reducePaymentKeepAmount: CandidateModeResult;
}

/**
 * Новая досрочка в трёх режимах поверх уже запланированных.
 * Режим меняется только у новой: прошлые досрочки уже внесены или выбраны — и остаются как есть.
 */
export function compareCandidateModes(
  loan: LoanInput,
  existing: readonly PrepaymentInput[],
  candidate: PrepaymentInput,
): CandidateModeComparison {
  const base = buildSchedule(loan, existing);
  const withMode = (mode: PrepaymentMode): CandidateModeResult => {
    const schedule = buildSchedule(loan, [...existing, { ...candidate, mode }]);
    const at = schedule.rows.findIndex((r) => r.prepaymentIds.includes(candidate.id));
    const after = at >= 0 ? schedule.rows.slice(at + 1).find((r) => r.kind === 'payment') : undefined;
    return {
      savingsKop: base.summary.totalInterestKop - schedule.summary.totalInterestKop,
      monthsSaved: monthsBetween(schedule.summary.payoffDate, base.summary.payoffDate),
      paymentAfterKop: after?.paymentKop ?? 0,
    };
  };
  return {
    reduceTerm: withMode('reduce_term'),
    reducePayment: withMode('reduce_payment'),
    reducePaymentKeepAmount: withMode('reduce_payment_keep_amount'),
  };
}
