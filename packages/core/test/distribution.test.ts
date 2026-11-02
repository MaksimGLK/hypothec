import { describe, expect, it } from 'vitest';
import { incomeDistribution, rub } from '../src/index.js';
import { quietFamily } from './fixtures.js';

describe('куда уходит доход месяца', () => {
  it('разовый доход попадает только в месяц своей даты', () => {
    const base = quietFamily();
    const input = quietFamily({
      incomes: [...base.incomes, { id: 'once', name: 'Продажа машины', type: 'one_off', amountKop: rub(200_000), periodicity: 'once', date: '2026-11-12', reliability: 'unstable' }],
    });
    expect(incomeDistribution(input, '2026-11').incomeKop).toBe(rub(550_000));
    expect(incomeDistribution(input, '2026-12').incomeKop).toBe(incomeDistribution(base, '2026-12').incomeKop);
    const total = incomeDistribution(input, '2026-11').segments.reduce((s, x) => s + x.amountKop, 0);
    expect(total).toBe(rub(550_000));
  });

  it('доход месяца целиком разложен по частям — сумма долей 100%', () => {
    const d = incomeDistribution(quietFamily(), '2026-11');
    expect(d.incomeKop).toBe(rub(350_000));
    const total = d.segments.reduce((s, x) => s + x.amountKop, 0);
    expect(total).toBe(d.incomeKop);
    expect(d.segments.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 6);
    expect(d.segments.map((x) => x.key)).toEqual(expect.arrayContaining(['mortgage', 'life', 'savings']));
  });

  it('жизнь раскрывается по категориям бюджета, копилка — по целям', () => {
    const input = quietFamily({
      living: [
        { id: 'u', name: 'Коммуналка', amountKop: rub(10_000) },
        { id: 'f', name: 'Продукты', amountKop: rub(40_000) },
      ],
    });
    const d = incomeDistribution(input, '2026-11');
    const life = d.segments.find((s) => s.key === 'life')!;
    expect(life.amountKop).toBe(rub(50_000));
    expect(life.parts.map((p) => p.name)).toEqual(['Продукты', 'Коммуналка']);
    expect(d.segments.find((s) => s.key === 'savings')!.parts.length).toBeGreaterThan(0);
  });

  it('траты вне плана уменьшают остаток', () => {
    const living = [{ id: 'cafe', name: 'Кафе', amountKop: rub(10_000), essential: false }];
    const calm = incomeDistribution(quietFamily({ living, settings: { ...quietFamily().settings, allocation: { ...quietFamily().settings.allocation, steps: [] } } }), '2026-11');
    const spent = incomeDistribution(
      quietFamily({
        living,
        settings: { ...quietFamily().settings, allocation: { ...quietFamily().settings.allocation, steps: [] } },
        spendings: [
          { id: '1', categoryId: 'cafe', date: '2026-11-12', amountKop: rub(16_000) },
          { id: '2', categoryId: null, date: '2026-11-20', amountKop: rub(25_000) },
        ],
      }),
      '2026-11',
    );
    const unplanned = spent.segments.find((s) => s.key === 'unplanned')!;
    expect(unplanned.amountKop).toBe(rub(31_000));
    expect(unplanned.parts.map((p) => p.name).sort()).toEqual(['Без категории', 'Кафе']);
    const free = (d: typeof calm) => d.segments.find((s) => s.key === 'free')?.amountKop ?? 0;
    expect(free(calm) - free(spent)).toBe(rub(31_000));
  });
});

describe('копилка в диаграмме месяца', () => {
  const split = (cushion: number, prepay: number) => ({
    ...quietFamily().settings,
    allocation: {
      ...quietFamily().settings.allocation,
      distribution: 'split' as const,
      steps: [
        { target: 'min_cushion' as const, sources: 'any' as const, enabled: true, sharePercent: cushion },
        { target: 'prepayment' as const, sources: 'any' as const, enabled: true, sharePercent: prepay },
      ],
    },
  });

  it('доли соблюдаются: 70% подушка, 30% досрочка (цель подушки — от среднегодовых расходов)', () => {
    const accounts = quietFamily().accounts.map((a) => ({ ...a, balanceKop: 0 }));
    const d = incomeDistribution(quietFamily({ accounts, settings: split(70, 30) }), '2026-11');
    const savings = d.segments.find((s) => s.key === 'savings')!;
    const cushion = savings.parts.find((p) => p.name.startsWith('Подушка'))!.amountKop;
    expect(savings.parts.every((p) => p.accountId)).toBe(true);
    const prepay = savings.parts.find((p) => p.name === 'Досрочка')!.amountKop;
    expect(cushion / (cushion + prepay)).toBeCloseTo(0.7, 2);
  });

  it('траты вне плана уменьшают копилку, а не уводят остаток в минус', () => {
    const living = [{ id: 'k', name: 'Кружки', amountKop: rub(10_000), essential: false }];
    const base = incomeDistribution(quietFamily({ living, settings: split(70, 30) }), '2026-11');
    const withUnplanned = incomeDistribution(quietFamily({ living, settings: split(70, 30), spendings: [{ id: '1', categoryId: null, date: '2026-11-05', amountKop: rub(10_000) }] }), '2026-11');
    const sav = (d: typeof base) => d.segments.find((s) => s.key === 'savings')!.amountKop;
    expect(sav(base) - sav(withUnplanned)).toBe(rub(10_000));
    expect(withUnplanned.savingsReducedKop).toBe(rub(10_000));
    expect(withUnplanned.shortfallKop).toBe(0);
    expect(withUnplanned.segments.reduce((s, x) => s + x.amountKop, 0)).toBe(withUnplanned.incomeKop);
  });
});
