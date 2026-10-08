import { describe, expect, it } from 'vitest';
import {
  buildInitialPlan,
  buildPlan,
  DEFAULT_ALLOCATION_SETTINGS,
  type PlanInput,
  rub,
} from '../src/index.js';
import { quietFamily, STARTER_RULES, withAccount } from './fixtures.js';

describe('пересчёт плана целиком', () => {
  it('детерминирован: одинаковый вход — одинаковый результат', () => {
    expect(JSON.stringify(buildPlan(quietFamily()))).toBe(JSON.stringify(buildPlan(quietFamily())));
  });

  it('главный экран: следующий платёж и готовность ипотечного счёта', () => {
    const plan = buildPlan(quietFamily());
    const next = plan.dashboard.nextPayment!;
    expect(next.date).toBe('2026-10-15');
    expect(next.amountKop).toBe(plan.loans[0]!.nextPayment!.paymentKop);
    expect(next.readyNow).toBe(false);
    // зарплата 10-го закроет платёж 15-го не полностью — часть приходит с зарплаты 25 сентября, которой уже нет
    expect(next.ready).toBe(next.plannedByDueKop >= next.amountKop);

    const ready = buildPlan(withAccount(quietFamily(), 'mortgage', next.amountKop));
    expect(ready.dashboard.nextPayment!.readyNow).toBe(true);
    expect(ready.dashboard.nextPayment!.shortfallKop).toBe(0);
  });

  it('досрочка в активном сценарии — экономия и новая дата закрытия на главном экране', () => {
    const input = quietFamily({
      prepaymentScenarios: [
        { id: 'a', name: 'Активный', isActive: true, prepayments: [{ id: 'p', loanId: 'loan_main', kind: 'monthly', amountKop: rub(30_000), startDate: '2026-10-15', mode: 'reduce_term' }] },
        { id: 'b', name: 'Черновик', isActive: false, prepayments: [{ id: 'q', loanId: 'loan_main', kind: 'one_off', amountKop: rub(3_000_000), date: '2026-10-15', mode: 'reduce_term' }] },
      ],
    });
    const plan = buildPlan(input);
    expect(plan.dashboard.payoff!.savingsKop).toBeGreaterThan(0);
    expect(plan.dashboard.payoff!.date < plan.dashboard.payoff!.baselineDate).toBe(true);
    // неактивный сценарий не влияет
    const only = buildPlan({ ...input, prepaymentScenarios: [input.prepaymentScenarios[0]!] });
    expect(only.dashboard.payoff).toEqual(plan.dashboard.payoff);
    // ежемесячная доплата идёт вместе с платежом на ипотечный счёт
    const oct = plan.allocation.obligations.find((o) => o.kind === 'mortgage' && o.dueDate === '2026-10-15')!;
    expect(oct.amountKop).toBe(plan.loans[0]!.nextPayment!.paymentKop + rub(30_000));
  });

  it('новый доход мгновенно меняет распределение и прогноз подушки', () => {
    const low = withAccount(quietFamily(), 'cushion', rub(100_000));
    const a = buildPlan(low);
    const b = buildPlan({
      ...low,
      incomes: [...low.incomes, { id: 'side', name: 'Подработка', type: 'self_employed', amountKop: rub(50_000), periodicity: 'monthly', dayOfMonth: 5, reliability: 'unstable' }],
    });
    expect(b.cushion.projectedFullDate! < a.cushion.projectedFullDate!).toBe(true);
  });

  it('сдвиг даты ключей двигает аренду, расходы «после ключей» и окончание найма', () => {
    const make = (keysDate: string): PlanInput =>
      quietFamily({
        scenario: { ...quietFamily().scenario, keysDate },
        incomes: [
          ...quietFamily().incomes,
          { id: 'rent_out', name: 'Сдача старой квартиры', type: 'rent', amountKop: rub(30_000), periodicity: 'monthly', dayOfMonth: 5, reliability: 'expected', startsAtKeys: true },
        ],
        living: [...quietFamily().living, { id: 'rent', name: 'Аренда', amountKop: rub(40_000), kind: 'rent', endsAtKeys: true }],
        expenses: [...quietFamily().expenses, { id: 'move', name: 'Переезд', category: 'after_keys', planKop: rub(20_000), recurrence: 'once', atKeys: true, priority: 1 }],
      });
    const early = buildPlan(make('2026-12-01'));
    const late = buildPlan(make('2027-03-01'));
    const firstRent = (p: ReturnType<typeof buildPlan>) => p.calendar.find((e) => e.type === 'income' && e.refId === 'rent_out')!.date;
    expect(firstRent(early)).toBe('2026-12-05');
    expect(firstRent(late)).toBe('2027-03-05');
    const living = (p: ReturnType<typeof buildPlan>, month: string) => p.allocation.obligations.find((o) => o.id === `living:${month}`)!.amountKop;
    expect(living(early, '2027-01')).toBe(rub(120_000));
    expect(living(late, '2027-01')).toBe(rub(160_000));
  });

  it('календарь: платежи, поступления, переводы, страховка, этапы, досрочка и напоминание о заявлении', () => {
    const input = quietFamily({
      loans: [{ ...quietFamily().loans[0]!, bankRules: { onlyOnPaymentDate: true, minAmountKop: 0, noticeDays: 30 } }],
      stages: [{ id: 'st1', templateKey: 'tax_deduction', title: 'Налоговый вычет', status: 'todo', plannedDate: '2027-02-01', actualDate: null }],
      prepaymentScenarios: [{ id: 'a', name: 'А', isActive: true, prepayments: [{ id: 'p', loanId: 'loan_main', kind: 'one_off', amountKop: rub(100_000), date: '2027-03-15', mode: 'reduce_term' }] }],
    });
    const plan = buildPlan(input);
    const types = new Set(plan.calendar.map((e) => e.type));
    for (const t of ['loan_payment', 'income', 'transfer', 'insurance', 'stage', 'prepayment', 'prepayment_notice']) expect(types).toContain(t);
    expect(plan.calendar.find((e) => e.type === 'prepayment_notice')!.date).toBe('2027-02-13');
    const ids = plan.calendar.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < plan.calendar.length; i++) expect(plan.calendar[i]!.date >= plan.calendar[i - 1]!.date).toBe(true);
  });

  it('несколько кредитов в одной семье', () => {
    const input = quietFamily({
      loans: [
        ...quietFamily().loans,
        { id: 'loan_2', name: 'Потребкредит на ремонт', principalKop: rub(500_000), annualRate: '22', termMonths: 36, type: 'differentiated', issueDate: '2026-08-01', paymentDay: 1 },
      ],
    });
    const plan = buildPlan(input);
    expect(plan.loans).toHaveLength(2);
    expect(plan.allocation.obligations.filter((o) => o.kind === 'mortgage' && o.refId === 'loan_2').length).toBeGreaterThan(0);
    expect(Number(plan.facts.monthlyLoanPaymentsKop)).toBe(plan.loans[0]!.nextPayment!.paymentKop + plan.loans[1]!.nextPayment!.paymentKop);
  });

  it('из мастера сразу получается рабочий план', () => {
    const today = '2026-10-08';
    const draft = buildInitialPlan(
      { adults: 2, children: 1, housingType: 'new_ddu', sellingOwn: false, maternityCapitalKop: 0, program: 'family', priceKop: rub(9_000_000), downPaymentKop: rub(2_000_000) },
      today,
    );
    const plan = buildPlan({
      today,
      scenario: { housingType: 'new_ddu', program: 'family', priceKop: rub(9_000_000), downPaymentKop: rub(2_000_000), maternityCapitalKop: 0, keysDate: draft.keysDate },
      stages: draft.stages.map((s) => ({ id: s.key, templateKey: s.templateKey, title: s.title, status: s.status, plannedDate: s.plannedDate, actualDate: null })),
      loans: [draft.loan],
      prepaymentScenarios: [],
      incomes: [{ id: 'sal', name: 'Зарплата', type: 'salary', amountKop: rub(250_000), periodicity: 'monthly', dayOfMonth: 10, reliability: 'stable' }],
      expenses: draft.expenses,
      living: [{ id: 'liv', name: 'Жизнь', amountKop: rub(90_000) }],
      accounts: draft.accounts,
      taxMembers: [],
      settings: { allocation: DEFAULT_ALLOCATION_SETTINGS },
      rules: STARTER_RULES,
    });
    expect(plan.loans[0]!.schedule.summary.firstPaymentKop).toBeGreaterThan(rub(40_000));
    // первый взнос и расходы сделки попадают в обязательства «Расходы сделки»
    expect(plan.allocation.obligations.some((o) => o.kind === 'deal' && o.label === 'Первоначальный взнос')).toBe(true);
    expect(plan.recommendations.length).toBeGreaterThan(0);
  });

  it('пересчёт на 10 лет укладывается в разумное время', () => {
    const input = { ...quietFamily(), horizonMonths: 120 };
    buildPlan(input);
    const t = Date.now();
    for (let i = 0; i < 5; i++) buildPlan(input);
    const avg = (Date.now() - t) / 5;
    expect(avg).toBeLessThan(400);
  });
});
