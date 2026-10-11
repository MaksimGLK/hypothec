import { describe, expect, it } from 'vitest';
import {
  adjustToTotal,
  averageSpending,
  dueAutoPayments,
  BUDGET_CATALOG,
  budgetMonth,
  buildPlan,
  type LivingExpenseInput,
  parseSpendingQuickInput,
  rub,
  type SpendingInput,
} from '../src/index.js';
import { quietFamily } from './fixtures.js';

const cats: LivingExpenseInput[] = [
  { id: 'c_util', name: 'Коммуналка', amountKop: rub(8_000), essential: true, catalogKey: 'utilities' },
  { id: 'c_food', name: 'Продукты', amountKop: rub(40_000), essential: true, catalogKey: 'groceries' },
  { id: 'c_cafe', name: 'Кафе и доставка', amountKop: rub(10_000), essential: false, catalogKey: 'cafe' },
  { id: 'c_kids', name: 'Кружки и секции', amountKop: rub(12_000), essential: false, catalogKey: 'kids_activities' },
];
const sp = (id: string, categoryId: string | null, date: string, rubles: number): SpendingInput => ({ id, categoryId, date, amountKop: rub(rubles) });

describe('бюджет месяца', () => {
  const spendings = [
    sp('1', 'c_food', '2026-10-02', 3_450),
    sp('2', 'c_food', '2026-10-05', 12_000),
    sp('3', 'c_cafe', '2026-10-06', 11_500),
    sp('4', 'c_util', '2026-10-01', 7_800),
    sp('5', null, '2026-10-07', 1_000),
    sp('6', 'c_food', '2026-09-20', 50_000),
  ];

  it('план, факт и остаток по категориям; траты другого месяца не учитываются', () => {
    const b = budgetMonth(cats, spendings, '2026-10', '2026-10-08');
    const food = b.categories.find((c) => c.categoryId === 'c_food')!;
    expect(food).toMatchObject({ planKop: rub(40_000), factKop: rub(15_450), leftKop: rub(24_550), spendingsCount: 2 });
    expect(b.planKop).toBe(rub(70_000));
    expect(b.factKop).toBe(rub(3_450 + 12_000 + 11_500 + 7_800 + 1_000));
    expect(b.leftKop).toBe(b.planKop - b.factKop);
    expect(b.essentialPlanKop).toBe(rub(48_000));
  });

  it('перерасход считается по категориям — экономия в одной не прячет перерасход в другой', () => {
    const b = budgetMonth(cats, spendings, '2026-10', '2026-10-08');
    expect(b.overspendKop).toBe(rub(1_500 + 1_000)); // кафе +1 500 и траты без категории
    expect(b.uncategorizedKop).toBe(rub(1_000));
  });

  it('для текущего месяца — сколько можно тратить в день, чтобы уложиться', () => {
    const b = budgetMonth(cats, spendings, '2026-10', '2026-10-08');
    expect(b.daysLeft).toBe(24);
    expect(b.dailyAllowanceKop).toBe(Math.floor(b.leftKop / 24));
    expect(budgetMonth(cats, spendings, '2026-09', '2026-10-08').daysLeft).toBeNull();
  });

  it('аренда до переезда: в месяце после ключей её нет в плане', () => {
    const withRent = [...cats, { id: 'c_rent', name: 'Аренда', amountKop: rub(45_000), endsAtKeys: true }];
    expect(budgetMonth(withRent, [], '2026-11', '2026-10-08', { keysDate: '2026-12-15' }).planKop).toBe(rub(115_000));
    expect(budgetMonth(withRent, [], '2027-01', '2026-10-08', { keysDate: '2026-12-15' }).planKop).toBe(rub(70_000));
  });

  it('средние траты за последние месяцы', () => {
    const history = [sp('a', 'c_food', '2026-07-10', 42_000), sp('b', 'c_food', '2026-08-10', 38_000), sp('c', 'c_food', '2026-09-10', 46_000), sp('d', 'c_food', '2026-10-01', 99_000)];
    expect(averageSpending(history, '2026-10-08')['c_food']).toEqual({ averageKop: rub(42_000), months: 3 });
  });
});

describe('трата одной строкой', () => {
  it('категория по названию или подсказке, сумма с копейками', () => {
    expect(parseSpendingQuickInput('Продукты 3 450', cats)).toMatchObject({ categoryId: 'c_food', amountKop: rub(3_450) });
    expect(parseSpendingQuickInput('пятёрочка 1200,50', cats)).toMatchObject({ categoryId: 'c_food', amountKop: 120_050, note: 'пятёрочка' });
    expect(parseSpendingQuickInput('бассейн Маше 4000', cats)).toMatchObject({ categoryId: 'c_kids', amountKop: rub(4_000) });
    expect(parseSpendingQuickInput('за свет 2 300 ₽', cats)).toMatchObject({ categoryId: 'c_util', amountKop: rub(2_300) });
    expect(parseSpendingQuickInput('доставка суши 2к', cats)).toMatchObject({ categoryId: 'c_cafe', amountKop: rub(2_000) });
  });

  it('незнакомое — без категории, без суммы — просит сумму', () => {
    expect(parseSpendingQuickInput('шуруповёрт 3500', cats).categoryId).toBeNull();
    expect(parseSpendingQuickInput('продукты', cats).amountKop).toBeNull();
  });

  it('справочник: ключи уникальны, у каждой категории есть подсказки', () => {
    expect(new Set(BUDGET_CATALOG.map((c) => c.key)).size).toBe(BUDGET_CATALOG.length);
    for (const c of BUDGET_CATALOG) expect(c.aliases.length).toBeGreaterThan(0);
  });
});

describe('бюджет в плане', () => {
  it('необязательные траты не закладываются в подушку, но учитываются в распределении', () => {
    const base = quietFamily({ living: [{ id: 'ess', name: 'Обязательное', amountKop: rub(100_000), essential: true }] });
    const withFlex = quietFamily({ living: [...base.living, { id: 'flex', name: 'Кафе', amountKop: rub(20_000), essential: false }] });
    const a = buildPlan(base);
    const b = buildPlan(withFlex);
    expect(b.cushion.monthlyObligatoryKop).toBe(a.cushion.monthlyObligatoryKop);
    expect(b.allocation.obligations.some((o) => o.kind === 'living_flexible')).toBe(true);
  });

  it('совет «укажите расходы на жизнь», если бюджет пустой', () => {
    const keys = buildPlan(quietFamily({ living: [] })).recommendations.map((r) => r.ruleKey);
    expect(keys).toContain('budget_not_set');
    expect(buildPlan(quietFamily()).recommendations.map((r) => r.ruleKey)).not.toContain('budget_not_set');
  });

  it('совет о перерасходе в прошлом месяце считает сумму и главную категорию', () => {
    const living: LivingExpenseInput[] = [
      { id: 'food', name: 'Продукты', amountKop: rub(40_000) },
      { id: 'cafe', name: 'Кафе и доставка', amountKop: rub(10_000), essential: false },
    ];
    const input = quietFamily({ living, spendings: [sp('1', 'food', '2026-09-10', 41_000), sp('2', 'cafe', '2026-09-12', 16_000)] });
    const r = buildPlan(input).recommendations.find((x) => x.ruleKey === 'budget_overspend')!;
    expect(r.effect!.valueKop).toBe(rub(7_000));
    expect(r.effect!.details.topCategory).toBe('Кафе и доставка');
    expect(r.text).toContain('Кафе и доставка');
    // траты в рамках плана — совета нет
    const ok = quietFamily({ living, spendings: [sp('1', 'food', '2026-09-10', 30_000)] });
    expect(buildPlan(ok).recommendations.map((x) => x.ruleKey)).not.toContain('budget_overspend');
  });
});

describe('автоплатежи', () => {
  const util: LivingExpenseInput = { id: 'u', name: 'Коммуналка', amountKop: rub(12_000), autoPayDay: 10 };
  it('в день автоплатежа — трата на сумму плана', () => {
    expect(dueAutoPayments([util], [], '2026-10-09')).toEqual([]);
    expect(dueAutoPayments([util], [], '2026-10-10')).toEqual([{ categoryId: 'u', month: '2026-10', date: '2026-10-10', amountKop: rub(12_000), create: true }]);
    // пропустили день (не заходили) — запишется позже той же датой
    expect(dueAutoPayments([util], [], '2026-10-25')[0]!.date).toBe('2026-10-10');
  });
  it('не дублирует ручную оплату и не повторяется за обработанный месяц', () => {
    expect(dueAutoPayments([util], [sp('m', 'u', '2026-10-03', 11_800)], '2026-10-10')[0]!.create).toBe(false);
    expect(dueAutoPayments([{ ...util, autoPayLastMonth: '2026-10' }], [], '2026-10-20')).toEqual([]);
    expect(dueAutoPayments([{ ...util, autoPayLastMonth: '2026-10' }], [], '2026-11-10')).toHaveLength(1);
  });
  it('31-е в коротком месяце — последний день; без плана — не создаётся', () => {
    expect(dueAutoPayments([{ ...util, autoPayDay: 31 }], [], '2027-02-28')[0]!.date).toBe('2027-02-28');
    expect(dueAutoPayments([{ ...util, amountKop: 0 }], [], '2026-10-15')).toEqual([]);
  });
});

describe('правка итога «Потрачено»', () => {
  const list = [sp('a', 't', '2026-10-02', 2_000), sp('b', 't', '2026-10-05', 3_000), sp('c', 't', '2026-10-09', 1_500)];
  it('итог больше — одна трата на разницу', () => {
    expect(adjustToTotal(list, rub(9_000))).toEqual({ createKop: rub(2_500), updates: [], deletes: [] });
    expect(adjustToTotal([], rub(7_500)).createKop).toBe(rub(7_500));
  });
  it('итог меньше — уменьшаются самые свежие траты', () => {
    // было 6 500, стало 5 000: последняя трата (1 500) уходит целиком
    expect(adjustToTotal(list, rub(5_000))).toEqual({ createKop: 0, updates: [], deletes: ['c'] });
    // стало 4 000: последняя уходит, предыдущая уменьшается с 3 000 до 2 000
    expect(adjustToTotal(list, rub(4_000))).toEqual({ createKop: 0, updates: [{ id: 'b', amountKop: rub(2_000) }], deletes: ['c'] });
  });
  it('итог 0 — все траты месяца удаляются', () => {
    expect(adjustToTotal(list, 0)).toEqual({ createKop: 0, updates: [], deletes: ['c', 'b', 'a'] });
  });
  it('частичное уменьшение одной траты', () => {
    expect(adjustToTotal(list, rub(6_000))).toEqual({ createKop: 0, updates: [{ id: 'c', amountKop: rub(1_000) }], deletes: [] });
  });
});
