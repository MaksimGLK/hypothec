import { describe, expect, it } from 'vitest';
import { expandIncomes, type IncomeInput, parseIncomeQuickInput, rub, stableMonthlyIncome } from '../src/index.js';

const base = (p: Partial<IncomeInput>): IncomeInput => ({
  id: 'i',
  name: 'Доход',
  type: 'salary',
  amountKop: rub(100_000),
  periodicity: 'monthly',
  dayOfMonth: 10,
  reliability: 'stable',
  ...p,
});

describe('раскладка доходов по датам', () => {
  it('ежемесячно в заданный день, с поправкой на короткий месяц', () => {
    const ev = expandIncomes([base({ dayOfMonth: 31 })], '2027-01-01', '2027-03-31');
    expect(ev.map((e) => e.date)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('ежеквартально и раз в год от даты первого поступления', () => {
    const q = expandIncomes([base({ periodicity: 'quarterly', date: '2026-12-20' })], '2027-01-01', '2027-12-31');
    expect(q.map((e) => e.date)).toEqual(['2027-03-20', '2027-06-20', '2027-09-20', '2027-12-20']);
    const y = expandIncomes([base({ periodicity: 'yearly', date: '2025-12-25' })], '2026-01-01', '2028-12-31');
    expect(y.map((e) => e.date)).toEqual(['2026-12-25', '2027-12-25', '2028-12-25']);
  });

  it('разовое поступление и окно действия', () => {
    const ev = expandIncomes(
      [base({ id: 'a', periodicity: 'once', date: '2027-05-15' }), base({ id: 'b', startDate: '2027-02-01', endDate: '2027-03-31' })],
      '2027-01-01',
      '2027-12-31',
    );
    expect(ev.map((e) => `${e.incomeId}:${e.date}`)).toEqual(['b:2027-02-10', 'b:2027-03-10', 'a:2027-05-15']);
  });

  it('аренда начинается после ключей — и сдвигается вместе с ними', () => {
    const rent = base({ id: 'rent', type: 'rent', startsAtKeys: true, dayOfMonth: 5 });
    const a = expandIncomes([rent], '2027-01-01', '2027-06-30', { keysDate: '2027-03-20' });
    expect(a[0]!.date).toBe('2027-04-05');
    const b = expandIncomes([rent], '2027-01-01', '2027-06-30', { keysDate: '2027-05-20' });
    expect(b[0]!.date).toBe('2027-06-05');
  });

  it('стабильный доход в месяц не включает нестабильные и разовые', () => {
    const total = stableMonthlyIncome(
      [base({ id: 'a' }), base({ id: 'b', reliability: 'unstable' }), base({ id: 'c', periodicity: 'once', date: '2027-01-01' }), base({ id: 'd', periodicity: 'quarterly', amountKop: rub(30_000) })],
      '2027-01-15',
    );
    expect(total).toBe(rub(110_000));
  });
});

describe('быстрый ввод одной строкой', () => {
  const today = '2026-10-08';

  it('«Премия 110 000 каждый месяц 15-го»', () => {
    const r = parseIncomeQuickInput('Премия 110 000 каждый месяц 15-го', today);
    expect(r.draft).toMatchObject({ name: 'Премия', type: 'bonus', amountKop: rub(110_000), periodicity: 'monthly', dayOfMonth: 15, reliability: 'unstable' });
    expect(r.missing).toEqual([]);
  });

  it('«Зарплата 150 тыс 10 числа» — стабильный доход', () => {
    const r = parseIncomeQuickInput('Зарплата 150 тыс 10 числа', today);
    expect(r.draft).toMatchObject({ type: 'salary', amountKop: rub(150_000), periodicity: 'monthly', dayOfMonth: 10, reliability: 'stable' });
  });

  it('«Аренда 35 000 ежемесячно с 1 марта» — ожидаемый доход с датой начала', () => {
    const r = parseIncomeQuickInput('Аренда 35 000 ежемесячно с 1 марта', today);
    expect(r.draft).toMatchObject({ type: 'rent', amountKop: rub(35_000), periodicity: 'monthly', startDate: '2027-03-01', dayOfMonth: 1, reliability: 'expected' });
  });

  it('«Налоговый вычет 260 000 в мае 2027» — разово', () => {
    const r = parseIncomeQuickInput('Налоговый вычет 260 000 в мае 2027', today);
    expect(r.draft).toMatchObject({ type: 'tax_refund', amountKop: rub(260_000), periodicity: 'once', date: '2027-05-01', reliability: 'expected' });
  });

  it('«Продажа квартиры 6,5 млн 15.02.2027»', () => {
    const r = parseIncomeQuickInput('Продажа квартиры 6,5 млн 15.02.2027', today);
    expect(r.draft).toMatchObject({ type: 'property_sale', amountKop: rub(6_500_000), periodicity: 'once', date: '2027-02-15' });
  });

  it('«Подработка 20к в месяц нестабильно»', () => {
    const r = parseIncomeQuickInput('Подработка 20к в месяц нестабильно', today);
    expect(r.draft).toMatchObject({ type: 'self_employed', amountKop: rub(20_000), periodicity: 'monthly', reliability: 'unstable' });
    expect(r.missing).toEqual(['date']);
  });

  it('«Бонус 300 000 раз в квартал»', () => {
    const r = parseIncomeQuickInput('Бонус 300 000 раз в квартал', today);
    expect(r.draft).toMatchObject({ type: 'bonus', amountKop: rub(300_000), periodicity: 'quarterly' });
  });

  it('без суммы — просит её указать', () => {
    const r = parseIncomeQuickInput('Зарплата 10-го', today);
    expect(r.draft.amountKop).toBeNull();
    expect(r.missing).toContain('amount');
  });
});
