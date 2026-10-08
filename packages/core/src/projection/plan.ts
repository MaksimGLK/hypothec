import { addDays, addMonths, endOfMonth, type IsoDate, monthsBetween } from '../date/date.js';
import { buildAllocation } from '../allocation/allocation.js';
import { buildCalendar } from '../calendar/calendar.js';
import { cushionStatus } from '../cushion/cushion.js';
import { expandExpenses } from '../expenses/expenses.js';
import { expandIncomes } from '../income/income.js';
import { buildSchedule, balanceAt } from '../loan/schedule.js';
import { computeFacts } from '../recommendations/facts.js';
import { runRecommendations } from '../recommendations/engine.js';
import { calculateTaxDeductions } from '../tax/tax.js';
import type { Dashboard, LoanProjection, PlanContext, PlanInput, PlanResult } from './types.js';

export const DEFAULT_HORIZON_MONTHS = 120;

/**
 * Единая точка пересчёта плана. Чистая функция: одинаковый вход → одинаковый результат.
 * Вызывается сервером при любом изменении данных и клиентом для мгновенного «что если».
 */
export function buildPlan(input: PlanInput, options: { calendarMonths?: number } = {}): PlanResult {
  const today = input.today;
  const horizon = input.horizonMonths ?? DEFAULT_HORIZON_MONTHS;
  const horizonEnd = endOfMonth(addMonths(today, horizon));
  const keysDate = input.scenario.keysDate;

  const active = input.prepaymentScenarios.find((s) => s.isActive);
  const activePrepayments = active?.prepayments ?? [];

  const loans: LoanProjection[] = input.loans.map((loan) => {
    const schedule = buildSchedule(loan, activePrepayments);
    const baseline = activePrepayments.some((p) => p.loanId === loan.id) ? buildSchedule(loan, []) : schedule;
    const next = schedule.rows.find((r) => r.kind === 'payment' && r.date >= today) ?? null;
    return {
      loanId: loan.id,
      name: loan.name ?? 'Ипотека',
      schedule,
      baseline,
      savingsKop: baseline.summary.totalInterestKop - schedule.summary.totalInterestKop,
      monthsSaved: monthsBetween(schedule.summary.payoffDate, baseline.summary.payoffDate),
      nextPayment: next,
      currentBalanceKop: today < loan.issueDate ? loan.principalKop : balanceAt(schedule, loan.principalKop, today),
    };
  });
  const schedules = loans.map((l) => l.schedule);

  const expenseContext = {
    keysDate,
    loanPayoff: Object.fromEntries(loans.map((l) => [l.loanId, l.schedule.summary.payoffDate])),
    loanBalanceAt: (loanId: string, date: IsoDate) => {
      const l = loans.find((x) => x.loanId === loanId);
      const loan = input.loans.find((x) => x.id === loanId);
      if (!l || !loan) return 0;
      return date <= loan.issueDate ? loan.principalKop : balanceAt(l.schedule, loan.principalKop, date);
    },
  };

  const incomeEvents = expandIncomes(input.incomes, today, horizonEnd, { keysDate });
  const allocation = buildAllocation({
    today,
    horizonMonths: horizon,
    incomeEvents,
    accounts: input.accounts,
    schedules,
    prepayments: activePrepayments,
    expenses: input.expenses,
    living: input.living,
    expenseContext,
    settings: input.settings.allocation,
  });

  const cushionAcc = input.accounts.find((a) => a.kind === 'cushion');
  const cushion = cushionStatus(
    allocation,
    cushionAcc?.balanceKop ?? 0,
    input.settings.allocation.cushionMonths,
    input.settings.allocation.minCushionMonths,
  );

  const tax = calculateTaxDeductions({
    priceKop: input.scenario.priceKop,
    nonDeductibleKop: input.scenario.maternityCapitalKop,
    rightDate: input.scenario.rightDate ?? keysDate,
    members: input.taxMembers,
    schedules,
  });

  const ctx: PlanContext = { input, today, keysDate, activePrepayments, loans, incomeEvents, allocation, cushion, tax };
  const facts = computeFacts(ctx);
  const recommendations = runRecommendations(input.rules ?? [], ctx, facts, { states: input.recommendationStates ?? [] });

  const calendarTo = endOfMonth(addMonths(today, options.calendarMonths ?? 12));
  const calendar = buildCalendar({
    from: today,
    to: calendarTo,
    loans: input.loans,
    schedules,
    prepayments: activePrepayments,
    incomeEvents,
    transfers: allocation.transfers,
    stages: input.stages,
    expenseOccurrences: expandExpenses(input.expenses, today, calendarTo, expenseContext),
    tax,
  });

  const dashboard = buildDashboard(ctx, recommendations);
  return { today, keysDate, loans, allocation, cushion, tax, recommendations, facts, calendar, dashboard };
}

function buildDashboard(ctx: PlanContext, recommendations: PlanResult['recommendations']): Dashboard {
  const { today, allocation, loans, input } = ctx;
  const nextRows = loans.map((l) => l.nextPayment).filter((r): r is NonNullable<typeof r> => r !== null);
  let nextPayment: Dashboard['nextPayment'] = null;
  if (nextRows.length) {
    const date = nextRows.map((r) => r.date).sort()[0]!;
    const amount = nextRows.filter((r) => r.date === date).reduce((s, r) => s + r.paymentKop + r.keepExtraKop, 0);
    const mortgageAcc = input.accounts.find((a) => a.kind === 'mortgage');
    const balance = mortgageAcc?.balanceKop ?? 0;
    const planned = allocation.transfers
      .filter((t) => t.date <= date)
      .flatMap((t) => t.lines)
      .filter((l) => l.accountKind === 'mortgage')
      .reduce((s, l) => s + l.amountKop, 0);
    const byDue = balance + planned;
    nextPayment = {
      date,
      amountKop: amount,
      mortgageAccountKop: balance,
      plannedByDueKop: byDue,
      ready: byDue >= amount,
      readyNow: balance >= amount,
      shortfallKop: Math.max(0, amount - byDue),
    };
  }
  const main = loans[0];
  const soon = addDays(today, 14);
  return {
    nextPayment,
    cushion: ctx.cushion,
    goals: allocation.goals,
    payoff: main
      ? {
          date: main.schedule.summary.payoffDate,
          baselineDate: main.baseline.summary.payoffDate,
          savingsKop: loans.reduce((s, l) => s + l.savingsKop, 0),
          monthsSaved: main.monthsSaved,
        }
      : null,
    upcomingStages: input.stages
      .filter((s) => s.status !== 'done' && s.status !== 'skipped')
      .sort((a, b) => ((a.plannedDate ?? '9999') < (b.plannedDate ?? '9999') ? -1 : 1))
      .slice(0, 3),
    upcomingTransfers: allocation.transfers.filter((t) => t.date <= soon && t.lines.some((l) => l.purpose !== 'free')),
    recommendations: recommendations.slice(0, 3),
    deficitsSoon: allocation.deficits.filter((d) => d.date <= addMonths(today, 3)),
  };
}
