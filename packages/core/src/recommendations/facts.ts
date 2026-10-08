import { addMonths, daysBetween, type IsoDate, monthsBetween } from '../date/date.js';
import { expandExpenses } from '../expenses/expenses.js';
import { stableMonthlyIncome } from '../income/income.js';
import { D } from '../money/money.js';
import type { PlanContext } from '../projection/types.js';
import type { Facts } from './jsonlogic.js';

/**
 * Каталог фактов — именованные метрики плана. Правила рекомендаций (данные) могут ссылаться только на них.
 * Новый факт = новая версия ядра; новые правила на существующих фактах — без релиза.
 */
export const FACT_DESCRIPTIONS: Record<string, string> = {
  hasLoan: 'Есть хотя бы один кредит',
  cushionKop: 'Сколько сейчас на счёте «Подушка», коп.',
  cushionMonths: 'На сколько месяцев обязательных расходов хватит подушки',
  cushionTargetMonths: 'Цель подушки, месяцев',
  cushionFull: 'Подушка собрана полностью',
  monthlyObligatoryKop: 'Обязательные расходы в месяц (ипотека + жизнь + ежегодные/12), коп.',
  prepaymentBeforeCushionKop: 'Сколько денег идёт в досрочку, пока подушка не собрана (12 мес.), коп.',
  monthlyLoanPaymentsKop: 'Платежи по всем кредитам в месяц, коп.',
  stableMonthlyIncomeKop: 'Стабильный доход в месяц, коп.',
  dtiPercent: 'Платежи по кредитам в % от стабильного дохода',
  dtiWarnPercent: 'Порог высокой нагрузки, %',
  mortgageUnstableGapKop: 'Сколько платежа по ипотеке не покрывается стабильными деньгами, коп.',
  reducePaymentCount: 'Число досрочек с уменьшением платежа в активном сценарии',
  loanAgeMonths: 'Сколько месяцев прошло с выдачи кредита',
  freeCashKop: 'Свободные деньги: подушка сверх цели + счёт «Досрочка», коп.',
  yearlyFreeKop: 'Сколько в год остаётся на досрочку и свободные траты по плану, коп.',
  loanRatePercent: 'Ставка по кредиту (максимальная из действующих), %',
  depositRatePercent: 'Ставка по вкладу, %',
  depositNetRatePercent: 'Ставка по вкладу после налога, %',
  marketRatePercent: 'Рыночная ставка по ипотеке, %',
  refinanceGapPercent: 'Насколько ставка кредита выше рыночной, п.п.',
  taxUnclaimedKop: 'Сколько можно вернуть вычетом, но ещё не заявлено, коп.',
  daysToInsuranceRenewal: 'Дней до продления страховки',
  creditPurchasesCount: 'Покупок в кредит или рассрочку в плане',
  depositBeforeApproval: 'Задаток запланирован до одобрения ипотеки',
  annualWithoutReserveKop: 'Ежегодные платежи без помесячного резерва, коп. в год',
  freedMonthlyKop: 'Освободившаяся сумма в месяц (рост дохода или конец аренды), коп.',
};

export function computeFacts(ctx: PlanContext): Facts {
  const { input, today, allocation, cushion } = ctx;
  const settings = input.settings;
  const horizon12 = addMonths(today, 12);

  const nextPayments = ctx.loans.map((l) => l.nextPayment?.paymentKop ?? 0);
  const monthlyLoanPayments = nextPayments.reduce((s, v) => s + v, 0);
  const stableIncome = stableMonthlyIncome(input.incomes, today, { keysDate: ctx.keysDate });
  const dti = stableIncome > 0 ? Math.round((monthlyLoanPayments / stableIncome) * 1000) / 10 : monthlyLoanPayments > 0 ? 999 : 0;

  // досрочка при несобранной подушке: запланированные разовые/ежемесячные досрочки
  // и переводы на счёт «Досрочка» до даты, когда подушка будет собрана
  let prepaymentBeforeCushion = 0;
  if (!cushion.isFullReached) {
    const cushionDate = cushion.projectedFullDate ?? horizon12;
    const limit = cushionDate < horizon12 ? cushionDate : horizon12;
    for (const p of ctx.activePrepayments) {
      if (p.kind === 'one_off' && p.date && p.date >= today && p.date <= limit) prepaymentBeforeCushion += p.amountKop;
      if (p.kind === 'monthly') {
        const start = p.startDate && p.startDate > today ? p.startDate : today;
        const end = p.endDate && p.endDate < limit ? p.endDate : limit;
        if (start <= end) prepaymentBeforeCushion += p.amountKop * Math.max(1, monthsBetween(start, end));
      }
    }
    for (const t of allocation.transfers) {
      if (t.date >= limit) break;
      for (const l of t.lines) if (l.accountKind === 'prepayment' && l.purpose === 'goal') prepaymentBeforeCushion += l.amountKop;
    }
  }

  const reducePaymentCount = ctx.activePrepayments.filter((p) => p.mode === 'reduce_payment').length;
  const mainLoan = ctx.input.loans[0];
  const loanAgeMonths = mainLoan ? monthsBetween(mainLoan.issueDate, today) : -1;

  const cushionSurplus = Math.max(0, cushion.currentKop - cushion.targetKop);
  const prepayAccount = input.accounts.find((a) => a.kind === 'prepayment')?.balanceKop ?? 0;
  const freeCash = cushionSurplus + Math.max(0, prepayAccount);
  let yearlyFree = 0;
  for (const t of allocation.transfers) {
    if (t.date >= horizon12) break;
    for (const l of t.lines) {
      if (l.purpose === 'free' || (l.purpose === 'goal' && l.accountKind === 'prepayment')) yearlyFree += l.amountKop;
    }
  }

  const loanRate = ctx.loans.length
    ? Math.max(
        ...ctx.loans.map((l) => {
          const r = l.nextPayment?.annualRate ?? input.loans.find((x) => x.id === l.loanId)?.annualRate ?? '0';
          return Number(r);
        }),
      )
    : null;
  const depositRate = settings.depositRatePercent ? Number(settings.depositRatePercent) : null;
  const depositTax = Number(settings.depositTaxPercent ?? '13');
  const depositNet = depositRate === null ? null : new D(depositRate).mul(new D(100).minus(depositTax)).div(100).toDecimalPlaces(2).toNumber();
  const marketRate = settings.marketRatePercent ? Number(settings.marketRatePercent) : null;

  // страховки: ближайшее продление
  const payoff: Record<string, IsoDate> = {};
  for (const l of ctx.loans) payoff[l.loanId] = l.schedule.summary.payoffDate;
  const insuranceOcc = expandExpenses(
    input.expenses.filter((e) => e.recurrence === 'yearly' && (e.loanId || /страх/i.test(e.name))),
    today,
    horizon12,
    {
      keysDate: ctx.keysDate,
      loanPayoff: payoff,
      loanBalanceAt: (loanId, date) => balanceOn(ctx, loanId, date),
    },
  ).filter((o) => !o.paid && o.date > today);
  const nextInsurance = insuranceOcc[0];

  const creditPurchases = input.expenses.filter((e) => e.credit && e.credit.months > 0 && (e.factKop === undefined || e.factKop === null));

  const approval = input.stages.find((s) => s.templateKey === 'bank_approval');
  const deposit = input.expenses.find((e) => e.catalogKey === 'seller_deposit' && (e.factKop === undefined || e.factKop === null));
  const approvalDone = approval?.status === 'done';
  const approvalDate = approval?.actualDate ?? approval?.plannedDate ?? null;
  const depositBeforeApproval = Boolean(deposit?.date && approval && !approvalDone && approvalDate && deposit.date < approvalDate) ||
    Boolean(deposit?.date && approval && !approvalDone && deposit.date <= addMonths(today, 1));

  const annualWithoutReserve = settings.allocation.annualReserveEnabled
    ? 0
    : input.expenses.filter((e) => e.recurrence === 'yearly').reduce((s, e) => {
        if (e.percentOfLoanBalance && e.loanId) {
          return s + Math.round((balanceOn(ctx, e.loanId, today) * Number(e.percentOfLoanBalance)) / 100);
        }
        return s + e.planKop;
      }, 0);

  // освободившиеся деньги: рост стабильного дохода за последние 60 дней или конец аренды (±60 дней)
  let freed = 0;
  for (const inc of input.incomes) {
    if (inc.reliability !== 'stable' || inc.previousAmountKop === undefined || !inc.changedAt) continue;
    const d = daysBetween(inc.changedAt, today);
    if (d >= 0 && d <= 60 && inc.amountKop > inc.previousAmountKop) freed += inc.amountKop - inc.previousAmountKop;
  }
  for (const l of input.living) {
    const end = l.endsAtKeys ? ctx.keysDate : l.endDate;
    if (!end) continue;
    const d = daysBetween(end, today);
    if (d >= -30 && d <= 60) freed += l.amountKop;
  }

  return {
    hasLoan: ctx.loans.length > 0,
    cushionKop: cushion.currentKop,
    cushionMonths: Number.isFinite(cushion.monthsCovered) ? cushion.monthsCovered : 999,
    cushionTargetMonths: cushion.targetMonths,
    cushionFull: cushion.isFullReached,
    monthlyObligatoryKop: cushion.monthlyObligatoryKop,
    prepaymentBeforeCushionKop: prepaymentBeforeCushion,
    monthlyLoanPaymentsKop: monthlyLoanPayments,
    stableMonthlyIncomeKop: stableIncome,
    dtiPercent: dti,
    dtiWarnPercent: settings.dtiWarnPercent ?? 45,
    mortgageUnstableGapKop: allocation.mortgageUnstableShareKop,
    reducePaymentCount,
    loanAgeMonths,
    freeCashKop: freeCash,
    yearlyFreeKop: yearlyFree,
    loanRatePercent: loanRate,
    depositRatePercent: depositRate,
    depositNetRatePercent: depositNet,
    marketRatePercent: marketRate,
    refinanceGapPercent: loanRate !== null && marketRate !== null ? Math.round((loanRate - marketRate) * 100) / 100 : null,
    taxUnclaimedKop: ctx.tax.unclaimedKop,
    daysToInsuranceRenewal: nextInsurance ? daysBetween(today, nextInsurance.date) : null,
    creditPurchasesCount: creditPurchases.length,
    depositBeforeApproval,
    annualWithoutReserveKop: annualWithoutReserve,
    freedMonthlyKop: freed,
  };
}

export function balanceOn(ctx: PlanContext, loanId: string, date: IsoDate): number {
  const l = ctx.loans.find((x) => x.loanId === loanId);
  if (!l) return 0;
  const principal = ctx.input.loans.find((x) => x.id === loanId)?.principalKop ?? 0;
  if (date < (ctx.input.loans.find((x) => x.id === loanId)?.issueDate ?? date)) return principal;
  let balance = principal;
  for (const r of l.schedule.rows) {
    if (r.date > date) break;
    balance = r.balanceKop;
  }
  return balance;
}
