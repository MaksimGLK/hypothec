import { describe, expect, it } from 'vitest';
import {
  buildInitialPlan,
  buildSchedule,
  calculateTaxDeductions,
  type LoanInput,
  monthsCovered,
  rub,
  stressTest,
  type TaxMemberInput,
  taxRefundsToPrepayments,
  type Obligation,
  type IncomeEvent,
} from '../src/index.js';

describe('подушка', () => {
  it('месяцы покрытия округляются вниз до десятых', () => {
    expect(monthsCovered(rub(300_000), rub(200_000))).toBe(1.5);
    expect(monthsCovered(rub(299_999), rub(200_000))).toBe(1.4);
    expect(monthsCovered(0, 0)).toBe(0);
  });

  it('стресс-тест: сколько месяцев продержится подушка без дохода', () => {
    const months = ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06'];
    const incomeEvents: IncomeEvent[] = months.flatMap((m) => [
      { incomeId: 'ivan', name: 'Иван', type: 'salary', date: `${m}-10`, amountKop: rub(200_000), reliability: 'stable' },
      { incomeId: 'maria', name: 'Мария', type: 'salary', date: `${m}-25`, amountKop: rub(100_000), reliability: 'stable' },
    ]);
    const obligations: Obligation[] = months.map((m) => ({
      id: m,
      kind: 'living',
      accountKind: 'life',
      label: 'Жизнь + ипотека',
      dueDate: `${m}-28`,
      windowStart: `${m}-01`,
      amountKop: rub(250_000),
    }));
    const r = stressTest({ today: '2027-01-01', months: 6, incomeEvents, obligations, removeIncomeIds: ['ivan'], cushionKop: rub(400_000) });
    expect(r.firstDeficitMonth).toBe('2027-01');
    expect(r.monthlyGapKop).toBe(rub(150_000));
    expect(r.monthsCushionLasts).toBe(2);
    expect(r.cushionDepletedMonth).toBe('2027-03');
    const ok = stressTest({ today: '2027-01-01', months: 6, incomeEvents, obligations, removeIncomeIds: [], cushionKop: rub(400_000) });
    expect(ok.firstDeficitMonth).toBeNull();
    expect(ok.monthsCushionLasts).toBeNull();
  });
});

describe('налоговые вычеты', () => {
  const loan: LoanInput = { id: 'l', principalKop: rub(6_000_000), annualRate: '16', termMonths: 240, type: 'annuity', issueDate: '2026-03-15' };
  const schedules = [buildSchedule(loan)];
  const member = (p: Partial<TaxMemberInput>): TaxMemberInput => ({
    memberId: 'ivan',
    name: 'Иван',
    annualTaxableIncomeKop: rub(2_400_000),
    ndflRatePercent: '13',
    propertyDeductionUsedKop: 0,
    interestDeductionUsed: false,
    costSharePercent: '50',
    interestSharePercent: '50',
    claimed: false,
    ...p,
  });

  it('с покупки — до 260 000 ₽ на каждого супруга', () => {
    const r = calculateTaxDeductions({
      priceKop: rub(8_000_000),
      nonDeductibleKop: 0,
      rightDate: '2026-04-01',
      members: [member({}), member({ memberId: 'maria', name: 'Мария' })],
      schedules,
    });
    expect(r.members.map((m) => m.propertyRefundTotalKop)).toEqual([rub(260_000), rub(260_000)]);
    expect(r.totalPropertyRefundKop).toBe(rub(520_000));
  });

  it('с процентов — до 390 000 ₽ на человека за весь срок', () => {
    const r = calculateTaxDeductions({ priceKop: rub(8_000_000), nonDeductibleKop: 0, rightDate: '2026-04-01', members: [member({ interestSharePercent: '100', costSharePercent: '100' })], schedules });
    expect(r.members[0]!.interestRefundTotalKop).toBe(rub(390_000));
  });

  it('возврат за год не больше уплаченного НДФЛ — остаток переносится', () => {
    const r = calculateTaxDeductions({
      priceKop: rub(8_000_000),
      nonDeductibleKop: 0,
      rightDate: '2026-04-01',
      members: [member({ annualTaxableIncomeKop: rub(1_000_000), costSharePercent: '100', interestSharePercent: '0' })],
      schedules,
    });
    const years = r.years.filter((y) => y.memberId === 'ivan');
    expect(years[0]!.propertyRefundKop).toBe(rub(130_000));
    expect(years[1]!.propertyRefundKop).toBe(rub(130_000));
    expect(years[0]!.expectedDate).toBe('2027-06-01');
  });

  it('маткапитал не входит в вычет; уже использованный вычет уменьшает лимит', () => {
    const r = calculateTaxDeductions({
      priceKop: rub(2_500_000),
      nonDeductibleKop: rub(700_000),
      rightDate: '2026-04-01',
      members: [member({ costSharePercent: '100', interestSharePercent: '0', propertyDeductionUsedKop: rub(500_000) })],
      schedules,
    });
    expect(r.members[0]!.propertyBaseKop).toBe(rub(1_500_000));
    expect(r.members[0]!.propertyRefundTotalKop).toBe(rub(195_000));
  });

  it('вычет по процентам второй раз не положен', () => {
    const r = calculateTaxDeductions({ priceKop: rub(8_000_000), nonDeductibleKop: 0, rightDate: '2026-04-01', members: [member({ interestDeductionUsed: true })], schedules });
    expect(r.members[0]!.interestRefundTotalKop).toBe(0);
  });

  it('оформленный вычет не считается незаявленным', () => {
    const r = calculateTaxDeductions({ priceKop: rub(8_000_000), nonDeductibleKop: 0, rightDate: '2026-04-01', members: [member({ claimed: true })], schedules });
    expect(r.unclaimedKop).toBe(0);
  });

  it('без даты права — пусто', () => {
    expect(calculateTaxDeductions({ priceKop: 1, nonDeductibleKop: 0, rightDate: null, members: [member({})], schedules }).years).toEqual([]);
  });

  it('одной кнопкой — в досрочку: возвраты становятся разовыми платежами', () => {
    const r = calculateTaxDeductions({ priceKop: rub(8_000_000), nonDeductibleKop: 0, rightDate: '2026-04-01', members: [member({}), member({ memberId: 'maria', name: 'Мария' })], schedules });
    const p = taxRefundsToPrepayments(r, 'l');
    const first = p.find((x) => x.date === '2027-06-01')!;
    const expected = r.years.filter((y) => y.expectedDate === '2027-06-01').reduce((s, y) => s + y.propertyRefundKop + y.interestRefundKop, 0);
    expect(first.amountKop).toBe(expected);
    expect(first.source).toBe('tax_refund');
    const total = p.reduce((s, x) => s + x.amountKop, 0);
    expect(total).toBe(r.totalPropertyRefundKop + r.totalInterestRefundKop);
    const withPrepay = buildSchedule(loan, p);
    expect(withPrepay.summary.totalInterestKop).toBeLessThan(schedules[0]!.summary.totalInterestKop);
  });
});

describe('мастер сценария', () => {
  const base = {
    adults: 2,
    children: 1,
    sellingOwn: false,
    maternityCapitalKop: 0,
    program: 'family' as const,
    priceKop: rub(9_000_000),
    downPaymentKop: rub(2_000_000),
    startDate: '2026-10-08',
  };

  it('новостройка: эскроу, приёмка, ключи после сдачи дома', () => {
    const p = buildInitialPlan({ ...base, housingType: 'new_ddu' }, '2026-10-08');
    const keys = p.stages.map((s) => s.key);
    expect(keys).toContain('acceptance');
    expect(keys).not.toContain('property_check');
    expect(keys).not.toContain('deposit_agreement');
    expect(p.keysDate > p.dealDate).toBe(true);
    expect(p.loan.principalKop).toBe(rub(7_000_000));
    expect(p.loan.annualRate).toBe('6');
  });

  it('вторичка с продажей своей квартиры и маткапиталом', () => {
    const p = buildInitialPlan({ ...base, housingType: 'secondary', sellingOwn: true, maternityCapitalKop: rub(690_000) }, '2026-10-08');
    const keys = p.stages.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['sell_own', 'maternity_capital', 'property_check', 'deposit_agreement', 'appraisal']));
    expect(p.loan.principalKop).toBe(rub(9_000_000 - 2_000_000 - 690_000));
    expect(p.expenses.some((e) => e.catalogKey === 'notary')).toBe(true);
    expect(p.expenses.some((e) => e.catalogKey === 'title_insurance')).toBe(false);
  });

  it('страховка залога привязана к кредиту и повторяется ежегодно', () => {
    const p = buildInitialPlan({ ...base, housingType: 'secondary' }, '2026-10-08');
    const ins = p.expenses.find((e) => e.catalogKey === 'property_insurance')!;
    expect(ins).toMatchObject({ recurrence: 'yearly', loanId: p.loan.id, percentOfLoanBalance: '0.15' });
  });

  it('расходы «после ключей» с приоритетами привязаны к дате ключей', () => {
    const p = buildInitialPlan({ ...base, housingType: 'secondary' }, '2026-10-08');
    const kitchen = p.expenses.find((e) => e.catalogKey === 'kitchen')!;
    expect(kitchen).toMatchObject({ category: 'after_keys', priority: 1, atKeys: true });
  });

  it('без ставки — ориентир и просьба уточнить', () => {
    const p = buildInitialPlan({ ...base, program: 'base', housingType: 'secondary' }, '2026-10-08');
    expect(p.notes.some((n) => n.includes('ставку'))).toBe(true);
  });

  it('маленький первый взнос по льготной программе — подсказка', () => {
    const p = buildInitialPlan({ ...base, housingType: 'secondary', downPaymentKop: rub(500_000) }, '2026-10-08');
    expect(p.notes.some((n) => n.includes('20%'))).toBe(true);
  });
});
