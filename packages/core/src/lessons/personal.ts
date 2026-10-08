import { addYears, parseDate } from '../date/date.js';
import { prepaymentTimingEffect } from '../loan/compare.js';
import { buildSchedule } from '../loan/schedule.js';
import type { Kop } from '../money/money.js';
import { rub } from '../money/money.js';
import type { PlanInput, PlanResult } from '../projection/types.js';

/**
 * Значения для блока «В вашем случае» в уроках: те же шаблоны {{fact.x|rub}}, что и в рекомендациях.
 * Если кредита ещё нет, hasLoan = false — персональный блок не показывается.
 */
export function lessonValues(plan: PlanResult, input: PlanInput): Record<string, number | string | boolean | null> {
  const loan = input.loans[0];
  const lp = plan.loans[0];
  const values: Record<string, number | string | boolean | null> = {
    hasLoan: Boolean(loan && lp),
    cushionKop: plan.cushion.currentKop,
    cushionTargetKop: plan.cushion.targetKop,
    cushionMonths: Number.isFinite(plan.cushion.monthsCovered) ? plan.cushion.monthsCovered : null,
    cushionTargetMonths: plan.cushion.targetMonths,
    monthlyObligatoryKop: plan.cushion.monthlyObligatoryKop,
    cushionDate: plan.cushion.projectedFullDate,
    taxPropertyKop: plan.tax.totalPropertyRefundKop,
    taxInterestKop: plan.tax.totalInterestRefundKop,
    taxTotalKop: plan.tax.totalPropertyRefundKop + plan.tax.totalInterestRefundKop,
  };
  if (!loan || !lp) return values;

  const base = buildSchedule(loan, []);
  const first = base.rows[0]!;
  const firstYear = base.rows.filter((r) => r.kind === 'payment').slice(0, 12);
  const yearInterest = firstYear.reduce((s, r) => s + r.interestKop, 0);
  const yearPaid = firstYear.reduce((s, r) => s + r.paymentKop, 0);
  const amount: Kop = rub(100_000);
  const start = plan.today > loan.issueDate ? plan.today : base.rows[0]!.date;
  const [now, later] = prepaymentTimingEffect(loan, amount, [start, addYears(start, 5)]);

  // страховка на ближайший год — сумма из календаря
  const insurance = plan.calendar.filter((e) => e.type === 'insurance').reduce((s, e) => s + (e.amountKop ?? 0), 0);

  return {
    ...values,
    loanRatePercent: Number(loan.annualRate),
    principalKop: loan.principalKop,
    termYears: Math.round(loan.termMonths / 12),
    firstPaymentKop: first.paymentKop,
    firstInterestKop: first.interestKop,
    firstInterestPercent: Math.round((first.interestKop / first.paymentKop) * 100),
    firstYearInterestKop: yearInterest,
    firstYearPrincipalKop: yearPaid - yearInterest,
    totalInterestKop: base.summary.totalInterestKop,
    overpayPercent: Math.round((base.summary.totalInterestKop / loan.principalKop) * 100),
    payoffYear: parseDate(lp.schedule.summary.payoffDate).y,
    prepayAmountKop: amount,
    prepayNowSavingsKop: now?.savingsKop ?? 0,
    prepayLaterSavingsKop: later?.savingsKop ?? 0,
    insuranceYearKop: insurance,
  };
}

