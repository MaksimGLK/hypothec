import {
  addMonths,
  addDays,
  endOfMonth,
  type IsoDate,
  maxDate,
  monthKey,
  startOfMonth,
  monthsBetween,
} from '../date/date.js';
import type { ExpenseContext, ExpenseInput, LivingExpenseInput } from '../expenses/expenses.js';
import { expandExpenses, livingActiveOn, livingMonthlyAt } from '../expenses/expenses.js';
import { splitKop } from '../money/money.js';
import type { IncomeEvent, Reliability } from '../income/income.js';
import type { Kop } from '../money/money.js';
import type { LoanSchedule, PrepaymentInput } from '../loan/types.js';

export type AccountKind = 'mortgage' | 'cushion' | 'setup' | 'prepayment' | 'life' | 'annual_reserve' | 'deal' | 'custom';

export interface AccountInput {
  id: string;
  kind: AccountKind;
  name: string;
  /** Сколько сейчас лежит на счёте (вводит пользователь). */
  balanceKop: Kop;
  /** Цель для пользовательских счетов. */
  targetKop?: Kop | null;
}

export type SourceFilter = 'stable' | 'any' | 'irregular';

export type GoalTarget = 'min_cushion' | 'full_cushion' | 'priority_setup' | 'setup' | 'prepayment' | 'custom';

export interface GoalStep {
  target: GoalTarget;
  /** Для `custom` — счёт с собственной целью. */
  accountId?: string;
  sources: SourceFilter;
  enabled: boolean;
  /** Доля свободных денег в режиме «долями», %. */
  sharePercent?: number;
}

/**
 * Как делить деньги, оставшиеся после обязательных платежей:
 * - `sequential` — по очереди: следующая цель получает деньги, когда предыдущая собрана;
 * - `split` — долями: каждое поступление делится между целями по процентам, доля собранной цели переходит к остальным.
 */
export type DistributionMode = 'sequential' | 'split';

export interface AllocationSettings {
  /** Платить ипотеку и обязательные расходы также из нестабильных денег (по умолчанию нет). */
  useUnstableForObligations: boolean;
  /** Копить на ежегодные платежи помесячно. */
  annualReserveEnabled: boolean;
  cushionMonths: number;
  minCushionMonths: number;
  steps: GoalStep[];
  distribution?: DistributionMode;
}

export const DEFAULT_GOAL_STEPS: GoalStep[] = [
  { target: 'min_cushion', sources: 'any', enabled: true },
  { target: 'priority_setup', sources: 'any', enabled: true },
  { target: 'full_cushion', sources: 'any', enabled: true },
  { target: 'setup', sources: 'any', enabled: true },
  { target: 'prepayment', sources: 'any', enabled: true },
];

export const DEFAULT_ALLOCATION_SETTINGS: AllocationSettings = {
  useUnstableForObligations: false,
  annualReserveEnabled: true,
  cushionMonths: 6,
  minCushionMonths: 3,
  steps: DEFAULT_GOAL_STEPS,
};

/** living — обязательные траты на жизнь, living_flexible — необязательные (кафе, развлечения): их не закладывают в подушку. */
export type ObligationKind = 'mortgage' | 'annual' | 'deal' | 'living' | 'living_flexible' | 'monthly_expense';

export interface ObligationPart {
  name: string;
  amountKop: Kop;
}

export interface Obligation {
  id: string;
  kind: ObligationKind;
  accountKind: AccountKind;
  label: string;
  dueDate: IsoDate;
  windowStart: IsoDate;
  amountKop: Kop;
  refId?: string;
  /** Из чего состоит сумма — для «Жизни»: категории бюджета. */
  parts?: ObligationPart[];
}

export interface AllocationLine {
  accountId: string;
  accountKind: AccountKind;
  amountKop: Kop;
  purpose: 'obligation' | 'goal' | 'free';
  /** Человеческое пояснение: «платёж 15 марта», «подушка». */
  label: string;
  obligationId?: string;
  /** Детализация суммы: на что именно эти деньги (категории бюджета для «Жизни»). */
  parts?: ObligationPart[];
}

export interface Transfer {
  date: IsoDate;
  incomeId: string;
  incomeName: string;
  incomeAmountKop: Kop;
  reliability: Reliability;
  lines: AllocationLine[];
}

export interface Deficit {
  date: IsoDate;
  obligationId: string;
  kind: ObligationKind;
  label: string;
  shortfallKop: Kop;
  coveredFromCushionKop: Kop;
  uncoveredKop: Kop;
}

export interface AllocationInput {
  today: IsoDate;
  /** Сколько месяцев моделировать (для прогноза целей нужен длинный горизонт). */
  horizonMonths: number;
  incomeEvents: IncomeEvent[];
  accounts: AccountInput[];
  schedules: LoanSchedule[];
  /** Досрочки активного сценария: разовые берутся со счёта «Досрочка». */
  prepayments: PrepaymentInput[];
  expenses: ExpenseInput[];
  living: LivingExpenseInput[];
  expenseContext: ExpenseContext;
  settings: AllocationSettings;
}

export interface GoalProgress {
  target: GoalTarget;
  accountId: string;
  targetKop: Kop | null;
  currentKop: Kop;
  /** Прогноз даты достижения при текущем плане (null — не достигается в горизонте). */
  reachDate: IsoDate | null;
  /** Когда по плану на эту цель пойдут первые деньги (null — не в горизонте). */
  startDate: IsoDate | null;
}

export interface AllocationResult {
  transfers: Transfer[];
  deficits: Deficit[];
  obligations: Obligation[];
  /** Остатки счетов на конец каждого месяца. */
  monthlyBalances: { month: string; balances: Record<string, Kop> }[];
  goals: GoalProgress[];
  /** Обязательные расходы в месяц: ипотека + базовая жизнь + ежегодные/12 (среднее на 12 месяцев вперёд). */
  monthlyObligatoryKop: Kop;
  accounts: AccountInput[];
  warnings: { code: 'prepayment_underfunded' | 'mortgage_from_unstable'; date: IsoDate; message: string; amountKop: Kop }[];
  /** Доля платежа по ипотеке, которую пришлось бы покрывать нестабильными деньгами. */
  mortgageUnstableShareKop: Kop;
}

const ACCOUNT_LABELS: Record<AccountKind, string> = {
  mortgage: 'Ипотечный платёж',
  cushion: 'Подушка',
  setup: 'Обустройство',
  prepayment: 'Досрочка',
  life: 'Жизнь',
  annual_reserve: 'Ежегодные платежи',
  deal: 'Расходы сделки',
  custom: 'Цель',
};

export function defaultAccounts(): AccountInput[] {
  const kinds: AccountKind[] = ['mortgage', 'cushion', 'setup', 'prepayment', 'life', 'annual_reserve', 'deal'];
  return kinds.map((kind) => ({ id: `acc_${kind}`, kind, name: ACCOUNT_LABELS[kind], balanceKop: 0 }));
}

function sourceOk(filter: SourceFilter, reliability: Reliability): boolean {
  if (filter === 'any') return true;
  if (filter === 'stable') return reliability === 'stable';
  return reliability !== 'stable';
}

const KIND_ORDER: Record<ObligationKind, number> = { mortgage: 0, annual: 1, deal: 2, monthly_expense: 3, living: 4, living_flexible: 5 };

/** Обязательные платежи на горизонте: ипотека, ежегодные расходы, расходы сделки, жизнь. */
export function buildObligations(input: AllocationInput): Obligation[] {
  const { today, settings } = input;
  const horizonEnd = endOfMonth(addMonths(today, input.horizonMonths));
  const obligations: Obligation[] = [];

  // ипотека (несколько кредитов — отдельные обязательства, одно окно накопления)
  for (const s of input.schedules) {
    // окно накопления первого платежа начинается сегодня включительно: сегодняшняя зарплата тоже идёт в дело
    let prev = addDays(today, -1);
    for (const r of s.rows) {
      if (r.kind !== 'payment') continue;
      if (r.date < today) {
        prev = r.date;
        continue;
      }
      if (r.date > horizonEnd) break;
      // доплата до прежней суммы и ежемесячные досрочки платятся вместе с платежом из стабильных денег
      const monthlyExtra = Math.min(monthlyPrepaymentOn(input.prepayments, s.loanId, r.date), r.prepaymentKop - r.keepExtraKop);
      const amount = r.paymentKop + r.keepExtraKop + Math.max(0, monthlyExtra);
      obligations.push({
        id: `mort:${s.loanId}:${r.date}`,
        kind: 'mortgage',
        accountKind: 'mortgage',
        label: 'Платёж по ипотеке',
        dueDate: r.date,
        windowStart: maxDate(today, addDays(prev, 1)),
        amountKop: amount,
        refId: s.loanId,
      });
      prev = r.date;
    }
  }

  // расходы: ежегодные — в резерв, разовые неоплаченные — расходы сделки, ежемесячные — жизнь
  for (const occ of expandExpenses(input.expenses, today, horizonEnd, input.expenseContext)) {
    if (occ.paid) continue;
    if (occ.recurrence === 'yearly') {
      const windowStart = settings.annualReserveEnabled ? maxDate(today, addDays(addMonths(occ.date, -12), 1)) : maxDate(today, startOfMonth(occ.date));
      obligations.push({
        id: `exp:${occ.expenseId}:${occ.date}`,
        kind: 'annual',
        accountKind: settings.annualReserveEnabled ? 'annual_reserve' : 'life',
        label: occ.name,
        dueDate: occ.date,
        windowStart,
        amountKop: occ.amountKop,
        refId: occ.expenseId,
      });
    } else if (occ.recurrence === 'monthly') {
      obligations.push({
        id: `exp:${occ.expenseId}:${occ.date}`,
        kind: 'monthly_expense',
        accountKind: 'life',
        label: occ.name,
        dueDate: occ.date,
        windowStart: maxDate(today, startOfMonth(occ.date)),
        amountKop: occ.amountKop,
        refId: occ.expenseId,
      });
    } else if (occ.category !== 'after_keys') {
      obligations.push({
        id: `exp:${occ.expenseId}:${occ.date}`,
        kind: 'deal',
        accountKind: 'deal',
        label: occ.name,
        dueDate: occ.date,
        windowStart: today,
        amountKop: occ.amountKop,
        refId: occ.expenseId,
      });
    }
  }

  // траты на жизнь — каждый месяц: обязательные и необязательные отдельно
  for (let k = 0; k <= input.horizonMonths; k++) {
    const monthStart = startOfMonth(addMonths(today, k));
    for (const [kind, filter, suffix, label] of [
      ['living', 'essential', '', 'Жизнь'],
      ['living_flexible', 'flexible', ':flex', 'Жизнь: необязательное'],
    ] as const) {
      const amount = livingMonthlyAt(input.living, monthStart, input.expenseContext, filter);
      if (amount <= 0) continue;
      const total = k === 0 ? proRate(amount, today) : amount;
      const cats = input.living.filter(
        (l) => l.amountKop > 0 && livingActiveOn(l, monthStart, input.expenseContext) && (filter === 'essential' ? l.essential !== false : l.essential === false),
      );
      const shares = splitKop(total, cats.map((c) => c.amountKop));
      obligations.push({
        id: `living:${monthKey(monthStart)}${suffix}`,
        kind,
        accountKind: 'life',
        label,
        dueDate: endOfMonth(monthStart),
        windowStart: maxDate(today, monthStart),
        amountKop: total,
        parts: cats.map((c, i) => ({ name: c.name, amountKop: shares[i]! })),
      });
    }
  }

  return obligations.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));
}

/** Остаток месяца пропорционально дням (для текущего месяца). */
function proRate(amount: Kop, today: IsoDate): Kop {
  const start = startOfMonth(today);
  const end = endOfMonth(today);
  const total = Number(end.slice(8)) - Number(start.slice(8)) + 1;
  const left = Number(end.slice(8)) - Number(today.slice(8)) + 1;
  return Math.round((amount * left) / total);
}

function monthlyPrepaymentOn(prepayments: readonly PrepaymentInput[], loanId: string, date: IsoDate): Kop {
  return prepayments
    .filter((p) => p.loanId === loanId && p.kind === 'monthly' && (p.startDate ?? '0000') <= date && (!p.endDate || p.endDate >= date))
    .reduce((s, p) => s + p.amountKop, 0);
}

/** Среднемесячные обязательные расходы на ближайшие 12 месяцев. */
export function monthlyObligatory(obligations: readonly Obligation[], today: IsoDate): Kop {
  const end = addMonths(today, 12);
  const total = obligations
    .filter((o) => o.kind !== 'deal' && o.kind !== 'living_flexible' && o.dueDate >= today && o.dueDate < end)
    .reduce((s, o) => s + o.amountKop, 0);
  return Math.round(total / 12);
}

/**
 * Календарь распределения: для каждого поступления — сколько и на какой счёт перевести.
 *
 * 1. Обязательные платежи (ипотека, ежегодные, расходы сделки, жизнь) копятся пропорционально
 *    поступлениям в своём окне: к дате платежа на счёте будет нужная сумма. По умолчанию — только из стабильных денег.
 * 2. Остаток распределяется по целям в порядке приоритета.
 * 3. Нехватку к дате платежа покрываем из подушки и показываем как дефицит.
 */
export function buildAllocation(input: AllocationInput): AllocationResult {
  const { today, settings } = input;
  const obligations = buildObligations(input);
  const monthlyObl = monthlyObligatory(obligations, today);

  // счета: при отсутствии нужного вида создаём виртуальный
  const accounts = [...input.accounts];
  const byKind = (kind: AccountKind): AccountInput => {
    let acc = accounts.find((a) => a.kind === kind);
    if (!acc) {
      acc = { id: `virtual:${kind}`, kind, name: ACCOUNT_LABELS[kind], balanceKop: 0 };
      accounts.push(acc);
    }
    return acc;
  };
  const balance: Record<string, Kop> = {};
  for (const a of accounts) balance[a.id] = a.balanceKop;
  const ensure = (a: AccountInput) => {
    if (balance[a.id] === undefined) balance[a.id] = a.balanceKop;
    return a;
  };

  const obligationSources: SourceFilter = settings.useUnstableForObligations ? 'any' : 'stable';
  const events = input.incomeEvents
    .filter((e) => e.date >= today && e.date <= endOfMonth(addMonths(today, input.horizonMonths)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.reliability === 'stable' ? 0 : 1) - (b.reliability === 'stable' ? 0 : 1)));

  // нужно накопить по каждому обязательству; деньги, уже лежащие на счёте, идут на ближайшие платежи
  const need = new Map<string, Kop>();
  const prefundLeft: Record<string, Kop> = { ...balance };
  for (const o of obligations) {
    const acc = ensure(byKind(o.accountKind));
    const pre = Math.min(prefundLeft[acc.id] ?? 0, o.amountKop);
    prefundLeft[acc.id] = (prefundLeft[acc.id] ?? 0) - pre;
    need.set(o.id, o.amountKop - pre);
  }
  // веса оставшихся подходящих поступлений в окне каждого обязательства
  const remainingWeight = new Map<string, Kop>();
  const eligibleCount = new Map<string, number>();
  for (const o of obligations) {
    let w = 0;
    let c = 0;
    for (const e of events) {
      if (e.date < o.windowStart || e.date > o.dueDate) continue;
      if (!sourceOk(obligationSources, e.reliability)) continue;
      w += e.amountKop;
      c++;
    }
    remainingWeight.set(o.id, w);
    eligibleCount.set(o.id, c);
  }

  const cushion = ensure(byKind('cushion'));
  const setup = ensure(byKind('setup'));
  const prepay = ensure(byKind('prepayment'));
  const life = ensure(byKind('life'));
  const afterKeys = input.expenses.filter((e) => e.category === 'after_keys' && (e.factKop === undefined || e.factKop === null));
  const prioritySetupTarget = afterKeys.filter((e) => (e.priority ?? 2) === 1).reduce((s, e) => s + e.planKop, 0);
  const setupTarget = afterKeys.reduce((s, e) => s + e.planKop, 0);
  const goalTargetKop = (step: GoalStep): { account: AccountInput; target: Kop | null } => {
    switch (step.target) {
      case 'min_cushion':
        return { account: cushion, target: monthlyObl * settings.minCushionMonths };
      case 'full_cushion':
        return { account: cushion, target: monthlyObl * settings.cushionMonths };
      case 'priority_setup':
        return { account: setup, target: prioritySetupTarget };
      case 'setup':
        return { account: setup, target: setupTarget };
      case 'prepayment':
        return { account: prepay, target: null };
      case 'custom': {
        const acc = accounts.find((a) => a.id === step.accountId) ?? life;
        return { account: ensure(acc), target: acc.targetKop ?? null };
      }
    }
  };
  const goalSteps = settings.steps.filter((s) => s.enabled);
  // режим «долями» работает, если хотя бы одной цели задана доля; иначе — по очереди
  const splitMode = settings.distribution === 'split' && goalSteps.some((st) => (st.sharePercent ?? 0) > 0);
  const goalReach = new Map<GoalStep, IsoDate | null>();
  const goalStart = new Map<GoalStep, IsoDate>();
  for (const s of goalSteps) {
    const { account, target } = goalTargetKop(s);
    goalReach.set(s, target !== null && (balance[account.id] ?? 0) >= target ? today : null);
  }

  const transfers: Transfer[] = [];
  const deficits: Deficit[] = [];
  const warnings: AllocationResult['warnings'] = [];
  const monthlyBalances: AllocationResult['monthlyBalances'] = [];
  let mortgageUnstableShareKop = 0;

  const oneOffPrepayments = input.prepayments
    .filter((p) => p.kind === 'one_off' && p.date && p.date >= today)
    .sort((a, b) => (a.date! < b.date! ? -1 : 1));

  let oblCursor = 0;
  let prepCursor = 0;
  let evCursor = 0;
  const lastDay = endOfMonth(addMonths(today, input.horizonMonths));
  const checkGoals = (date: IsoDate) => {
    for (const s of goalSteps) {
      if (goalReach.get(s)) continue;
      const { account, target } = goalTargetKop(s);
      if (target !== null && target > 0 && (balance[account.id] ?? 0) >= target) goalReach.set(s, date);
    }
  };

  // проходим по дням, где что-то происходит
  const days = new Set<IsoDate>();
  for (const e of events) days.add(e.date);
  for (const o of obligations) days.add(o.dueDate);
  for (const p of oneOffPrepayments) days.add(p.date!);
  for (let k = 0; k <= input.horizonMonths; k++) days.add(endOfMonth(addMonths(today, k)));
  const timeline = [...days].filter((d) => d >= today && d <= lastDay).sort();

  for (const day of timeline) {
    // 1. поступления этого дня
    while (evCursor < events.length && events[evCursor]!.date === day) {
      const e = events[evCursor++]!;
      let cap = e.amountKop;
      const lines: AllocationLine[] = [];
      const add = (acc: AccountInput, amount: Kop, purpose: AllocationLine['purpose'], label: string, obligationId?: string) => {
        if (amount <= 0) return;
        balance[acc.id] = (balance[acc.id] ?? 0) + amount;
        const existing = lines.find((l) => l.accountId === acc.id && l.purpose === purpose && purpose !== 'obligation');
        if (existing) existing.amountKop += amount;
        else lines.push({ accountId: acc.id, accountKind: acc.kind, amountKop: amount, purpose, label, ...(obligationId ? { obligationId } : {}) });
      };
      /** Строка с детализацией: сумма делится по частям обязательства пропорционально. */
      const addParts = (acc: AccountInput, amount: Kop, o: Obligation) => {
        add(acc, amount, 'obligation', o.label, o.id);
        if (!o.parts?.length || amount <= 0) return;
        const line = lines[lines.length - 1]!;
        const shares = splitKop(amount, o.parts.map((p) => p.amountKop));
        line.parts = o.parts.map((p, i) => ({ name: p.name, amountKop: shares[i]! })).filter((p) => p.amountKop > 0);
      };

      const eligible = sourceOk(obligationSources, e.reliability);
      for (let k = oblCursor; k < obligations.length; k++) {
        const o = obligations[k]!;
        if (o.windowStart > day) continue;
        if (o.dueDate < day) continue;
        if (!eligible) continue;
        const left = need.get(o.id) ?? 0;
        const weight = remainingWeight.get(o.id) ?? 0;
        const count = eligibleCount.get(o.id) ?? 0;
        remainingWeight.set(o.id, weight - e.amountKop);
        eligibleCount.set(o.id, count - 1);
        if (left <= 0 || cap <= 0) continue;
        const share = count <= 1 || weight <= e.amountKop ? left : Math.ceil((left * e.amountKop) / weight);
        const amount = Math.min(share, left, cap);
        need.set(o.id, left - amount);
        cap -= amount;
        addParts(ensure(byKind(o.accountKind)), amount, o);
      }

      const give = (st: GoalStep, account: AccountInput, amount: Kop) => {
        if (amount <= 0) return;
        cap -= amount;
        if (!goalStart.has(st)) goalStart.set(st, e.date);
        add(account, amount, 'goal', goalLabel(st, account));
      };
      const roomOf = (st: GoalStep) => {
        const { account, target } = goalTargetKop(st);
        return { account, room: target === null ? Infinity : Math.max(0, target - (balance[account.id] ?? 0)) };
      };
      if (splitMode) {
        // долями: делим остаток между незаполненными целями; что не влезло в собранную цель — делим заново
        for (let guard = 0; cap > 0 && guard < goalSteps.length + 1; guard++) {
          const active = goalSteps.filter((st) => (st.sharePercent ?? 0) > 0 && sourceOk(st.sources, e.reliability) && roomOf(st).room > 0);
          if (!active.length) break;
          const pool = cap;
          const shares = splitKop(pool, active.map((st) => st.sharePercent ?? 0));
          active.forEach((st, i) => {
            const { account, room } = roomOf(st);
            give(st, account, Math.min(shares[i]!, room));
          });
          if (cap === pool) break;
        }
      } else {
        for (const st of goalSteps) {
          if (cap <= 0) break;
          if (!sourceOk(st.sources, e.reliability)) continue;
          const { account, room } = roomOf(st);
          give(st, account, Math.min(room, cap));
        }
      }
      if (cap > 0) add(life, cap, 'free', 'Свободные деньги');
      transfers.push({ date: e.date, incomeId: e.incomeId, incomeName: e.name, incomeAmountKop: e.amountKop, reliability: e.reliability, lines });
      checkGoals(day);
    }

    // 2. платежи этого дня
    while (oblCursor < obligations.length && obligations[oblCursor]!.dueDate <= day) {
      const o = obligations[oblCursor++]!;
      const acc = ensure(byKind(o.accountKind));
      const left = need.get(o.id) ?? 0;
      balance[acc.id] = (balance[acc.id] ?? 0) - (o.amountKop - left);
      if (left > 0) {
        const fromCushion = Math.max(0, Math.min(left, balance[cushion.id] ?? 0));
        balance[cushion.id] = (balance[cushion.id] ?? 0) - fromCushion;
        deficits.push({
          date: o.dueDate,
          obligationId: o.id,
          kind: o.kind,
          label: o.label,
          shortfallKop: left,
          coveredFromCushionKop: fromCushion,
          uncoveredKop: left - fromCushion,
        });
        if (o.kind === 'mortgage') mortgageUnstableShareKop = Math.max(mortgageUnstableShareKop, left);
        need.set(o.id, 0);
      }
    }

    // 3. разовые досрочки со счёта «Досрочка»
    while (prepCursor < oneOffPrepayments.length && oneOffPrepayments[prepCursor]!.date! <= day) {
      const p = oneOffPrepayments[prepCursor++]!;
      const available = balance[prepay.id] ?? 0;
      if (available < p.amountKop) {
        warnings.push({
          code: 'prepayment_underfunded',
          date: p.date!,
          amountKop: p.amountKop - Math.max(0, available),
          message: 'К дате досрочки на счёте «Досрочка» не хватает денег.',
        });
      }
      balance[prepay.id] = available - p.amountKop;
    }

    if (day === endOfMonth(day)) {
      checkGoals(day);
      monthlyBalances.push({ month: monthKey(day), balances: { ...balance } });
    }
  }

  if (mortgageUnstableShareKop > 0) {
    warnings.push({
      code: 'mortgage_from_unstable',
      date: today,
      amountKop: mortgageUnstableShareKop,
      message: 'Стабильных доходов не хватает на ежемесячный платёж по ипотеке.',
    });
  }

  const goals: GoalProgress[] = goalSteps.map((s) => {
    const { account, target } = goalTargetKop(s);
    return {
      target: s.target,
      accountId: account.id,
      targetKop: target,
      currentKop: account.balanceKop,
      reachDate: goalReach.get(s) ?? null,
      startDate: goalStart.get(s) ?? null,
    };
  });

  return { transfers, deficits, obligations, monthlyBalances, goals, monthlyObligatoryKop: monthlyObl, accounts, warnings, mortgageUnstableShareKop };
}

function goalLabel(step: GoalStep, account: AccountInput): string {
  switch (step.target) {
    case 'min_cushion':
      return 'Подушка (минимум)';
    case 'full_cushion':
      return 'Подушка';
    case 'priority_setup':
      return 'Обустройство: самое нужное';
    case 'setup':
      return 'Обустройство';
    case 'prepayment':
      return 'Досрочка';
    case 'custom':
      return account.name;
  }
}

export function transfersInRange(result: AllocationResult, from: IsoDate, to: IsoDate): Transfer[] {
  return result.transfers.filter((t) => t.date >= from && t.date <= to);
}

/** Когда цель «подушка» (полная) будет собрана. */
export function monthsUntil(today: IsoDate, date: IsoDate | null): number | null {
  return date ? Math.max(0, monthsBetween(today, date)) : null;
}
