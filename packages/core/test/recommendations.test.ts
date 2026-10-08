import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  buildSchedule,
  compareModes,
  consumerLoanOverpay,
  evaluate,
  FACT_DESCRIPTIONS,
  monthsCovered,
  type PlanInput,
  prepaymentTimingEffect,
  referencedFacts,
  renderTemplate,
  rub,
  validateRule,
} from '../src/index.js';
import { quietFamily, STARTER_RULES, TODAY, withAccount, withLoan } from './fixtures.js';

const keys = (input: PlanInput) => buildPlan(input).recommendations.map((r) => r.ruleKey);
const rec = (input: PlanInput, key: string) => buildPlan(input).recommendations.find((r) => r.ruleKey === key);

describe('JSON-Logic', () => {
  const facts = { a: 5, b: 10, flag: true, empty: null };
  it('сравнения, логика, арифметика', () => {
    expect(evaluate({ '<': [{ fact: 'a' }, { fact: 'b' }] }, facts)).toBe(true);
    expect(evaluate({ and: [{ fact: 'flag' }, { '>=': [{ fact: 'a' }, 5] }] }, facts)).toBe(true);
    expect(evaluate({ '+': [{ fact: 'a' }, { '*': [2, 3] }] }, facts)).toBe(11);
    expect(evaluate({ '!': { fact: 'flag' } }, facts)).toBe(false);
    expect(evaluate({ if: [{ fact: 'flag' }, 'yes', 'no'] }, facts)).toBe('yes');
  });
  it('null в сравнении — ложь, а не ошибка', () => {
    expect(evaluate({ '<': [{ fact: 'empty' }, 3] }, facts)).toBe(false);
    expect(evaluate({ '>': [{ fact: 'empty' }, 3] }, facts)).toBe(false);
  });
  it('неизвестный факт или операция — ошибка', () => {
    expect(() => evaluate({ fact: 'nope' }, facts)).toThrow(/Unknown fact/);
    expect(() => evaluate({ eval: ['x'] }, facts)).toThrow(/Unsupported/);
  });
  it('находит упомянутые факты', () => {
    expect([...referencedFacts({ and: [{ fact: 'a' }, { '<': [{ var: 'b' }, 1] }] })]).toEqual(['a', 'b']);
  });
  it('шаблон текста с форматированием', () => {
    const t = renderTemplate('{{fact.m|months}}, {{effect.valueKop|rub}}, {{effect.details.p|percent}}', { m: 2.5 }, { valueKop: 12_345_678, details: { p: 45.67 }, formula: '' });
    expect(t).toBe('2,5 месяца, 123 457 ₽, 45,7%');
  });
});

describe('стартовый набор правил', () => {
  it('все правила валидны: факты, калькуляторы, источники, дата проверки', () => {
    const known = Object.keys(FACT_DESCRIPTIONS);
    for (const rule of STARTER_RULES) expect({ key: rule.key, errors: validateRule(rule, known) }).toEqual({ key: rule.key, errors: [] });
  });

  it('ключи уникальны', () => {
    const k = STARTER_RULES.map((r) => r.key);
    expect(new Set(k).size).toBe(k.length);
  });

  it('в «спокойной» семье ни одно правило не срабатывает', () => {
    expect(keys(quietFamily())).toEqual([]);
  });

  it('тексты без пугающих формулировок и давления', () => {
    const banned = /срочно|немедленно|катастроф|опасно|вы потеряете всё|обязательно сделайте|!/i;
    for (const r of STARTER_RULES) expect(`${r.title} ${r.text}`).not.toMatch(banned);
  });
});

describe('правило: подушка меньше 3 месяцев', () => {
  const input = withAccount(quietFamily(), 'cushion', rub(300_000));
  it('срабатывает и считает, на сколько месяцев хватит', () => {
    const plan = buildPlan(input);
    const r = plan.recommendations.find((x) => x.ruleKey === 'cushion_low')!;
    expect(r).toBeDefined();
    expect(r.effect!.months).toBe(monthsCovered(rub(300_000), plan.cushion.monthlyObligatoryKop));
    expect(r.effect!.details.missingToMinKop).toBe(plan.cushion.monthlyObligatoryKop * 3 - rub(300_000));
    expect(r.text).toContain('месяц');
    expect(r.explanation.facts).toHaveProperty('cushionMonths');
  });
  it('не срабатывает при подушке от 3 месяцев', () => {
    const plan = buildPlan(quietFamily());
    const enough = plan.cushion.monthlyObligatoryKop * 3;
    expect(keys(withAccount(quietFamily(), 'cushion', enough))).not.toContain('cushion_low');
  });
});

describe('правило: досрочка при несобранной подушке', () => {
  const prepay = (input: PlanInput): PlanInput => ({
    ...input,
    prepaymentScenarios: [
      { id: 'sc', name: 'Основной', isActive: true, prepayments: [{ id: 'p1', loanId: 'loan_main', kind: 'one_off', amountKop: rub(200_000), date: '2026-10-15', mode: 'reduce_term' }] },
    ],
  });
  it('срабатывает и показывает сумму досрочки', () => {
    const r = rec(prepay(withAccount(quietFamily(), 'cushion', rub(800_000))), 'prepayment_before_cushion')!;
    expect(r).toBeDefined();
    expect(r.effect!.valueKop).toBe(rub(200_000));
    expect(r.text).toContain('обратно не забрать');
  });
  it('срабатывает, если в порядке целей досрочка стоит раньше подушки', () => {
    const base = withAccount(quietFamily(), 'cushion', rub(800_000));
    const input: PlanInput = {
      ...base,
      settings: { ...base.settings, allocation: { ...base.settings.allocation, steps: [{ target: 'prepayment', sources: 'any', enabled: true }, { target: 'full_cushion', sources: 'any', enabled: true }] } },
    };
    expect(rec(input, 'prepayment_before_cushion')!.effect!.valueKop).toBeGreaterThan(0);
  });
  it('не срабатывает при собранной подушке', () => {
    expect(keys(prepay(quietFamily()))).not.toContain('prepayment_before_cushion');
  });
});

describe('правило: высокая нагрузка по кредитам', () => {
  const heavy = withLoan(quietFamily(), { principalKop: rub(10_315_920), termMonths: 120, issueDate: '2021-06-15' });
  it('срабатывает при платеже ≥ 45% стабильного дохода и считает стресс-тест', () => {
    const plan = buildPlan(heavy);
    const r = plan.recommendations.find((x) => x.ruleKey === 'high_debt_load')!;
    expect(plan.facts.dtiPercent).toBeCloseTo(49.4, 1);
    expect(r.effect!.details.incomeName).toBe('Зарплата Ивана');
    expect(r.effect!.months).toBeGreaterThan(0);
  });
  it('не срабатывает при нагрузке ниже порога', () => {
    const plan = buildPlan(quietFamily());
    expect(Number(plan.facts.dtiPercent)).toBeLessThan(45);
    expect(plan.recommendations.map((r) => r.ruleKey)).not.toContain('high_debt_load');
  });
});

describe('правило: ипотека из нестабильного дохода', () => {
  const input = quietFamily({
    incomes: [
      { id: 'inc_ivan', name: 'Зарплата Ивана', type: 'salary', amountKop: rub(60_000), periodicity: 'monthly', dayOfMonth: 10, reliability: 'stable' },
      { id: 'inc_bonus', name: 'Премия', type: 'bonus', amountKop: rub(300_000), periodicity: 'monthly', dayOfMonth: 20, reliability: 'unstable' },
    ],
  });
  it('срабатывает и показывает нехватку стабильных денег', () => {
    const plan = buildPlan(input);
    const r = plan.recommendations.find((x) => x.ruleKey === 'mortgage_from_unstable')!;
    expect(r.effect!.valueKop).toBe(plan.allocation.mortgageUnstableShareKop);
    expect(r.effect!.valueKop).toBeGreaterThan(0);
  });
  it('не срабатывает, если зарплаты хватает', () => {
    expect(keys(quietFamily())).not.toContain('mortgage_from_unstable');
  });
});

describe('правило: досрочка с уменьшением платежа', () => {
  const withMode = (mode: 'reduce_payment' | 'reduce_term') =>
    quietFamily({
      prepaymentScenarios: [
        { id: 'sc', name: 'Основной', isActive: true, prepayments: [{ id: 'p1', loanId: 'loan_main', kind: 'one_off', amountKop: rub(300_000), date: '2026-11-15', mode }] },
      ],
    });
  it('срабатывает и считает разницу с сокращением срока', () => {
    const input = withMode('reduce_payment');
    const r = rec(input, 'reduce_payment_mode')!;
    const cmp = compareModes(input.loans[0]!, input.prepaymentScenarios[0]!.prepayments);
    expect(r.effect!.valueKop).toBe(cmp.reduceTerm.savingsKop - cmp.reducePayment.savingsKop);
    expect(r.effect!.details.keepAmountSavingsKop).toBe(cmp.reducePaymentKeepAmount.savingsKop);
    expect(r.effect!.valueKop).toBeGreaterThan(0);
  });
  it('не срабатывает при сокращении срока', () => {
    expect(keys(withMode('reduce_term'))).not.toContain('reduce_payment_mode');
  });
});

describe('правило: ранняя досрочка выгоднее поздней', () => {
  const young = withLoan(quietFamily(), { issueDate: '2026-06-15' });
  it('срабатывает в первые 5 лет кредита и сравнивает «сейчас» и «через 5 лет»', () => {
    const plan = buildPlan(young);
    const r = plan.recommendations.find((x) => x.ruleKey === 'early_prepayment')!;
    const d = r.effect!.details;
    expect(Number(d.savingsNowKop)).toBeGreaterThan(Number(d.savingsLaterKop));
    const [now, later] = prepaymentTimingEffect(young.loans[0]!, Number(d.amountKop), ['2026-10-08', '2031-10-08']);
    expect(d.savingsNowKop).toBe(now!.savingsKop);
    expect(d.savingsLaterKop).toBe(later!.savingsKop);
  });
  it('не срабатывает, если подушка не собрана или кредиту больше 5 лет', () => {
    expect(keys(quietFamily())).not.toContain('early_prepayment');
    expect(keys(withAccount(young, 'cushion', rub(100_000)))).not.toContain('early_prepayment');
  });
});

describe('правило: ставка вклада и ставка кредита', () => {
  const withDeposit = (input: PlanInput, rate: string): PlanInput => ({ ...input, settings: { ...input.settings, depositRatePercent: rate } });
  it('вклад после налога ниже ставки кредита — досрочка выгоднее', () => {
    const plan = buildPlan(withDeposit(quietFamily(), '10'));
    const r = plan.recommendations.find((x) => x.ruleKey === 'deposit_lower_than_loan')!;
    expect(plan.facts.depositNetRatePercent).toBe(8.7);
    const amount = Number(r.effect!.details.amountKop);
    expect(r.effect!.valueKop).toBe(Math.round((amount * 7.3) / 100));
    expect(plan.recommendations.map((x) => x.ruleKey)).not.toContain('deposit_higher_than_loan');
  });
  it('вклад выгоднее льготной ставки — наоборот', () => {
    const plan = buildPlan(withDeposit(withLoan(quietFamily(), { annualRate: '6' }), '12'));
    const ks = plan.recommendations.map((x) => x.ruleKey);
    expect(ks).toContain('deposit_higher_than_loan');
    expect(ks).not.toContain('deposit_lower_than_loan');
  });
  it('без ставки вклада — ни одно', () => {
    const ks = keys(quietFamily());
    expect(ks).not.toContain('deposit_lower_than_loan');
    expect(ks).not.toContain('deposit_higher_than_loan');
  });
});

describe('правило: вычет не оформлен', () => {
  const withMembers = (claimed: boolean) =>
    quietFamily({
      taxMembers: ['Иван', 'Мария'].map((name, i) => ({
        memberId: `m${i}`,
        name,
        annualTaxableIncomeKop: rub(2_000_000),
        ndflRatePercent: '13',
        propertyDeductionUsedKop: 0,
        interestDeductionUsed: false,
        costSharePercent: '50',
        interestSharePercent: '50',
        claimed,
      })),
    });
  it('срабатывает и считает возврат на обоих супругов', () => {
    const plan = buildPlan(withMembers(false));
    const r = plan.recommendations.find((x) => x.ruleKey === 'tax_deduction_unclaimed')!;
    expect(r.effect!.valueKop).toBe(plan.tax.unclaimedKop);
    expect(r.effect!.details.propertyKop).toBe(rub(520_000)); // 7 млн пополам → по 2 млн базы на каждого
    expect(String(r.effect!.details.perMember)).toContain('Мария');
  });
  it('не срабатывает, если вычет оформлен', () => {
    expect(keys(withMembers(true))).not.toContain('tax_deduction_unclaimed');
  });
});

describe('правило: продление страховки', () => {
  const lifeInsurance = (date: string) =>
    quietFamily({
      expenses: [
        ...quietFamily().expenses,
        { id: 'life', name: 'Страхование жизни', category: 'optional', planKop: rub(30_000), recurrence: 'yearly', date },
      ],
    });
  it('срабатывает за 45 дней и выше в списке из-за срочности', () => {
    const r = rec(lifeInsurance('2025-11-01'), 'insurance_renewal')!;
    expect(r.urgencyDays).toBe(24);
    expect(r.text).toContain('24');
    expect(r.text).toContain('других страховщиков');
  });
  it('не срабатывает, если до продления далеко', () => {
    expect(keys(lifeInsurance('2026-03-01'))).not.toContain('insurance_renewal');
  });
});

describe('правило: рефинансирование', () => {
  const market = (rate: string) => ({ ...quietFamily(), settings: { ...quietFamily().settings, marketRatePercent: rate, refinanceCostsKop: rub(50_000) } });
  it('срабатывает при разнице от 2 п.п. и считает выгоду за вычетом расходов', () => {
    const plan = buildPlan(market('12'));
    const r = plan.recommendations.find((x) => x.ruleKey === 'refinance_check')!;
    const loan = plan.loans[0]!;
    const remaining = loan.schedule.rows.filter((x) => x.date > TODAY).length;
    const cur = buildSchedule({ id: 'a', principalKop: loan.currentBalanceKop, annualRate: '16', termMonths: remaining, type: 'annuity', issueDate: TODAY });
    const ref = buildSchedule({ id: 'b', principalKop: loan.currentBalanceKop, annualRate: '12', termMonths: remaining, type: 'annuity', issueDate: TODAY });
    expect(r.effect!.valueKop).toBe(cur.summary.totalInterestKop - ref.summary.totalInterestKop - rub(50_000));
  });
  it('не срабатывает при разнице меньше 2 п.п.', () => {
    expect(keys(market('15'))).not.toContain('refinance_check');
  });
});

describe('правило: покупки в кредит при ипотеке', () => {
  const sofa = (rate: string) =>
    quietFamily({
      expenses: [
        ...quietFamily().expenses,
        { id: 'sofa', name: 'Диван', category: 'after_keys', planKop: rub(150_000), recurrence: 'once', priority: 2, credit: { annualRate: rate, months: 12 } },
      ],
    });
  it('срабатывает и считает переплату', () => {
    const r = rec(sofa('20'), 'credit_purchases')!;
    expect(r.effect!.valueKop).toBe(consumerLoanOverpay(rub(150_000), '20', 12));
    expect(r.effect!.details.monthlySaveKop).toBe(rub(12_500));
  });
  it('рассрочка без переплаты — не срабатывает', () => {
    expect(keys(sofa('0'))).not.toContain('credit_purchases');
  });
});

describe('правило: задаток до одобрения', () => {
  const deposit = (approval: 'todo' | 'done') =>
    quietFamily({
      stages: [{ id: 'st', templateKey: 'bank_approval', title: 'Одобрение', status: approval, plannedDate: '2026-11-01', actualDate: approval === 'done' ? '2026-10-01' : null }],
      expenses: [{ id: 'dep', name: 'Задаток', category: 'mandatory', catalogKey: 'seller_deposit', planKop: rub(100_000), recurrence: 'once', date: '2026-10-20' }],
    });
  it('срабатывает и показывает сумму риска', () => {
    const r = rec(deposit('todo'), 'seller_deposit_before_approval')!;
    expect(r.severity).toBe('important');
    expect(r.effect!.valueKop).toBe(rub(100_000));
  });
  it('не срабатывает после одобрения', () => {
    expect(keys(deposit('done'))).not.toContain('seller_deposit_before_approval');
  });
});

describe('правило: ежегодные платежи без резерва', () => {
  it('срабатывает и делит сумму на 12', () => {
    const base = quietFamily();
    const input = { ...base, settings: { ...base.settings, allocation: { ...base.settings.allocation, annualReserveEnabled: false } } };
    const plan = buildPlan(input);
    const r = plan.recommendations.find((x) => x.ruleKey === 'annual_without_reserve')!;
    const yearly = Number(r.effect!.details.yearlyKop);
    expect(yearly).toBeGreaterThan(0);
    expect(r.effect!.details.monthlyKop).toBe(Math.ceil(yearly / 12));
  });
  it('не срабатывает при включённом резерве', () => {
    expect(keys(quietFamily())).not.toContain('annual_without_reserve');
  });
});

describe('правило: освободились деньги', () => {
  it('аренда закончилась после переезда', () => {
    const input = quietFamily({
      scenario: { ...quietFamily().scenario, keysDate: '2026-09-20' },
      living: [...quietFamily().living, { id: 'rent', name: 'Аренда', amountKop: rub(40_000), kind: 'rent', endsAtKeys: true }],
    });
    const r = rec(input, 'freed_money')!;
    expect(r.effect!.details.monthlyKop).toBe(rub(40_000));
    expect(r.effect!.valueKop).toBe(rub(480_000));
    expect(Number(r.effect!.details.prepaySavingsKop)).toBeGreaterThan(0);
  });
  it('выросла зарплата', () => {
    const base = quietFamily();
    const input = { ...base, incomes: base.incomes.map((i, k) => (k === 0 ? { ...i, previousAmountKop: rub(180_000), changedAt: '2026-09-01' } : i)) };
    expect(rec(input, 'freed_money')!.effect!.details.monthlyKop).toBe(rub(20_000));
  });
  it('давнее изменение не считается', () => {
    const base = quietFamily();
    const input = { ...base, incomes: base.incomes.map((i, k) => (k === 0 ? { ...i, previousAmountKop: rub(180_000), changedAt: '2026-01-01' } : i)) };
    expect(keys(input)).not.toContain('freed_money');
  });
});

describe('движок', () => {
  const input = withAccount(quietFamily({ settings: { ...quietFamily().settings, depositRatePercent: '10' } }), 'cushion', rub(300_000));

  it('сортирует по важности, эффекту и срочности', () => {
    const recs = buildPlan(input).recommendations;
    expect(recs[0]!.ruleKey).toBe('cushion_low');
    for (let i = 1; i < recs.length; i++) expect(recs[i]!.score).toBeLessThanOrEqual(recs[i - 1]!.score);
  });

  it('скрытая рекомендация не показывается, пока ситуация не изменилась', () => {
    const first = rec(input, 'cushion_low')!;
    const dismissed = { ...input, recommendationStates: [{ ruleKey: 'cushion_low', status: 'dismissed' as const, fingerprint: first.fingerprint }] };
    expect(keys(dismissed)).not.toContain('cushion_low');
    const changed = withAccount(dismissed, 'cushion', rub(10_000));
    expect(keys(changed)).toContain('cushion_low');
  });

  it('отложенная — до указанной даты', () => {
    const snoozed = { ...input, recommendationStates: [{ ruleKey: 'cushion_low', status: 'snoozed' as const, until: '2026-11-01' }] };
    expect(keys(snoozed)).not.toContain('cushion_low');
    expect(keys({ ...snoozed, today: '2026-11-02' })).toContain('cushion_low');
  });

  it('берётся последняя версия правила, выключенные игнорируются', () => {
    const rule = STARTER_RULES.find((r) => r.key === 'cushion_low')!;
    const v2 = { ...rule, version: 2, title: 'Новая формулировка' };
    expect(rec({ ...input, rules: [rule, v2] }, 'cushion_low')!.title).toBe('Новая формулировка');
    expect(keys({ ...input, rules: [{ ...rule, active: false }] })).toEqual([]);
  });

  it('сломанное правило не роняет план', () => {
    const broken = { ...STARTER_RULES[0]!, key: 'broken', when: { fact: 'doesNotExist' } };
    expect(() => buildPlan({ ...input, rules: [...STARTER_RULES, broken] })).not.toThrow();
  });
});
