import { addMonths, addYears, type IsoDate, monthsBetween } from '../date/date.js';
import { stressTest } from '../cushion/cushion.js';
import { compareModes, prepaymentTimingEffect } from '../loan/compare.js';
import { buildSchedule, paymentDate } from '../loan/schedule.js';
import { consumerLoanOverpay } from '../loan/math.js';
import { monthlyEquivalent } from '../income/income.js';
import { D, type Kop, roundKop, rub } from '../money/money.js';
import type { PlanContext } from '../projection/types.js';
import type { Facts } from './jsonlogic.js';
import type { EffectResult } from './types.js';

export type EffectCalculator = (ctx: PlanContext, facts: Facts, params: Record<string, unknown>) => EffectResult | null;

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Ближайшая дата, когда банк примет досрочку (дата платежа после сегодня или сегодня). */
function nearestPrepaymentDate(ctx: PlanContext, loanId: string, after: IsoDate): IsoDate {
  const loan = ctx.input.loans.find((l) => l.id === loanId)!;
  if (!loan.bankRules?.onlyOnPaymentDate && after > loan.issueDate) return after;
  for (let i = 1; i <= loan.termMonths; i++) {
    const d = paymentDate(loan, i);
    if (d > after) return d;
  }
  return after;
}

/** Реестр калькуляторов эффекта. Правило в данных ссылается на калькулятор по имени. */
export const EFFECT_CALCULATORS: Record<string, EffectCalculator> = {
  cushionMonthsNow: (ctx) => ({
    months: ctx.cushion.monthsCovered,
    valueKop: Math.max(0, ctx.cushion.minTargetKop - ctx.cushion.currentKop),
    details: {
      monthsCovered: ctx.cushion.monthsCovered,
      cushionKop: ctx.cushion.currentKop,
      minTargetKop: ctx.cushion.minTargetKop,
      targetKop: ctx.cushion.targetKop,
      monthlyObligatoryKop: ctx.cushion.monthlyObligatoryKop,
      missingToMinKop: Math.max(0, ctx.cushion.minTargetKop - ctx.cushion.currentKop),
    },
    formula: 'Подушка ÷ обязательные расходы в месяц (ипотека + базовые траты + ежегодные платежи ÷ 12).',
  }),

  prepaymentBeforeCushion: (ctx, facts) => ({
    valueKop: Number(facts.prepaymentBeforeCushionKop ?? 0),
    details: {
      amountKop: Number(facts.prepaymentBeforeCushionKop ?? 0),
      missingKop: Math.max(0, ctx.cushion.targetKop - ctx.cushion.currentKop),
    },
    formula: 'Сумма досрочек и переводов на счёт «Досрочка» до даты, когда подушка будет собрана (в пределах 12 месяцев).',
  }),

  stressLargestIncome: (ctx) => {
    const stable = ctx.input.incomes.filter((i) => i.reliability === 'stable' && i.periodicity !== 'once');
    if (stable.length === 0) return null;
    const largest = [...stable].sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a))[0]!;
    const res = stressTest({
      today: ctx.today,
      months: 24,
      incomeEvents: ctx.incomeEvents,
      obligations: ctx.allocation.obligations,
      removeIncomeIds: [largest.id],
      cushionKop: ctx.cushion.currentKop,
    });
    return {
      months: res.monthsCushionLasts ?? 24,
      valueKop: res.monthlyGapKop,
      details: {
        incomeName: largest.name,
        monthsCushionLasts: res.monthsCushionLasts ?? 24,
        monthlyGapKop: res.monthlyGapKop,
      },
      formula: 'Убираем самый крупный стабильный доход и считаем, сколько месяцев подушка закрывает разницу между доходами и обязательными расходами.',
    };
  },

  unstableMortgageGap: (ctx) => ({
    valueKop: ctx.allocation.mortgageUnstableShareKop,
    details: { gapKop: ctx.allocation.mortgageUnstableShareKop },
    formula: 'Самая большая нехватка стабильных денег к дате платежа по ипотеке.',
  }),

  reduceTermVsPayment: (ctx) => {
    const loanId = ctx.activePrepayments.find((p) => p.mode === 'reduce_payment')?.loanId;
    const loan = ctx.input.loans.find((l) => l.id === loanId);
    if (!loan) return null;
    const cmp = compareModes(loan, ctx.activePrepayments);
    const diff = cmp.reduceTerm.savingsKop - cmp.reducePayment.savingsKop;
    return {
      valueKop: diff,
      details: {
        reduceTermSavingsKop: cmp.reduceTerm.savingsKop,
        reducePaymentSavingsKop: cmp.reducePayment.savingsKop,
        keepAmountSavingsKop: cmp.reducePaymentKeepAmount.savingsKop,
        keepAmountPaymentKop: cmp.reducePaymentKeepAmount.paymentAfterFirstPrepaymentKop,
        reducePaymentPaymentKop: cmp.reducePayment.paymentAfterFirstPrepaymentKop,
        diffKop: diff,
      },
      formula: 'Те же досрочки пересчитаны в трёх режимах; разница — в переплате по процентам за весь срок.',
    };
  },

  prepayNowVsLater: (ctx, facts, params) => {
    const loan = ctx.input.loans[0];
    if (!loan) return null;
    const years = num(params.years, 5);
    const candidate = Math.max(Number(facts.freeCashKop ?? 0), Number(facts.yearlyFreeKop ?? 0));
    const amount = candidate > 0 ? candidate : rub(num(params.defaultAmountRub, 100_000));
    const now = nearestPrepaymentDate(ctx, loan.id, ctx.today);
    const later = nearestPrepaymentDate(ctx, loan.id, addYears(ctx.today, years));
    const points = prepaymentTimingEffect(loan, amount, [now, later], 'reduce_term', ctx.activePrepayments.filter((p) => p.loanId === loan.id));
    const [a, b] = points;
    if (!a || !b) return null;
    return {
      valueKop: a.savingsKop,
      details: {
        amountKop: amount,
        years,
        savingsNowKop: a.savingsKop,
        savingsLaterKop: b.savingsKop,
        monthsSavedNow: a.monthsSaved,
        monthsSavedLater: b.monthsSaved,
        differenceKop: a.savingsKop - b.savingsKop,
      },
      formula: 'Один и тот же разовый платёж с сокращением срока: сейчас и через N лет. Разница — в процентах, которые не придётся платить.',
    };
  },

  depositVsPrepay: (_ctx, facts, params) => {
    const loanRate = facts.loanRatePercent;
    const net = facts.depositNetRatePercent;
    if (typeof loanRate !== 'number' || typeof net !== 'number') return null;
    const base = Math.max(Number(facts.freeCashKop ?? 0), Number(facts.yearlyFreeKop ?? 0), rub(num(params.defaultAmountRub, 100_000)));
    const spread = loanRate - net;
    const yearly = roundKop(new D(base).mul(Math.abs(spread)).div(100));
    return {
      valueKop: yearly,
      details: { amountKop: base, loanRatePercent: loanRate, depositNetRatePercent: net, spreadPercent: Math.round(spread * 100) / 100, yearlyDiffKop: yearly },
      formula: 'Сумма × |ставка кредита − ставка вклада после налога| — разница за год.',
    };
  },

  taxRefund: (ctx) => {
    const members = ctx.tax.members.filter((m) => !m.claimed);
    return {
      valueKop: ctx.tax.unclaimedKop,
      details: {
        totalKop: ctx.tax.unclaimedKop,
        propertyKop: members.reduce((s, m) => s + m.propertyRefundTotalKop, 0),
        interestKop: members.reduce((s, m) => s + m.interestRefundTotalKop, 0),
        perMember: members.map((m) => `${m.name}: ${Math.round((m.propertyRefundTotalKop + m.interestRefundTotalKop) / 100)}`).join('; '),
      },
      formula: '13% (или ваша ставка НДФЛ) от расходов на покупку до 2 млн ₽ и от уплаченных процентов до 3 млн ₽ на каждого, но не больше уплаченного за год налога.',
    };
  },

  insuranceRenewal: (_ctx, facts) => ({
    valueKop: 0,
    details: { days: Number(facts.daysToInsuranceRenewal ?? 0) },
    formula: 'Дней до ближайшей даты продления полиса по плану расходов.',
  }),

  refinanceBenefit: (ctx, facts) => {
    const market = facts.marketRatePercent;
    if (typeof market !== 'number') return null;
    const costs = ctx.input.settings.refinanceCostsKop ?? rub(50_000);
    let best = 0;
    let loanName = '';
    for (const l of ctx.loans) {
      const loan = ctx.input.loans.find((x) => x.id === l.loanId)!;
      const balance = l.currentBalanceKop;
      if (balance <= 0) continue;
      const remaining = l.schedule.rows.filter((r) => r.kind === 'payment' && r.date > ctx.today).length;
      if (remaining <= 0) continue;
      const rate = l.nextPayment?.annualRate ?? loan.annualRate;
      const start = ctx.today > loan.issueDate ? ctx.today : loan.issueDate;
      const current = buildSchedule({ id: 'cur', principalKop: balance, annualRate: rate, termMonths: remaining, type: loan.type, issueDate: start });
      const refi = buildSchedule({ id: 'ref', principalKop: balance, annualRate: String(market), termMonths: remaining, type: loan.type, issueDate: start });
      const benefit = current.summary.totalInterestKop - refi.summary.totalInterestKop - costs;
      if (benefit > best) {
        best = benefit;
        loanName = loan.name ?? 'Кредит';
      }
    }
    return {
      valueKop: best,
      details: { benefitKop: best, costsKop: costs, marketRatePercent: market, loanName },
      formula: 'Проценты за оставшийся срок по текущей ставке − проценты по рыночной ставке − расходы на рефинансирование.',
    };
  },

  creditPurchaseOverpay: (ctx) => {
    const items = ctx.input.expenses.filter((e) => e.credit && e.credit.months > 0 && (e.factKop === undefined || e.factKop === null));
    let overpay = 0;
    let months = 0;
    for (const e of items) {
      overpay += consumerLoanOverpay(e.planKop, e.credit!.annualRate, e.credit!.months);
      months = Math.max(months, e.credit!.months);
    }
    const total = items.reduce((s, e) => s + e.planKop, 0);
    return {
      valueKop: overpay,
      details: { overpayKop: overpay, totalKop: total, monthsToSave: months, monthlySaveKop: months ? Math.ceil(total / months) : 0, names: items.map((i) => i.name).join(', ') },
      formula: 'Переплата по аннуитету: платёж × число месяцев − цена покупки. Альтернатива — откладывать ту же сумму на счёт «Обустройство».',
    };
  },

  sellerDepositRisk: (ctx) => {
    const deposit = ctx.input.expenses.find((e) => e.catalogKey === 'seller_deposit');
    return {
      valueKop: deposit?.planKop ?? 0,
      details: { amountKop: deposit?.planKop ?? 0, date: deposit?.date ?? null },
      formula: 'Сумма задатка, которую можно потерять, если банк откажет в кредите или не одобрит квартиру.',
    };
  },

  annualReserve: (_ctx, facts) => {
    const yearly = Number(facts.annualWithoutReserveKop ?? 0);
    return {
      valueKop: yearly,
      details: { yearlyKop: yearly, monthlyKop: Math.ceil(yearly / 12) },
      formula: 'Сумма ежегодных платежей ÷ 12 — столько откладывать каждый месяц.',
    };
  },

  freedMoney: (ctx, facts) => {
    const monthly = Number(facts.freedMonthlyKop ?? 0);
    const loan = ctx.input.loans[0];
    let savings: Kop = 0;
    if (loan && monthly > 0) {
      const base = buildSchedule(loan, ctx.activePrepayments);
      const start = nearestPrepaymentDate(ctx, loan.id, ctx.today);
      const extra = buildSchedule(loan, [
        ...ctx.activePrepayments,
        { id: '__freed__', loanId: loan.id, kind: 'monthly', amountKop: monthly, startDate: start, endDate: addMonths(start, 12), mode: 'reduce_term' },
      ]);
      savings = base.summary.totalInterestKop - extra.summary.totalInterestKop;
    }
    return {
      valueKop: monthly * 12,
      details: { monthlyKop: monthly, yearlyKop: monthly * 12, prepaySavingsKop: savings, months: loan ? monthsBetween(ctx.today, addMonths(ctx.today, 12)) : 12 },
      formula: 'Освободившаяся сумма × 12 месяцев; экономия — если год направлять её в досрочку с сокращением срока.',
    };
  },
};
