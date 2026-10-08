import { type IsoDate, parseDate } from '../date/date.js';
import { D, type Kop, roundKop, rub } from '../money/money.js';
import type { LoanSchedule, PrepaymentInput, PrepaymentMode } from '../loan/types.js';

/** Лимиты имущественного вычета на одного человека (ст. 220 НК РФ). */
export const PROPERTY_DEDUCTION_LIMIT_KOP = rub(2_000_000);
export const INTEREST_DEDUCTION_LIMIT_KOP = rub(3_000_000);
export const TAX_LIMITS_SOURCE = {
  url: 'https://www.nalog.gov.ru/rn77/taxation/taxes/ndfl/nalog_vichet/imush_vichet/',
  reviewedAt: '2026-10-08',
};

export interface TaxMemberInput {
  memberId: string;
  name: string;
  /** Годовой доход, облагаемый НДФЛ (зарплата до вычета налога). */
  annualTaxableIncomeKop: Kop;
  /** Ставка НДФЛ, по которой человек платит налог (13 или 15 и т. д.). */
  ndflRatePercent: string;
  /** Сколько базы имущественного вычета уже использовано раньше (по другой квартире). */
  propertyDeductionUsedKop: Kop;
  /** Вычет по процентам уже использован по другому объекту — второй раз не положен. */
  interestDeductionUsed: boolean;
  /** Доля расходов на покупку, распределённая на этого человека (%). */
  costSharePercent: string;
  /** Доля уплаченных процентов на этого человека (%). */
  interestSharePercent: string;
  /** Вычет уже оформлен/заявлен. */
  claimed: boolean;
}

export interface TaxInput {
  /** Стоимость жилья. */
  priceKop: Kop;
  /** Маткапитал, субсидии и деньги работодателя в вычет не входят. */
  nonDeductibleKop: Kop;
  /** Дата возникновения права: регистрация собственности (вторичка) или акт приёмки (новостройка). */
  rightDate: IsoDate | null;
  members: TaxMemberInput[];
  schedules: LoanSchedule[];
}

export interface TaxRefundYear {
  memberId: string;
  /** За какой год подаётся декларация. */
  taxYear: number;
  propertyRefundKop: Kop;
  interestRefundKop: Kop;
  /** Ориентировочная дата получения денег (после проверки декларации). */
  expectedDate: IsoDate;
}

export interface TaxMemberSummary {
  memberId: string;
  name: string;
  propertyBaseKop: Kop;
  propertyRefundTotalKop: Kop;
  interestRefundTotalKop: Kop;
  /** Сколько вернётся в первый год (за год возникновения права). */
  firstYearRefundKop: Kop;
  claimed: boolean;
}

export interface TaxResult {
  members: TaxMemberSummary[];
  years: TaxRefundYear[];
  totalPropertyRefundKop: Kop;
  totalInterestRefundKop: Kop;
  /** Можно вернуть, но ещё не заявлено. */
  unclaimedKop: Kop;
}

function interestByYear(schedules: readonly LoanSchedule[]): Map<number, Kop> {
  const map = new Map<number, Kop>();
  for (const s of schedules) {
    for (const r of s.rows) {
      const y = parseDate(r.date).y;
      map.set(y, (map.get(y) ?? 0) + r.interestKop);
    }
  }
  return map;
}

/**
 * Имущественный вычет с покупки (до 2 млн ₽ базы) и с процентов (до 3 млн ₽ базы) на каждого супруга.
 * Возврат за год не больше НДФЛ, уплаченного за этот год. Сначала используется вычет с покупки, потом с процентов.
 */
export function calculateTaxDeductions(input: TaxInput, horizonYears = 30): TaxResult {
  if (!input.rightDate || input.members.length === 0) {
    return { members: [], years: [], totalPropertyRefundKop: 0, totalInterestRefundKop: 0, unclaimedKop: 0 };
  }
  const startYear = parseDate(input.rightDate).y;
  const deductibleCost = Math.max(0, input.priceKop - input.nonDeductibleKop);
  const interest = interestByYear(input.schedules);
  const years: TaxRefundYear[] = [];
  const members: TaxMemberSummary[] = [];

  for (const m of input.members) {
    const rate = new D(m.ndflRatePercent).div(100);
    const ndflPerYear = roundKop(new D(m.annualTaxableIncomeKop).mul(rate));
    const costShare = roundKop(new D(deductibleCost).mul(m.costSharePercent).div(100));
    let propertyBaseLeft = Math.max(0, Math.min(costShare, PROPERTY_DEDUCTION_LIMIT_KOP - m.propertyDeductionUsedKop));
    const propertyBase = propertyBaseLeft;
    let interestBaseLeft = m.interestDeductionUsed ? 0 : INTEREST_DEDUCTION_LIMIT_KOP;
    let propertyTotal = 0;
    let interestTotal = 0;
    let firstYear = 0;
    // проценты, уплаченные до года возникновения права, тоже принимаются к вычету — в первый год
    let carriedInterest = 0;
    for (const [y, amount] of interest) {
      if (y < startYear) carriedInterest += amount;
    }
    for (let y = startYear; y < startYear + horizonYears; y++) {
      const yearInterestAll = (interest.get(y) ?? 0) + (y === startYear ? carriedInterest : 0);
      if (propertyBaseLeft <= 0 && (interestBaseLeft <= 0 || y > (lastInterestYear(interest) ?? 0))) break;
      let ndflLeft = ndflPerYear;
      const propertyRefundCap = roundKop(new D(propertyBaseLeft).mul(rate));
      const propertyRefund = Math.min(propertyRefundCap, ndflLeft);
      ndflLeft -= propertyRefund;
      const propertyBaseUsed = propertyRefund === propertyRefundCap ? propertyBaseLeft : roundKop(new D(propertyRefund).div(rate));
      propertyBaseLeft -= propertyBaseUsed;

      const memberInterest = roundKop(new D(yearInterestAll).mul(m.interestSharePercent).div(100));
      const interestBase = Math.min(memberInterest, interestBaseLeft);
      const interestRefundCap = roundKop(new D(interestBase).mul(rate));
      const interestRefund = Math.min(interestRefundCap, ndflLeft);
      const interestBaseUsed = interestRefund === interestRefundCap ? interestBase : roundKop(new D(interestRefund).div(rate));
      interestBaseLeft -= interestBaseUsed;

      if (propertyRefund + interestRefund > 0) {
        years.push({
          memberId: m.memberId,
          taxYear: y,
          propertyRefundKop: propertyRefund,
          interestRefundKop: interestRefund,
          expectedDate: `${y + 1}-06-01`,
        });
      }
      if (y === startYear) firstYear = propertyRefund + interestRefund;
      propertyTotal += propertyRefund;
      interestTotal += interestRefund;
    }
    members.push({
      memberId: m.memberId,
      name: m.name,
      propertyBaseKop: propertyBase,
      propertyRefundTotalKop: propertyTotal,
      interestRefundTotalKop: interestTotal,
      firstYearRefundKop: firstYear,
      claimed: m.claimed,
    });
  }
  years.sort((a, b) => a.taxYear - b.taxYear || (a.memberId < b.memberId ? -1 : 1));
  const totalProperty = members.reduce((s, m) => s + m.propertyRefundTotalKop, 0);
  const totalInterest = members.reduce((s, m) => s + m.interestRefundTotalKop, 0);
  const unclaimed = members.filter((m) => !m.claimed).reduce((s, m) => s + m.propertyRefundTotalKop + m.interestRefundTotalKop, 0);
  return { members, years, totalPropertyRefundKop: totalProperty, totalInterestRefundKop: totalInterest, unclaimedKop: unclaimed };
}

function lastInterestYear(interest: Map<number, Kop>): number | null {
  let max: number | null = null;
  for (const y of interest.keys()) if (max === null || y > max) max = y;
  return max;
}

/** «Направить вычеты в досрочку»: каждый возврат превращается в разовый платёж в дату получения. */
export function taxRefundsToPrepayments(
  result: TaxResult,
  loanId: string,
  mode: PrepaymentMode = 'reduce_term',
  options: { includeProperty?: boolean; includeInterest?: boolean; fromDate?: IsoDate } = {},
): PrepaymentInput[] {
  const includeProperty = options.includeProperty ?? true;
  const includeInterest = options.includeInterest ?? true;
  const byDate = new Map<IsoDate, Kop>();
  for (const y of result.years) {
    if (options.fromDate && y.expectedDate < options.fromDate) continue;
    const amount = (includeProperty ? y.propertyRefundKop : 0) + (includeInterest ? y.interestRefundKop : 0);
    if (amount > 0) byDate.set(y.expectedDate, (byDate.get(y.expectedDate) ?? 0) + amount);
  }
  return [...byDate.entries()].map(([date, amountKop]) => ({
    id: `tax:${date}`,
    loanId,
    kind: 'one_off' as const,
    amountKop,
    date,
    mode,
    source: 'tax_refund' as const,
  }));
}
