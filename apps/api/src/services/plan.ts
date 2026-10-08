import starter from '@hypothec/content/rules/starter.json' with { type: 'json' };
import {
  buildPlan,
  type AccountInput,
  type ExpenseInput,
  type HouseholdSettings,
  type IncomeInput,
  type LivingExpenseInput,
  type LoanInput,
  type PlanInput,
  type PlanResult,
  type PrepaymentInput,
  type RecommendationRule,
  type TaxMemberInput,
} from '@hypothec/core';
import { asc, eq } from 'drizzle-orm';
import { todayInMoscow } from '../config.js';
import type { Db } from '../db/client.js';
import * as s from '../db/schema.js';
import type { AppDeps } from '../deps.js';
import { DEFAULT_SETTINGS } from './households.js';

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

// ── строки БД → входные данные ядра ────────────────────────────────────
export function toLoanInput(r: Row<typeof s.loans>): LoanInput {
  return {
    id: r.id,
    name: r.name,
    principalKop: r.principalKop,
    annualRate: r.annualRate,
    termMonths: r.termMonths,
    type: r.type as LoanInput['type'],
    issueDate: r.issueDate,
    ...(r.paymentDay ? { paymentDay: r.paymentDay } : {}),
    interestMode: r.interestMode as LoanInput['interestMode'],
    rateChanges: (r.rateChanges as LoanInput['rateChanges']) ?? [],
    ...(r.bankRules ? { bankRules: r.bankRules as LoanInput['bankRules'] } : {}),
  };
}

export function toPrepaymentInput(r: Row<typeof s.prepayments>): PrepaymentInput {
  return {
    id: r.id,
    loanId: r.loanId,
    kind: r.kind as PrepaymentInput['kind'],
    amountKop: r.amountKop,
    date: opt(r.date),
    startDate: opt(r.startDate),
    endDate: opt(r.endDate),
    mode: r.mode as PrepaymentInput['mode'],
    source: r.source as PrepaymentInput['source'],
  };
}

export function toIncomeInput(r: Row<typeof s.incomes>): IncomeInput {
  return {
    id: r.id,
    name: r.name,
    type: r.type as IncomeInput['type'],
    amountKop: r.amountKop,
    periodicity: r.periodicity as IncomeInput['periodicity'],
    dayOfMonth: opt(r.dayOfMonth),
    date: opt(r.date),
    startDate: opt(r.startDate),
    endDate: opt(r.endDate),
    reliability: r.reliability as IncomeInput['reliability'],
    memberId: opt(r.memberId),
    startsAtKeys: r.startsAtKeys,
    endsAtKeys: r.endsAtKeys,
    previousAmountKop: opt(r.previousAmountKop),
    changedAt: opt(r.changedAt),
  };
}

export function toExpenseInput(r: Row<typeof s.expenses>): ExpenseInput {
  return {
    id: r.id,
    name: r.name,
    category: r.category as ExpenseInput['category'],
    catalogKey: opt(r.catalogKey),
    stageId: opt(r.stageId),
    planKop: r.planKop,
    factKop: r.factKop,
    date: r.date,
    recurrence: r.recurrence as ExpenseInput['recurrence'],
    endDate: r.endDate,
    priority: opt(r.priority) as ExpenseInput['priority'],
    loanId: r.loanId,
    percentOfLoanBalance: r.percentOfLoanBalance,
    credit: (r.credit as ExpenseInput['credit']) ?? null,
    atKeys: r.atKeys,
  };
}

export function toLivingInput(r: Row<typeof s.livingExpenses>): LivingExpenseInput {
  return {
    id: r.id,
    name: r.name,
    amountKop: r.amountKop,
    kind: (r.kind ?? undefined) as LivingExpenseInput['kind'],
    startDate: r.startDate,
    endDate: r.endDate,
    endsAtKeys: r.endsAtKeys,
    startsAtKeys: r.startsAtKeys,
  };
}

export function toAccountInput(r: Row<typeof s.accounts>): AccountInput {
  return { id: r.id, kind: r.kind as AccountInput['kind'], name: r.name, balanceKop: r.balanceKop, targetKop: r.targetKop };
}

export function settingsOf(h: Row<typeof s.households>): HouseholdSettings {
  const stored = (h.settings ?? {}) as Partial<HouseholdSettings>;
  return { ...DEFAULT_SETTINGS, ...stored, allocation: { ...DEFAULT_SETTINGS.allocation, ...(stored.allocation ?? {}) } };
}

// ── правила рекомендаций: из БД, с запасным вариантом из пакета content ──
let rulesCache: { at: number; rules: RecommendationRule[] } | null = null;
const RULES_TTL_MS = 60_000;

export async function loadRules(db: Db, now: Date): Promise<RecommendationRule[]> {
  if (rulesCache && now.getTime() - rulesCache.at < RULES_TTL_MS) return rulesCache.rules;
  const rows = await db.select().from(s.recommendationRules).where(eq(s.recommendationRules.isActive, true));
  const rules = rows.length > 0 ? rows.map((r) => r.definition as RecommendationRule) : (starter as unknown as { rules: RecommendationRule[] }).rules;
  rulesCache = { at: now.getTime(), rules };
  return rules;
}

/** Меняется при публикации правил — сбрасывает кэш пересчитанных планов. */
let rulesGeneration = 0;
export function resetRulesCache() {
  rulesCache = null;
  rulesGeneration++;
}

/** Собирает все данные семьи в вход ядра. */
export async function loadPlanInput(deps: AppDeps, householdId: string, overrides: Partial<PlanInput> = {}): Promise<{ input: PlanInput; revision: number }> {
  const { db } = deps;
  const byHousehold = <T extends { householdId: unknown }>(t: T) => eq(t.householdId as never, householdId);
  const [[household], [scenario], stageRows, loanRows, scenarioRows, prepaymentRows, incomeRows, expenseRows, livingRows, accountRows, states, rules] = await Promise.all([
    db.select().from(s.households).where(eq(s.households.id, householdId)).limit(1),
    db.select().from(s.scenarios).where(byHousehold(s.scenarios)).limit(1),
    db.select().from(s.stages).where(byHousehold(s.stages)).orderBy(asc(s.stages.sort)),
    db.select().from(s.loans).where(byHousehold(s.loans)).orderBy(asc(s.loans.createdAt)),
    db.select().from(s.prepaymentScenarios).where(byHousehold(s.prepaymentScenarios)).orderBy(asc(s.prepaymentScenarios.createdAt)),
    db.select().from(s.prepayments).where(byHousehold(s.prepayments)),
    db.select().from(s.incomes).where(byHousehold(s.incomes)).orderBy(asc(s.incomes.createdAt)),
    db.select().from(s.expenses).where(byHousehold(s.expenses)).orderBy(asc(s.expenses.createdAt)),
    db.select().from(s.livingExpenses).where(byHousehold(s.livingExpenses)),
    db.select().from(s.accounts).where(byHousehold(s.accounts)).orderBy(asc(s.accounts.sort)),
    db.select().from(s.recommendationStates).where(byHousehold(s.recommendationStates)),
    loadRules(db, deps.now()),
  ]);
  if (!household) throw new Error(`household ${householdId} not found`);

  const input: PlanInput = {
    today: todayInMoscow(deps.now()),
    scenario: scenario
      ? {
          housingType: scenario.housingType as PlanInput['scenario']['housingType'],
          program: scenario.program as PlanInput['scenario']['program'],
          priceKop: scenario.priceKop,
          downPaymentKop: scenario.downPaymentKop,
          maternityCapitalKop: scenario.maternityCapitalKop,
          keysDate: scenario.keysDate,
          rightDate: scenario.rightDate,
        }
      : { housingType: 'secondary', program: 'base', priceKop: 0, downPaymentKop: 0, maternityCapitalKop: 0, keysDate: null },
    stages: stageRows.map((r) => ({ id: r.id, templateKey: r.templateKey, title: r.title, status: r.status as 'todo', plannedDate: r.plannedDate, actualDate: r.actualDate })),
    loans: loanRows.map(toLoanInput),
    prepaymentScenarios: scenarioRows.map((sc) => ({
      id: sc.id,
      name: sc.name,
      isActive: sc.isActive,
      prepayments: prepaymentRows.filter((p) => p.scenarioId === sc.id).map(toPrepaymentInput),
    })),
    incomes: incomeRows.map(toIncomeInput),
    expenses: expenseRows.map(toExpenseInput),
    living: livingRows.map(toLivingInput),
    accounts: accountRows.map(toAccountInput),
    taxMembers: (household.taxMembers as TaxMemberInput[]) ?? [],
    settings: settingsOf(household),
    rules,
    recommendationStates: states.map((st) => ({ ruleKey: st.ruleKey, status: st.status as 'dismissed', until: st.until, fingerprint: st.fingerprint })),
    ...overrides,
  };
  return { input, revision: household.revision };
}

// ── кэш пересчёта по ревизии семьи ─────────────────────────────────────
const cache = new Map<string, { key: string; plan: PlanResult }>();
const CACHE_LIMIT = 500;

/** Пересчитанный план семьи. Пересчитывается только если данные изменились или наступил новый день. */
export async function getPlan(deps: AppDeps, householdId: string): Promise<{ plan: PlanResult; revision: number; input: PlanInput }> {
  const { input, revision } = await loadPlanInput(deps, householdId);
  const key = `${revision}:${input.today}:${rulesGeneration}`;
  const hit = cache.get(householdId);
  if (hit && hit.key === key) return { plan: hit.plan, revision, input };
  const plan = buildPlan(input);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(householdId, { key, plan });
  return { plan, revision, input };
}
