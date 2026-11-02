import { describe, expect, it } from 'vitest';
import {
  annuityPayment,
  buildSchedule,
  compareCandidateModes,
  compareModes,
  compareScenarios,
  type LoanInput,
  type LoanSchedule,
  type PrepaymentInput,
  prepaymentTimingEffect,
  remainingPayments,
  rub,
} from '../src/index.js';
import { REFERENCE_LOAN } from './fixtures.js';

const oneOff = (date: string, amountRub: number, mode: PrepaymentInput['mode'] = 'reduce_term', id = `p_${date}`): PrepaymentInput => ({
  id,
  loanId: REFERENCE_LOAN.id,
  kind: 'one_off',
  amountKop: rub(amountRub),
  date,
  mode,
});

/** Инварианты любого графика: долг погашен полностью, остаток не уходит в минус. */
function expectConsistent(loan: LoanInput, s: LoanSchedule) {
  const principalPaid = s.rows.reduce((sum, r) => sum + r.principalKop + r.prepaymentKop, 0);
  expect(principalPaid).toBe(loan.principalKop);
  expect(s.rows.at(-1)!.balanceKop).toBe(0);
  for (const r of s.rows) {
    expect(r.balanceKop).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(r.interestKop)).toBe(true);
    expect(Number.isInteger(r.paymentKop)).toBe(true);
  }
  const interest = s.rows.reduce((sum, r) => sum + r.interestKop, 0);
  expect(interest).toBe(s.summary.totalInterestKop);
}

describe('эталон из ТЗ: 10 315 920 ₽, 16%, 120 мес., аннуитет', () => {
  const s = buildSchedule(REFERENCE_LOAN);

  it('платёж около 172 805 ₽', () => {
    expect(s.summary.firstPaymentKop).toBe(17_280_520);
    expect(annuityPayment(REFERENCE_LOAN.principalKop, '16', 120)).toBe(17_280_520);
  });

  it('переплата около 10,42 млн ₽', () => {
    expect(s.summary.totalInterestKop).toBe(1_042_070_268);
    expect(Math.round(s.summary.totalInterestKop / 100 / 10_000) / 100).toBe(10.42);
  });

  it('120 платежей, последний корректирует копейки', () => {
    expect(s.summary.paymentsCount).toBe(120);
    expect(s.summary.payoffDate).toBe('2035-01-15');
    const last = s.rows.at(-1)!;
    expect(Math.abs(last.paymentKop - 17_280_520)).toBeLessThan(200);
    expectConsistent(REFERENCE_LOAN, s);
  });

  it('в начале платишь в основном проценты', () => {
    const first = s.rows[0]!;
    expect(first.interestKop).toBe(13_754_560); // 10 315 920 × 16% / 12
    expect(first.interestKop / first.paymentKop).toBeGreaterThan(0.79);
  });
});

describe('дифференцированный платёж', () => {
  const loan: LoanInput = { ...REFERENCE_LOAN, type: 'differentiated' };
  const s = buildSchedule(loan);

  it('первый платёж больше аннуитета, переплата меньше', () => {
    expect(s.summary.firstPaymentKop).toBe(8_596_600 + 13_754_560);
    expect(s.summary.totalInterestKop).toBeLessThan(buildSchedule(REFERENCE_LOAN).summary.totalInterestKop);
    expectConsistent(loan, s);
  });

  it('платёж убывает каждый месяц', () => {
    const payments = s.rows.map((r) => r.paymentKop);
    for (let i = 1; i < payments.length - 1; i++) expect(payments[i]!).toBeLessThan(payments[i - 1]!);
  });
});

describe('новая досрочка поверх уже запланированных', () => {
  const existing = [oneOff('2026-01-15', 50_000, 'reduce_payment_keep_amount', 'old')];
  const candidate = (amountRub: number) => oneOff('2026-06-15', amountRub, 'reduce_term', 'new');

  it('платёж считается после новой досрочки и зависит от её суммы', () => {
    const small = compareCandidateModes(REFERENCE_LOAN, existing, candidate(100_000)).reducePayment.paymentAfterKop;
    const big = compareCandidateModes(REFERENCE_LOAN, existing, candidate(1_000_000)).reducePayment.paymentAfterKop;
    expect(big).toBeLessThan(small);
    // прежний расчёт смотрел на первую досрочку в графике и от суммы новой не зависел
    const old = (a: number) => compareModes(REFERENCE_LOAN, [...existing, candidate(a)]).reducePayment.paymentAfterFirstPrepaymentKop;
    expect(old(100_000)).toBe(old(1_000_000));
  });

  it('режим меняется только у новой досрочки', () => {
    const r = compareCandidateModes(REFERENCE_LOAN, [oneOff('2026-01-15', 500_000, 'reduce_term', 'old')], candidate(500_000));
    expect(r.reduceTerm.monthsSaved).toBeGreaterThan(0);
    expect(r.reducePayment.monthsSaved).toBe(0);
    expect(r.reducePayment.paymentAfterKop).toBeLessThan(r.reduceTerm.paymentAfterKop);
    expect(r.reduceTerm.savingsKop).toBeGreaterThan(r.reducePayment.savingsKop);
  });

  it('«уменьшить платёж» отменяет прежнее «платить прежнюю сумму»', () => {
    const r = compareCandidateModes(REFERENCE_LOAN, existing, candidate(500_000));
    expect(r.reducePaymentKeepAmount.monthsSaved).toBeGreaterThan(0);
    expect(r.reducePayment.savingsKop).toBeLessThan(r.reducePaymentKeepAmount.savingsKop);
    const s = buildSchedule(REFERENCE_LOAN, [...existing, { ...candidate(500_000), mode: 'reduce_payment' }]);
    expect(s.rows.filter((x) => x.date > '2026-06-15').every((x) => x.keepExtraKop === 0)).toBe(true);
    expect(s.rows.filter((x) => x.date <= '2026-06-15').some((x) => x.keepExtraKop > 0)).toBe(true);
    expectConsistent(REFERENCE_LOAN, s);
  });

  it('досрочка закрывает кредит — платежа после неё нет', () => {
    const r = compareCandidateModes(REFERENCE_LOAN, [], candidate(20_000_000));
    expect(r.reduceTerm.paymentAfterKop).toBe(0);
  });
});

describe('досрочка: сокращение срока против уменьшения платежа', () => {
  const p = [oneOff('2026-01-15', 1_000_000)];
  const cmp = compareModes(REFERENCE_LOAN, p);

  it('сокращение срока экономит больше', () => {
    expect(cmp.reduceTerm.savingsKop).toBeGreaterThan(cmp.reducePayment.savingsKop);
    expect(cmp.reduceTerm.monthsSaved).toBeGreaterThan(0);
    expect(cmp.reducePayment.monthsSaved).toBe(0);
  });

  it('при сокращении срока платёж прежний, при уменьшении — ниже', () => {
    expect(cmp.reduceTerm.paymentAfterFirstPrepaymentKop).toBe(17_280_520);
    expect(cmp.reducePayment.paymentAfterFirstPrepaymentKop).toBeLessThan(17_280_520);
    expect(cmp.reducePayment.paymentAfterFirstPrepaymentKop).toBe(annuityPayment(cmp.reducePayment.schedule.rows[11]!.balanceKop, '16', 108));
  });

  it('«уменьшить платёж, но платить прежнюю сумму» экономит как сокращение срока, а обязательный платёж ниже', () => {
    const keep = cmp.reducePaymentKeepAmount;
    expect(Math.abs(keep.savingsKop - cmp.reduceTerm.savingsKop)).toBeLessThan(rub(100));
    expect(keep.payoffDate).toBe(cmp.reduceTerm.payoffDate);
    // сразу после досрочки обязательный платёж как при уменьшении платежа, дальше продолжает снижаться
    expect(keep.paymentAfterFirstPrepaymentKop).toBe(cmp.reducePayment.paymentAfterFirstPrepaymentKop);
    const yearLater = (s: LoanSchedule) => s.rows.find((r) => r.date === '2027-01-15')!.paymentKop;
    expect(yearLater(keep.schedule)).toBeLessThan(yearLater(cmp.reducePayment.schedule));
    // семья всё время платит прежние 172 805,20 ₽ (кроме последнего месяца)
    const rows = keep.schedule.rows.filter((r) => r.kind === 'payment' && r.date > '2026-01-15');
    for (const r of rows.slice(0, -1)) expect(r.paymentKop + r.keepExtraKop).toBe(17_280_520);
    expectConsistent(REFERENCE_LOAN, keep.schedule);
  });

  it('все режимы дают корректный график', () => {
    expectConsistent(REFERENCE_LOAN, cmp.reduceTerm.schedule);
    expectConsistent(REFERENCE_LOAN, cmp.reducePayment.schedule);
  });

  it('пересчёт срока: nper согласован с графиком', () => {
    const balance = cmp.reduceTerm.schedule.rows[11]!.balanceKop;
    const n = remainingPayments(balance, '16', 17_280_520)!;
    const left = cmp.reduceTerm.schedule.rows.filter((r) => r.kind === 'payment' && r.index > 12).length;
    expect(left).toBe(n);
  });
});

describe('разовый платёж в разные годы', () => {
  it('чем раньше, тем больше экономия', () => {
    const pts = prepaymentTimingEffect(REFERENCE_LOAN, rub(1_000_000), ['2025-02-15', '2027-01-15', '2030-01-15', '2033-01-15']);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.savingsKop).toBeLessThan(pts[i - 1]!.savingsKop);
    expect(pts[0]!.savingsKop).toBeGreaterThan(rub(3_000_000));
    expect(pts[2]!.savingsKop).toBeLessThan(rub(1_100_000));
  });
});

describe('изменение ставки', () => {
  const loan: LoanInput = { ...REFERENCE_LOAN, rateChanges: [{ fromDate: '2027-01-15', annualRate: '8' }] };
  const s = buildSchedule(loan);

  it('новый платёж пересчитывается на остаток и оставшийся срок', () => {
    const before = s.rows[23]!;
    const after = s.rows[24]!;
    expect(before.paymentKop).toBe(17_280_520);
    expect(after.annualRate).toBe('8');
    expect(after.paymentKop).toBe(annuityPayment(before.balanceKop, '8', 96));
    expect(s.summary.paymentsCount).toBe(120);
    expectConsistent(loan, s);
  });

  it('ставка меняется с середины периода — проценты делятся по дням', () => {
    const mid: LoanInput = { ...REFERENCE_LOAN, rateChanges: [{ fromDate: '2027-01-30', annualRate: '8' }] };
    const m = buildSchedule(mid);
    const row = m.rows.find((r) => r.date === '2027-02-15')!;
    const prevBalance = m.rows.find((r) => r.date === '2027-01-15')!.balanceKop;
    const full16 = Math.round((prevBalance * 0.16) / 12);
    const full8 = Math.round((prevBalance * 0.08) / 12);
    expect(row.interestKop).toBeLessThan(full16);
    expect(row.interestKop).toBeGreaterThan(full8);
    expectConsistent(mid, m);
  });

  it('льготный период: ставка растёт — растёт и платёж', () => {
    const up: LoanInput = { ...REFERENCE_LOAN, annualRate: '6', rateChanges: [{ fromDate: '2026-01-16', annualRate: '18' }] };
    const u = buildSchedule(up);
    expect(u.rows[12]!.paymentKop).toBeGreaterThan(u.rows[11]!.paymentKop);
    expectConsistent(up, u);
  });
});

describe('ежедневное начисление процентов', () => {
  it('проценты зависят от числа дней в периоде', () => {
    const loan: LoanInput = { ...REFERENCE_LOAN, interestMode: 'daily' };
    const s = buildSchedule(loan);
    // январь→февраль 31 день, февраль→март 28 дней
    expect(s.rows[0]!.interestKop).toBe(Math.round((REFERENCE_LOAN.principalKop * 0.16 * 31) / 365));
    expect(s.rows[1]!.interestKop).toBeLessThan(s.rows[0]!.interestKop);
    expectConsistent(loan, s);
  });
});

describe('граничные случаи', () => {
  it('досрочка больше остатка закрывает кредит и предупреждает', () => {
    const s = buildSchedule(REFERENCE_LOAN, [oneOff('2026-01-15', 20_000_000)]);
    expect(s.summary.payoffDate).toBe('2026-01-15');
    expect(s.warnings.some((w) => w.code === 'exceeds_balance')).toBe(true);
    expectConsistent(REFERENCE_LOAN, s);
  });

  it('полное закрытие между датами: остаток + проценты за прошедшие дни', () => {
    const s = buildSchedule(REFERENCE_LOAN, [oneOff('2026-01-30', 20_000_000)]);
    const last = s.rows.at(-1)!;
    expect(last.kind).toBe('prepayment');
    expect(last.date).toBe('2026-01-30');
    expect(last.interestKop).toBeGreaterThan(0);
    expect(last.balanceKop).toBe(0);
    expectConsistent(REFERENCE_LOAN, s);
  });

  it('досрочка ровно на остаток после платежа', () => {
    const base = buildSchedule(REFERENCE_LOAN);
    const balance = base.rows[11]!.balanceKop;
    const s = buildSchedule(REFERENCE_LOAN, [{ ...oneOff('2026-01-15', 0), amountKop: balance }]);
    expect(s.summary.payoffDate).toBe('2026-01-15');
    expect(s.warnings).toEqual([]);
    expectConsistent(REFERENCE_LOAN, s);
  });

  it('досрочка после погашения не учитывается', () => {
    const s = buildSchedule(REFERENCE_LOAN, [oneOff('2026-01-15', 20_000_000, 'reduce_term', 'a'), oneOff('2027-01-15', 100_000, 'reduce_term', 'b')]);
    expect(s.warnings.some((w) => w.code === 'after_payoff' && w.prepaymentId === 'b')).toBe(true);
  });

  it('досрочка раньше выдачи не учитывается', () => {
    const s = buildSchedule(REFERENCE_LOAN, [oneOff('2024-12-01', 100_000)]);
    expect(s.warnings[0]!.code).toBe('before_issue');
    expect(s.summary.totalPrepaidKop).toBe(0);
  });

  it('последний платёж при сокращении срока меньше обычного', () => {
    const s = buildSchedule(REFERENCE_LOAN, [oneOff('2026-01-15', 1_234_567)]);
    const last = s.rows.at(-1)!;
    expect(last.paymentKop).toBeLessThan(17_280_520);
    expect(last.balanceKop).toBe(0);
  });

  it('нулевая ставка', () => {
    const loan: LoanInput = { ...REFERENCE_LOAN, annualRate: '0' };
    const s = buildSchedule(loan);
    expect(s.summary.totalInterestKop).toBe(0);
    expectConsistent(loan, s);
  });

  it('день платежа 31: в коротких месяцах — последний день', () => {
    const loan: LoanInput = { ...REFERENCE_LOAN, issueDate: '2025-01-31' };
    const s = buildSchedule(loan);
    expect(s.rows[0]!.date).toBe('2025-02-28');
    expect(s.rows[1]!.date).toBe('2025-03-31');
  });

  it('некорректные параметры кредита', () => {
    expect(() => buildSchedule({ ...REFERENCE_LOAN, principalKop: 0 })).toThrow();
    expect(() => buildSchedule({ ...REFERENCE_LOAN, termMonths: 0 })).toThrow();
    expect(() => buildSchedule({ ...REFERENCE_LOAN, principalKop: 100.5 })).toThrow();
  });
});

describe('правила банка', () => {
  const rules = { onlyOnPaymentDate: true, minAmountKop: rub(50_000), noticeDays: 30 };

  it('досрочка только в дату платежа — переносится на ближайшую', () => {
    const s = buildSchedule({ ...REFERENCE_LOAN, bankRules: rules }, [oneOff('2026-01-20', 1_000_000)]);
    expect(s.warnings[0]!.code).toBe('moved_to_payment_date');
    const row = s.rows.find((r) => r.prepaymentKop > 0)!;
    expect(row.date).toBe('2026-02-15');
    expect(row.kind).toBe('payment');
  });

  it('сумма меньше минимальной не учитывается', () => {
    const s = buildSchedule({ ...REFERENCE_LOAN, bankRules: rules }, [oneOff('2026-01-15', 10_000)]);
    expect(s.warnings[0]!.code).toBe('below_minimum');
    expect(s.summary.totalPrepaidKop).toBe(0);
  });
});

describe('ежемесячная доплата', () => {
  it('применяется в каждую дату платежа в интервале', () => {
    const p: PrepaymentInput = { id: 'm', loanId: 'ref', kind: 'monthly', amountKop: rub(20_000), startDate: '2025-06-01', endDate: '2025-12-31', mode: 'reduce_term' };
    const s = buildSchedule(REFERENCE_LOAN, [p]);
    const withPrepay = s.rows.filter((r) => r.prepaymentKop > 0);
    expect(withPrepay.map((r) => r.date)).toEqual(['2025-06-15', '2025-07-15', '2025-08-15', '2025-09-15', '2025-10-15', '2025-11-15', '2025-12-15']);
    expect(s.summary.totalPrepaidKop).toBe(rub(140_000));
    expectConsistent(REFERENCE_LOAN, s);
  });

  it('комбинация ежемесячной доплаты и разовых платежей', () => {
    const s = buildSchedule(REFERENCE_LOAN, [
      { id: 'm', loanId: 'ref', kind: 'monthly', amountKop: rub(30_000), startDate: '2025-02-01', mode: 'reduce_term' },
      oneOff('2026-06-15', 500_000),
      oneOff('2027-06-15', 500_000),
    ]);
    expect(s.summary.paymentsCount).toBeLessThan(80);
    expectConsistent(REFERENCE_LOAN, s);
  });
});

describe('сравнение сценариев', () => {
  it('до 4 сценариев рядом', () => {
    const c = compareScenarios(REFERENCE_LOAN, [
      { id: 'a', name: '1 млн сейчас', prepayments: [oneOff('2025-02-15', 1_000_000)] },
      { id: 'b', name: '1 млн через 5 лет', prepayments: [oneOff('2030-01-15', 1_000_000)] },
      { id: 'c', name: '20 тыс. ежемесячно', prepayments: [{ id: 'm', loanId: 'ref', kind: 'monthly', amountKop: rub(20_000), startDate: '2025-02-01', mode: 'reduce_term' }] },
    ]);
    expect(c.baseline.savingsKop).toBe(0);
    expect(c.scenarios).toHaveLength(3);
    expect(c.scenarios[0]!.savingsKop).toBeGreaterThan(c.scenarios[1]!.savingsKop);
    expect(c.scenarios[2]!.monthsSaved).toBeGreaterThan(20);
  });

  it('больше 4 — ошибка', () => {
    const s = { id: 'x', name: 'x', prepayments: [] };
    expect(() => compareScenarios(REFERENCE_LOAN, [s, s, s, s, s])).toThrow();
  });
});
