import { describe, expect, it } from 'vitest';
import {
  type AllocationInput,
  buildAllocation,
  buildSchedule,
  DEFAULT_ALLOCATION_SETTINGS,
  defaultAccounts,
  expandIncomes,
  type IncomeInput,
  type LoanInput,
  rub,
} from '../src/index.js';

const TODAY = '2027-01-01';
const loan: LoanInput = { id: 'l', principalKop: rub(5_000_000), annualRate: '16', termMonths: 240, type: 'annuity', issueDate: '2026-06-15' };
const schedule = buildSchedule(loan);
const PAYMENT = schedule.rows[0]!.paymentKop;

const salary = (id: string, amountRub: number, day: number, reliability: IncomeInput['reliability'] = 'stable'): IncomeInput => ({
  id,
  name: id,
  type: reliability === 'stable' ? 'salary' : 'bonus',
  amountKop: rub(amountRub),
  periodicity: 'monthly',
  dayOfMonth: day,
  reliability,
});

function input(p: Partial<AllocationInput> & { incomes?: IncomeInput[] } = {}): AllocationInput {
  const incomes = p.incomes ?? [salary('Иван', 200_000, 10), salary('Мария', 150_000, 25)];
  return {
    today: TODAY,
    horizonMonths: 24,
    incomeEvents: expandIncomes(incomes, TODAY, '2029-12-31'),
    accounts: defaultAccounts(),
    schedules: [schedule],
    prepayments: [],
    expenses: [],
    living: [{ id: 'liv', name: 'Жизнь', amountKop: rub(100_000) }],
    expenseContext: {},
    settings: { ...DEFAULT_ALLOCATION_SETTINGS },
    ...p,
  };
}

const mortgageLines = (r: ReturnType<typeof buildAllocation>, date: string) =>
  r.transfers.filter((t) => t.date === date).flatMap((t) => t.lines).filter((l) => l.accountKind === 'mortgage');

describe('календарь распределения', () => {
  it('к каждой дате платежа на ипотечном счёте нужная сумма, из двух зарплат пропорционально', () => {
    const r = buildAllocation(input());
    expect(r.deficits).toEqual([]);
    // платёж 15 февраля копится с зарплат 25 января и 10 февраля
    const fromMaria = mortgageLines(r, '2027-01-25').reduce((s, l) => s + l.amountKop, 0);
    const fromIvan = mortgageLines(r, '2027-02-10').reduce((s, l) => s + l.amountKop, 0);
    expect(fromMaria + fromIvan).toBe(PAYMENT);
    expect(Math.abs(fromMaria / PAYMENT - 150 / 350)).toBeLessThan(0.01);
  });

  it('деньги, уже лежащие на ипотечном счёте, покрывают ближайший платёж', () => {
    const accounts = defaultAccounts().map((a) => (a.kind === 'mortgage' ? { ...a, balanceKop: PAYMENT } : a));
    const r = buildAllocation(input({ accounts }));
    expect(mortgageLines(r, '2027-01-10')).toEqual([]);
    expect(r.deficits).toEqual([]);
  });

  it('нестабильные деньги не идут на ипотеку — только на цели', () => {
    const r = buildAllocation(input({ incomes: [salary('Иван', 60_000, 10), salary('Премия', 300_000, 20, 'unstable')] }));
    const bonusLines = r.transfers.filter((t) => t.incomeId === 'Премия').flatMap((t) => t.lines);
    expect(bonusLines.every((l) => l.purpose !== 'obligation')).toBe(true);
    expect(r.deficits.some((d) => d.kind === 'mortgage')).toBe(true);
    expect(r.mortgageUnstableShareKop).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.code === 'mortgage_from_unstable')).toBe(true);
  });

  it('если разрешить — нестабильные деньги покрывают обязательные платежи', () => {
    const r = buildAllocation(
      input({
        incomes: [salary('Иван', 60_000, 10), salary('Премия', 300_000, 20, 'unstable')],
        settings: { ...DEFAULT_ALLOCATION_SETTINGS, useUnstableForObligations: true },
      }),
    );
    expect(r.deficits.filter((d) => d.date > '2027-02-01')).toEqual([]);
  });

  it('нехватка к дате платежа покрывается из подушки и показывается как дефицит', () => {
    const accounts = defaultAccounts().map((a) => (a.kind === 'cushion' ? { ...a, balanceKop: rub(500_000) } : a));
    const r = buildAllocation(input({ accounts, incomes: [salary('Иван', 120_000, 10)] }));
    const d = r.deficits.find((x) => x.kind === 'living')!;
    expect(d.coveredFromCushionKop).toBe(d.shortfallKop);
    expect(d.uncoveredKop).toBe(0);
  });

  it('цели заполняются по порядку: минимальная подушка → самое нужное → полная подушка → обустройство → досрочка', () => {
    const r = buildAllocation(
      input({
        expenses: [
          { id: 'kitchen', name: 'Кухня', category: 'after_keys', planKop: rub(200_000), recurrence: 'once', priority: 1 },
          { id: 'sofa', name: 'Диван', category: 'after_keys', planKop: rub(100_000), recurrence: 'once', priority: 3 },
        ],
      }),
    );
    const date = (t: string) => r.goals.find((g) => g.target === t)!.reachDate!;
    expect(date('min_cushion') <= date('priority_setup')).toBe(true);
    expect(date('priority_setup') <= date('full_cushion')).toBe(true);
    expect(date('full_cushion') <= date('setup')).toBe(true);
    const firstPrepay = r.transfers.find((t) => t.lines.some((l) => l.accountKind === 'prepayment'))!;
    expect(firstPrepay.date >= date('setup')).toBe(true);
    // цель подушки = 6 × обязательные расходы
    expect(r.goals.find((g) => g.target === 'full_cushion')!.targetKop).toBe(r.monthlyObligatoryKop * 6);
  });

  it('пользователь может поменять порядок: досрочка раньше подушки', () => {
    const r = buildAllocation(
      input({
        settings: {
          ...DEFAULT_ALLOCATION_SETTINGS,
          steps: [
            { target: 'prepayment', sources: 'irregular', enabled: true },
            { target: 'full_cushion', sources: 'any', enabled: true },
          ],
        },
        incomes: [salary('Иван', 300_000, 10), salary('Премия', 50_000, 20, 'unstable')],
      }),
    );
    const bonus = r.transfers.find((t) => t.incomeId === 'Премия')!;
    expect(bonus.lines.map((l) => l.accountKind)).toEqual(['prepayment']);
  });

  it('резерв на ежегодную страховку копится помесячно', () => {
    const r = buildAllocation(
      input({
        expenses: [{ id: 'ins', name: 'Страхование залога', category: 'mandatory', planKop: rub(24_000), recurrence: 'yearly', date: '2027-12-20' }],
      }),
    );
    const reserve = r.transfers.flatMap((t) => t.lines).filter((l) => l.accountKind === 'annual_reserve');
    const total = reserve.reduce((s, l) => s + l.amountKop, 0);
    expect(total).toBe(rub(24_000) * 2); // 2027 и 2028 на горизонте 24 мес.
    const jan = r.transfers.filter((t) => t.date.startsWith('2027-01')).flatMap((t) => t.lines).filter((l) => l.accountKind === 'annual_reserve');
    const janTotal = jan.reduce((s, l) => s + l.amountKop, 0);
    expect(janTotal).toBeGreaterThan(rub(1_500));
    expect(janTotal).toBeLessThan(rub(2_600));
  });

  it('без резерва ежегодный платёж собирается в месяц оплаты', () => {
    const r = buildAllocation(
      input({
        settings: { ...DEFAULT_ALLOCATION_SETTINGS, annualReserveEnabled: false },
        expenses: [{ id: 'ins', name: 'Страхование залога', category: 'mandatory', planKop: rub(24_000), recurrence: 'yearly', date: '2027-12-20' }],
      }),
    );
    const lines = r.transfers.flatMap((t) => t.lines.map((l) => ({ ...l, date: t.date }))).filter((l) => l.obligationId?.startsWith('exp:ins'));
    expect(lines.every((l) => l.date.startsWith('2027-12') || l.date.startsWith('2028-12'))).toBe(true);
  });

  it('разовая досрочка без денег на счёте «Досрочка» — предупреждение', () => {
    const r = buildAllocation(
      input({ prepayments: [{ id: 'p', loanId: 'l', kind: 'one_off', amountKop: rub(1_000_000), date: '2027-02-15', mode: 'reduce_term' }] }),
    );
    expect(r.warnings.find((w) => w.code === 'prepayment_underfunded')!.amountKop).toBe(rub(1_000_000));
  });

  it('расходы сделки копятся к своей дате', () => {
    const r = buildAllocation(
      input({ expenses: [{ id: 'appr', name: 'Оценка', category: 'mandatory', planKop: rub(7_000), recurrence: 'once', date: '2027-03-01' }] }),
    );
    const total = r.transfers.flatMap((t) => t.lines).filter((l) => l.accountKind === 'deal').reduce((s, l) => s + l.amountKop, 0);
    expect(total).toBe(rub(7_000));
  });
});
