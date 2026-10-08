import starter from '@hypothec/content/rules/starter.json';
import {
  DEFAULT_ALLOCATION_SETTINGS,
  defaultAccounts,
  type LoanInput,
  type PlanInput,
  type RecommendationRule,
  rub,
} from '../src/index.js';

export const STARTER_RULES = (starter as unknown as { rules: RecommendationRule[] }).rules;

/** Эталонный кредит из ТЗ. */
export const REFERENCE_LOAN: LoanInput = {
  id: 'ref',
  principalKop: rub(10_315_920),
  annualRate: '16',
  termMonths: 120,
  type: 'annuity',
  issueDate: '2025-01-15',
};

export const TODAY = '2026-10-08';

/**
 * «Спокойная» семья: ни одно правило рекомендаций не срабатывает.
 * Кредит 5 млн выдан давно (2021), подушка собрана, стабильных доходов хватает, вкладов и вычетов не задано.
 */
export function quietFamily(overrides: Partial<PlanInput> = {}): PlanInput {
  const accounts = defaultAccounts().map((a) => (a.kind === 'cushion' ? { ...a, balanceKop: rub(1_500_000) } : a));
  return {
    today: TODAY,
    scenario: {
      housingType: 'secondary',
      program: 'base',
      priceKop: rub(7_000_000),
      downPaymentKop: rub(2_000_000),
      maternityCapitalKop: 0,
      keysDate: '2021-07-01',
    },
    stages: [
      { id: 'st_approval', templateKey: 'bank_approval', title: 'Одобрение ипотеки', status: 'done', plannedDate: '2021-05-01', actualDate: '2021-05-01' },
    ],
    loans: [
      {
        id: 'loan_main',
        name: 'Ипотека',
        principalKop: rub(5_000_000),
        annualRate: '16',
        termMonths: 240,
        type: 'annuity',
        issueDate: '2021-06-15',
        paymentDay: 15,
      },
    ],
    prepaymentScenarios: [{ id: 'sc_main', name: 'Основной', isActive: true, prepayments: [] }],
    incomes: [
      { id: 'inc_ivan', name: 'Зарплата Ивана', type: 'salary', amountKop: rub(200_000), periodicity: 'monthly', dayOfMonth: 10, reliability: 'stable' },
      { id: 'inc_maria', name: 'Зарплата Марии', type: 'salary', amountKop: rub(150_000), periodicity: 'monthly', dayOfMonth: 25, reliability: 'stable' },
    ],
    expenses: [
      {
        id: 'exp_property_insurance',
        name: 'Страхование залога (квартиры)',
        category: 'mandatory',
        catalogKey: 'property_insurance',
        planKop: 0,
        recurrence: 'yearly',
        date: '2021-06-15',
        loanId: 'loan_main',
        percentOfLoanBalance: '0.15',
      },
    ],
    living: [{ id: 'liv_base', name: 'Базовые траты', amountKop: rub(120_000) }],
    accounts,
    taxMembers: [],
    settings: { allocation: { ...DEFAULT_ALLOCATION_SETTINGS }, dtiWarnPercent: 45 },
    rules: STARTER_RULES,
    horizonMonths: 60,
    ...overrides,
  };
}

export function withAccount(input: PlanInput, kind: string, balanceKop: number): PlanInput {
  return { ...input, accounts: input.accounts.map((a) => (a.kind === kind ? { ...a, balanceKop } : a)) };
}

export function withLoan(input: PlanInput, patch: Partial<LoanInput>): PlanInput {
  return { ...input, loans: input.loans.map((l, i) => (i === 0 ? { ...l, ...patch } : l)) };
}
