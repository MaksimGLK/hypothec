import { describe, expect, it } from 'vitest';
import { client, register, setupApp, WIZARD } from './helpers.js';

const ctx = setupApp();

describe('бюджет на жизнь', () => {
  it('стартовый набор категорий, план, траты одной строкой и итог месяца', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;

    const boot = await api('POST', p('/budget/bootstrap'), {});
    expect(boot.data.created).toBeGreaterThanOrEqual(8);
    // повторный запуск не плодит дубли
    expect((await api('POST', p('/budget/bootstrap'), {})).data.created).toBe(0);

    const cats = (await api('GET', p('/living-expenses'))).data as { id: string; name: string; version: number; essential: boolean; catalogKey: string }[];
    const food = cats.find((c) => c.catalogKey === 'groceries')!;
    const cafe = cats.find((c) => c.catalogKey === 'cafe')!;
    expect(cafe.essential).toBe(false);
    await api('PATCH', p(`/living-expenses/${food.id}`), { amountKop: 4_000_000, version: food.version });
    await api('PATCH', p(`/living-expenses/${cafe.id}`), { amountKop: 1_000_000, version: cafe.version });

    const parsed = await api('POST', p('/budget/parse'), { text: 'пятёрочка 3 450' });
    expect(parsed.data).toMatchObject({ categoryId: food.id, amountKop: 345_000 });
    const created = await api('POST', p('/budget/spendings'), { categoryId: parsed.data.categoryId, amountKop: parsed.data.amountKop, date: '2026-10-08', note: parsed.data.note });
    expect(created.statusCode, created.body).toBe(201);
    await api('POST', p('/budget/spendings'), { categoryId: cafe.id, amountKop: 1_250_000, date: '2026-10-05' });
    await api('POST', p('/budget/spendings'), { categoryId: food.id, amountKop: 999_900, date: '2026-09-28' });

    const sum = await api('GET', p('/budget/summary?month=2026-10'));
    expect(sum.statusCode, sum.body).toBe(200);
    const f = sum.data.categories.find((c: { categoryId: string }) => c.categoryId === food.id);
    expect(f).toMatchObject({ planKop: 4_000_000, factKop: 345_000, leftKop: 3_655_000 });
    expect(sum.data.overspendKop).toBe(250_000);
    expect(sum.data.daysLeft).toBe(24);

    const list = await api('GET', p('/budget/spendings?month=2026-10'));
    expect(list.data).toHaveLength(2);
    expect(list.data[0].date).toBe('2026-10-08');

    // правка и удаление траты, проверка версии
    const sp = created.data;
    expect((await api('PATCH', p(`/budget/spendings/${sp.id}`), { amountKop: 400_000, version: sp.version })).statusCode).toBe(200);
    expect((await api('PATCH', p(`/budget/spendings/${sp.id}`), { amountKop: 1, version: sp.version })).statusCode).toBe(409);
    expect((await api('DELETE', p(`/budget/spendings/${sp.id}`))).statusCode).toBe(204);
    expect((await api('GET', p('/budget/summary?month=2026-10'))).data.categories.find((c: { categoryId: string }) => c.categoryId === food.id).factKop).toBe(0);
  });

  it('план расходов попадает в подушку; необязательные траты — нет', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;
    await api('POST', p('/wizard'), WIZARD);
    const before = (await api('GET', p('/cushion'))).data.monthlyObligatoryKop;
    await api('POST', p('/living-expenses'), { name: 'Продукты', amountKop: 4_000_000, essential: true });
    const withFood = (await api('GET', p('/cushion'))).data.monthlyObligatoryKop;
    expect(withFood - before).toBeGreaterThanOrEqual(3_900_000);
    await api('POST', p('/living-expenses'), { name: 'Кафе', amountKop: 1_000_000, essential: false });
    expect((await api('GET', p('/cushion'))).data.monthlyObligatoryKop).toBe(withFood);
  });

  it('мастер сразу заполняет бюджет; без бюджета — совет его заполнить', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;
    await api('POST', p('/wizard'), WIZARD);
    await api('POST', p('/incomes'), { name: 'Зарплата', type: 'salary', amountKop: 25_000_000, periodicity: 'monthly', dayOfMonth: 10, reliability: 'stable' });
    const recs = (await api('GET', p('/recommendations'))).data.items.map((r: { ruleKey: string }) => r.ruleKey);
    expect(recs).toContain('budget_not_set');

    const s2 = await register(ctx);
    const api2 = client(ctx, s2.token);
    const p2 = (x: string) => `/households/${s2.householdId}${x}`;
    const res = await api2('POST', p2('/wizard'), {
      ...WIZARD,
      budget: [
        { catalogKey: 'utilities', amountKop: 800_000 },
        { catalogKey: 'groceries', amountKop: 4_000_000 },
        { catalogKey: 'rent', amountKop: 4_500_000 },
        { catalogKey: 'cafe', amountKop: 0 },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const cats = (await api2('GET', p2('/living-expenses'))).data;
    expect(cats.map((c: { catalogKey: string }) => c.catalogKey)).toEqual(['utilities', 'groceries', 'rent']);
    expect(cats.find((c: { catalogKey: string }) => c.catalogKey === 'rent').endsAtKeys).toBe(true);
  });

  it('трата без категории отдаётся в списке (categoryId: null)', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;
    expect((await api('POST', p('/budget/spendings'), { categoryId: null, amountKop: 1_000_000, date: '2026-10-05', note: 'Карате дети' })).statusCode).toBe(201);
    const list = await api('GET', p('/budget/spendings?month=2026-10'));
    expect(list.statusCode, list.body).toBe(200);
    expect(list.data[0]).toMatchObject({ categoryId: null, note: 'Карате дети' });
  });

  it('трата с категорией чужой семьи — 404', async () => {
    const a = await register(ctx);
    const b = await register(ctx);
    const cat = await client(ctx, a.token)('POST', `/households/${a.householdId}/living-expenses`, { name: 'Продукты', amountKop: 100 });
    const res = await client(ctx, b.token)('POST', `/households/${b.householdId}/budget/spendings`, { categoryId: cat.data.id, amountKop: 100, date: '2026-10-08' });
    expect(res.statusCode).toBe(404);
  });
});

describe('режим интерфейса', () => {
  it('по умолчанию простой, переключается и запоминается для всех устройств', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    expect((await api('GET', '/me')).data.uiMode).toBe('simple');
    expect((await api('PATCH', '/me', { uiMode: 'advanced' })).data.uiMode).toBe('advanced');
    const login = await client(ctx)('POST', '/auth/login', { email: s.email, password: 'ипотека без паники', device: { platform: 'android' } });
    expect(login.data.user.uiMode).toBe('advanced');
    expect((await api('PATCH', '/me', { uiMode: 'expert' })).statusCode).toBe(400);
  });
});

describe('распределение долями', () => {
  it('доли сохраняются в настройках и сразу меняют переводы', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;
    await api('POST', p('/wizard'), { ...WIZARD, startDate: '2026-08-01' });
    await api('POST', p('/incomes'), { name: 'Зарплата', type: 'salary', amountKop: 50_000_000, periodicity: 'monthly', dayOfMonth: 10, reliability: 'stable' });
    const st = (await api('GET', p('/settings'))).data;
    const res = await api('PATCH', p('/settings'), {
      version: st.version,
      allocation: {
        ...st.allocation,
        distribution: 'split',
        steps: [
          { target: 'full_cushion', sources: 'any', enabled: true, sharePercent: 70 },
          { target: 'prepayment', sources: 'any', enabled: true, sharePercent: 30 },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.data.allocation.distribution).toBe('split');
    const cal = (await api('GET', p('/allocation-calendar?from=2026-10-01&to=2026-12-31'))).data;
    const withGoals = cal.transfers.find((t: { lines: { purpose: string }[] }) => t.lines.filter((l) => l.purpose === 'goal').length === 2);
    expect(withGoals).toBeDefined();
    const goals = withGoals.lines.filter((l: { purpose: string }) => l.purpose === 'goal');
    const cushion = goals.find((l: { accountKind: string }) => l.accountKind === 'cushion').amountKop;
    const prepay = goals.find((l: { accountKind: string }) => l.accountKind === 'prepayment').amountKop;
    expect(cushion / (cushion + prepay)).toBeCloseTo(0.7, 2);
  });
});

describe('оплата по плану и автоплатежи', () => {
  it('кнопка «Оплачено» записывает трату с пометкой', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;
    const cat = (await api('POST', p('/living-expenses'), { name: 'Связь', amountKop: 100_000 })).data;
    const res = await api('POST', p('/budget/spendings'), { categoryId: cat.id, amountKop: 100_000, date: '2026-10-08', source: 'plan', note: 'Оплачено по плану' });
    expect(res.data.source).toBe('plan');
    // подделать автоплатёж с клиента нельзя
    const fake = await api('POST', p('/budget/spendings'), { categoryId: cat.id, amountKop: 1, date: '2026-10-08', source: 'auto' });
    expect(fake.data.source).toBe('manual');
  });

  it('автоплатёж записывается в свой день один раз, не дублирует ручную оплату и не воскресает после удаления', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;
    // сегодня по Москве — 8 октября
    const util = (await api('POST', p('/living-expenses'), { name: 'Коммуналка', amountKop: 1_200_000, autoPayDay: 5 })).data;
    const phone = (await api('POST', p('/living-expenses'), { name: 'Связь', amountKop: 100_000, autoPayDay: 20 })).data;
    const rent = (await api('POST', p('/living-expenses'), { name: 'Аренда', amountKop: 4_500_000, autoPayDay: 1 })).data;
    await api('POST', p('/budget/spendings'), { categoryId: rent.id, amountKop: 4_500_000, date: '2026-10-01' });
    expect(util.autoPayDay).toBe(5);

    const list = async () => (await api('GET', p('/budget/spendings?month=2026-10'))).data as { categoryId: string; source: string; date: string; id: string }[];
    let items = await list();
    const auto = items.filter((x) => x.source === 'auto');
    expect(auto.map((x) => `${x.categoryId === util.id ? 'util' : 'other'}:${x.date}`)).toEqual(['util:2026-10-05']);
    // аренду уже оплатили вручную — автоплатёж её не дублирует; связь — 20-го, ещё рано
    expect(items.filter((x) => x.categoryId === rent.id)).toHaveLength(1);
    expect(items.some((x) => x.categoryId === phone.id)).toBe(false);

    // повторное открытие — без дублей
    await api('GET', p('/budget/summary?month=2026-10'));
    expect((await list()).filter((x) => x.source === 'auto')).toHaveLength(1);

    // удалили автоплатёж (например, счёт оплатили иначе) — он не возвращается
    await api('DELETE', p(`/budget/spendings/${auto[0]!.id}`));
    items = await list();
    expect(items.filter((x) => x.categoryId === util.id)).toHaveLength(0);

    // наступило 20-е — записалась связь
    ctx.clock.advance(12 * 86_400_000);
    const login = await client(ctx)('POST', '/auth/login', { email: s.email, password: 'ипотека без паники', device: { platform: 'web' } });
    const api2 = client(ctx, login.data.accessToken);
    const later = (await api2('GET', p('/budget/spendings?month=2026-10'))).data as { categoryId: string; source: string }[];
    expect(later.filter((x) => x.categoryId === phone.id && x.source === 'auto')).toHaveLength(1);
    ctx.clock.advance(-12 * 86_400_000);
  });
});

describe('куда уходит доход', () => {
  it('диаграмма месяца: сумма частей равна доходу, вне плана — по факту', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;
    await api('POST', p('/wizard'), WIZARD);
    await api('POST', p('/incomes'), { name: 'Зарплата', type: 'salary', amountKop: 30_000_000, periodicity: 'monthly', dayOfMonth: 10, reliability: 'stable' });
    const cafe = (await api('POST', p('/living-expenses'), { name: 'Кафе', amountKop: 1_000_000, essential: false })).data;
    await api('POST', p('/budget/spendings'), { categoryId: cafe.id, amountKop: 1_500_000, date: '2026-11-03' });
    const d = (await api('GET', p('/budget/distribution?month=2026-11'))).data;
    expect(d.incomeKop).toBe(30_000_000);
    expect(d.segments.reduce((sum: number, x: { amountKop: number }) => sum + x.amountKop, 0)).toBe(d.incomeKop + d.shortfallKop);
    expect(d.segments.find((x: { key: string }) => x.key === 'unplanned').amountKop).toBe(500_000);
  });
});

describe('ячейка «Потрачено»', () => {
  it('итог за месяц: больше — добавляется разница, меньше — уменьшаются свежие траты', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;
    const cat = (await api('POST', p('/living-expenses'), { name: 'Транспорт', amountKop: 1_200_000 })).data;
    const total = async () => (await api('GET', p('/budget/summary?month=2026-10'))).data.categories.find((c: { categoryId: string }) => c.categoryId === cat.id).factKop;
    expect((await api('POST', p(`/budget/categories/${cat.id}/month-total`), { month: '2026-10', totalKop: 250_000 })).statusCode).toBe(200);
    expect(await total()).toBe(250_000);
    await api('POST', p(`/budget/categories/${cat.id}/month-total`), { month: '2026-10', totalKop: 750_000 });
    expect(await total()).toBe(750_000);
    expect((await api('GET', p('/budget/spendings?month=2026-10'))).data).toHaveLength(2);
    await api('POST', p(`/budget/categories/${cat.id}/month-total`), { month: '2026-10', totalKop: 100_000 });
    expect(await total()).toBe(100_000);
    await api('POST', p(`/budget/categories/${cat.id}/month-total`), { month: '2026-10', totalKop: 0 });
    expect(await total()).toBe(0);
  });
});

describe('копилка: план и факт', () => {
  it('факт взноса в цель сохраняется и меняет остаток счёта на разницу', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;
    const accounts = (await api('GET', p('/accounts'))).data;
    const cushion = accounts.find((a: { kind: string }) => a.kind === 'cushion');
    const set = (amountKop: number) => api('PUT', p('/budget/contributions'), { accountId: cushion.id, month: '2026-10', amountKop });
    const r1 = await set(7_500_000);
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r1.data.balanceKop).toBe(7_500_000);
    const r2 = await set(7_000_000);
    expect(r2.data).toMatchObject({ deltaKop: -500_000, balanceKop: 7_000_000 });
    const list = (await api('GET', p('/budget/contributions?month=2026-10'))).data;
    expect(list).toEqual([{ accountId: cushion.id, month: '2026-10', amountKop: 7_000_000 }]);
    expect((await api('GET', p('/accounts'))).data.find((a: { kind: string }) => a.kind === 'cushion').balanceKop).toBe(7_000_000);
    // чужой счёт — 404
    const other = await register(ctx);
    expect((await client(ctx, other.token)('PUT', `/households/${other.householdId}/budget/contributions`, { accountId: cushion.id, month: '2026-10', amountKop: 1 })).statusCode).toBe(404);
  });
});
