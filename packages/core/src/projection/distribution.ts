import { buildAllocation, type AccountKind } from '../allocation/allocation.js';
import { budgetMonth } from '../budget/budget.js';
import { addMonths, endOfMonth, type IsoDate } from '../date/date.js';
import { expandIncomes } from '../income/income.js';
import { buildSchedule, balanceAt } from '../loan/schedule.js';
import { type Kop, splitKop } from '../money/money.js';
import type { PlanInput } from './types.js';

export type DistributionKey = 'mortgage' | 'obligatory' | 'life' | 'unplanned' | 'savings' | 'free';

export const DISTRIBUTION_LABELS: Record<DistributionKey, string> = {
  mortgage: 'Ипотека',
  obligatory: 'Другие обязательные',
  life: 'Жизнь',
  unplanned: 'Вне плана',
  savings: 'Копилка',
  free: 'Остаток',
};

export interface DistributionSegment {
  key: DistributionKey;
  label: string;
  amountKop: Kop;
  /** Доля дохода месяца, 0…1. */
  share: number;
  /** Из чего складывается: категории бюджета, цели копилки (для целей — со счётом). */
  parts: { name: string; amountKop: Kop; accountId?: string }[];
}

export interface IncomeDistribution {
  month: string;
  incomeKop: Kop;
  segments: DistributionSegment[];
  /** Если траты вне плана съели больше, чем оставалось, — на сколько не хватило. */
  shortfallKop: Kop;
  /** Обязательные платежи месяца, которые не покрываются доходами (по плану). */
  uncoveredKop: Kop;
  /** На сколько траты вне плана уменьшили копилку. */
  savingsReducedKop: Kop;
}

const GOAL_KINDS: AccountKind[] = ['cushion', 'setup', 'prepayment', 'custom'];

const order_sum = (sums: Record<DistributionKey, Kop>) => Object.values(sums).reduce((a, b) => a + Math.max(0, b), 0);

/**
 * Куда уходит доход месяца — как круговая диаграмма в семейной таблице:
 * всё, что пришло за месяц (100%), раскладывается на ипотеку, другие обязательные платежи, жизнь,
 * траты вне плана, копилку (цели) и остаток.
 *
 * План распределения считается так, как если бы месяц начинался с 1-го числа: это картина месяца целиком,
 * а не только оставшихся дней. Траты вне плана — по факту: перерасход по категориям и траты без плана; они уменьшают остаток.
 */
export function incomeDistribution(input: PlanInput, month: string): IncomeDistribution {
  const start = `${month}-01`;
  const end = endOfMonth(start);
  const keysDate = input.scenario.keysDate;
  const active = input.prepaymentScenarios.find((s) => s.isActive)?.prepayments ?? [];
  const schedules = input.loans.map((l) => buildSchedule(l, active));
  const expenseContext = {
    keysDate,
    loanPayoff: Object.fromEntries(schedules.map((s) => [s.loanId, s.summary.payoffDate])),
    loanBalanceAt: (loanId: string, date: IsoDate) => {
      const loan = input.loans.find((l) => l.id === loanId);
      const s = schedules.find((x) => x.loanId === loanId);
      if (!loan || !s) return 0;
      return date <= loan.issueDate ? loan.principalKop : balanceAt(s, loan.principalKop, date);
    },
  };
  // остатки счетов на начало месяца неизвестны — считаем распределение «с чистого листа», чтобы картина месяца не зависела от накоплений
  const accounts = input.accounts.map((a) => ({ ...a, balanceKop: 0 }));
  // горизонт — год: цели вроде подушки считаются от среднемесячных расходов за 12 месяцев, на коротком горизонте они занижаются
  const horizon = 12;
  const allocation = buildAllocation({
    today: start,
    horizonMonths: horizon,
    incomeEvents: expandIncomes(input.incomes, start, endOfMonth(addMonths(start, horizon)), { keysDate }),
    accounts,
    schedules,
    prepayments: active,
    expenses: input.expenses,
    living: input.living,
    expenseContext,
    settings: input.settings.allocation,
  });

  const sums: Record<DistributionKey, Kop> = { mortgage: 0, obligatory: 0, life: 0, unplanned: 0, savings: 0, free: 0 };
  const parts: Record<DistributionKey, Map<string, Kop>> = {
    mortgage: new Map(),
    obligatory: new Map(),
    life: new Map(),
    unplanned: new Map(),
    savings: new Map(),
    free: new Map(),
  };
  const addPart = (key: DistributionKey, name: string, amount: Kop) => parts[key].set(name, (parts[key].get(name) ?? 0) + amount);

  // для копилки ключ части — счёт цели, имя — название счёта
  const savingsNames = new Map<string, string>();
  let income = 0;
  for (const t of allocation.transfers) {
    if (t.date < start || t.date > end) continue;
    income += t.incomeAmountKop;
    for (const l of t.lines) {
      let key: DistributionKey;
      if (l.purpose === 'free') key = 'free';
      else if (l.purpose === 'goal' || GOAL_KINDS.includes(l.accountKind)) key = 'savings';
      else if (l.accountKind === 'mortgage') key = 'mortgage';
      else if (l.accountKind === 'life') key = 'life';
      else key = 'obligatory';
      sums[key] += l.amountKop;
      if (key === 'life' && l.parts?.length) for (const p of l.parts) addPart('life', p.name, p.amountKop);
      else if (key === 'savings') {
        addPart('savings', l.accountId, l.amountKop);
        savingsNames.set(l.accountId, input.accounts.find((a) => a.id === l.accountId)?.name ?? l.label);
      } else if (key !== 'free' && key !== 'mortgage') addPart(key, l.label, l.amountKop);
    }
  }

  // вне плана — по факту трат месяца: перерасход по категориям и траты без категории
  const budget = budgetMonth(input.living, input.spendings ?? [], month, start, { keysDate });
  for (const c of budget.categories) if (c.leftKop < 0) addPart('unplanned', c.name, -c.leftKop);
  if (budget.uncategorizedKop > 0) addPart('unplanned', 'Без категории', budget.uncategorizedKop);
  // траты вне плана сначала съедают остаток, потом — то, что шло в копилку: эти деньги до целей уже не дойдут
  const unplanned = budget.overspendKop;
  const fromFree = Math.min(unplanned, sums.free);
  const fromSavings = Math.min(unplanned - fromFree, sums.savings);
  sums.unplanned = unplanned;
  sums.free -= fromFree;
  if (fromSavings > 0) {
    const goals = [...parts.savings.entries()];
    const cut = splitKop(fromSavings, goals.map(([, v]) => v));
    goals.forEach(([name, v], i) => parts.savings.set(name, v - cut[i]!));
    sums.savings -= fromSavings;
  }
  const shortfall = unplanned - fromFree - fromSavings;

  const uncovered = allocation.deficits.filter((d) => d.date >= start && d.date <= end).reduce((s, d) => s + d.shortfallKop, 0);
  // если траты вне плана больше дохода, доли считаются от общей суммы — чтобы в сумме было 100%
  const base = Math.max(income, order_sum(sums), 1);
  const order: DistributionKey[] = ['mortgage', 'obligatory', 'life', 'unplanned', 'savings', 'free'];
  return {
    month,
    incomeKop: income,
    segments: order
      .filter((k) => sums[k] > 0)
      .map((k) => ({
        key: k,
        label: DISTRIBUTION_LABELS[k],
        amountKop: sums[k],
        share: sums[k] / base,
        parts: [...parts[k].entries()]
          .map(([name, amountKop]) => (k === 'savings' ? { name: savingsNames.get(name) ?? name, amountKop, accountId: name } : { name, amountKop }))
          .sort((a, b) => b.amountKop - a.amountKop),
      })),
    shortfallKop: shortfall,
    uncoveredKop: uncovered,
    savingsReducedKop: fromSavings,
  };
}
