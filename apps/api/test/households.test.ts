import { describe, expect, it } from 'vitest';
import { client, register, setupApp, type Session } from './helpers.js';

const ctx = setupApp();

async function invite(owner: Session, email: string): Promise<string> {
  const res = await client(ctx, owner.token)('POST', `/households/${owner.householdId}/invitations`, { email });
  expect(res.statusCode).toBe(201);
  const link = ctx.mailer.last(email)!.text.match(/\/invite\/([\w-]+)/)![1]!;
  return link;
}

async function family() {
  const owner = await register(ctx, { name: 'Иван' });
  const spouse = await register(ctx, { name: 'Мария' });
  const token = await invite(owner, spouse.email);
  const accepted = await client(ctx, spouse.token)('POST', `/invitations/${token}/accept`);
  expect(accepted.statusCode).toBe(200);
  return { owner, spouse, hid: owner.householdId };
}

describe('семья и совместный доступ', () => {
  it('чужая семья недоступна — как будто её нет', async () => {
    const a = await register(ctx);
    const b = await register(ctx);
    const res = await client(ctx, b.token)('GET', `/households/${a.householdId}/incomes`);
    expect(res.statusCode).toBe(404);
    expect((await client(ctx, b.token)('GET', '/households/not-a-uuid/incomes')).statusCode).toBe(404);
  });

  it('приглашение супруга: оба видят и редактируют один план', async () => {
    const { owner, spouse, hid } = await family();
    const spouseHouseholds = await client(ctx, spouse.token)('GET', '/households');
    expect(spouseHouseholds.data.map((h: { id: string }) => h.id)).toContain(hid);
    expect(spouseHouseholds.data.find((h: { id: string }) => h.id === hid).role).toBe('member');

    const created = await client(ctx, spouse.token)('POST', `/households/${hid}/incomes`, {
      name: 'Зарплата Марии',
      type: 'salary',
      amountKop: 15_000_000,
      periodicity: 'monthly',
      dayOfMonth: 25,
      reliability: 'stable',
    });
    expect(created.statusCode).toBe(201);
    const seen = await client(ctx, owner.token)('GET', `/households/${hid}/incomes`);
    expect(seen.data.map((i: { name: string }) => i.name)).toContain('Зарплата Марии');
    const members = await client(ctx, owner.token)('GET', `/households/${hid}/members`);
    expect(members.data.map((m: { name: string; role: string }) => `${m.name}:${m.role}`).sort()).toEqual(['Иван:owner', 'Мария:member']);
  });

  it('приглашение на другую почту не принять; использованное — не принять повторно', async () => {
    const owner = await register(ctx);
    const spouse = await register(ctx);
    const stranger = await register(ctx);
    const token = await invite(owner, spouse.email);
    expect((await client(ctx, stranger.token)('POST', `/invitations/${token}/accept`)).statusCode).toBe(403);
    expect((await client(ctx, spouse.token)('POST', `/invitations/${token}/accept`)).statusCode).toBe(200);
    expect((await client(ctx, spouse.token)('POST', `/invitations/${token}/accept`)).statusCode).toBe(404);
  });

  it('приглашение устаревает через 7 дней', async () => {
    const owner = await register(ctx);
    const spouse = await register(ctx);
    const token = await invite(owner, spouse.email);
    ctx.clock.advance(8 * 86_400_000);
    const s2 = await client(ctx)('POST', '/auth/login', { email: spouse.email, password: 'ипотека без паники', device: { platform: 'web' } });
    expect((await client(ctx, s2.data.accessToken)('POST', `/invitations/${token}/accept`)).statusCode).toBe(404);
  });

  it('участник не может приглашать, исключать других и удалять семью', async () => {
    const { owner, spouse, hid } = await family();
    const api = client(ctx, spouse.token);
    expect((await api('POST', `/households/${hid}/invitations`, { email: 'x@example.ru' })).statusCode).toBe(403);
    const members = await client(ctx, owner.token)('GET', `/households/${hid}/members`);
    const ownerMember = members.data.find((m: { role: string }) => m.role === 'owner');
    expect((await api('DELETE', `/households/${hid}/members/${ownerMember.id}`)).statusCode).toBe(403);
    expect((await api('DELETE', `/households/${hid}`)).statusCode).toBe(403);
  });

  it('участник может выйти сам; единственный владелец — нет, пока не передаст права', async () => {
    const { owner, spouse, hid } = await family();
    const members = (await client(ctx, owner.token)('GET', `/households/${hid}/members`)).data;
    const me = members.find((m: { userId: string }) => m.userId === owner.userId);
    const her = members.find((m: { userId: string }) => m.userId === spouse.userId);
    expect((await client(ctx, owner.token)('DELETE', `/households/${hid}/members/${me.id}`)).data.code).toBe('conflict');
    expect((await client(ctx, owner.token)('PATCH', `/households/${hid}/members/${her.id}`, { role: 'owner' })).statusCode).toBe(204);
    expect((await client(ctx, owner.token)('DELETE', `/households/${hid}/members/${me.id}`)).statusCode).toBe(204);
    expect((await client(ctx, owner.token)('GET', `/households/${hid}`)).statusCode).toBe(404);
    expect((await client(ctx, spouse.token)('GET', `/households/${hid}`)).data.role).toBe('owner');
  });

  it('одновременная правка: вторая правка со старой версией получает 409, а не затирает первую', async () => {
    const { owner, spouse, hid } = await family();
    const created = await client(ctx, owner.token)('POST', `/households/${hid}/living-expenses`, { name: 'Продукты', amountKop: 6_000_000 });
    const { id, version } = created.data;
    const a = await client(ctx, owner.token)('PATCH', `/households/${hid}/living-expenses/${id}`, { amountKop: 6_500_000, version });
    expect(a.statusCode).toBe(200);
    expect(a.data.version).toBe(version + 1);
    const b = await client(ctx, spouse.token)('PATCH', `/households/${hid}/living-expenses/${id}`, { amountKop: 5_000_000, version });
    expect(b.statusCode).toBe(409);
    expect(b.data.message).toMatch(/другой участник семьи/);
    const now = await client(ctx, spouse.token)('GET', `/households/${hid}/living-expenses`);
    expect(now.data[0].amountKop).toBe(6_500_000);
  });

  it('каждое изменение повышает ревизию семьи и ставит пересборку напоминаний', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const before = (await api('GET', `/households/${s.householdId}`)).data.revision;
    await api('POST', `/households/${s.householdId}/living-expenses`, { name: 'Коммуналка', amountKop: 800_000 });
    expect((await api('GET', `/households/${s.householdId}`)).data.revision).toBe(before + 1);
    expect(ctx.planChanged).toContain(s.householdId);
  });

  it('ссылка на этап или кредит чужой семьи — 404', async () => {
    const a = await register(ctx);
    const b = await register(ctx);
    const loan = await client(ctx, a.token)('POST', `/households/${a.householdId}/loans`, {
      name: 'Ипотека',
      principalKop: 500_000_000,
      annualRate: '16',
      termMonths: 240,
      type: 'annuity',
      issueDate: '2026-10-15',
    });
    const res = await client(ctx, b.token)('POST', `/households/${b.householdId}/expenses`, {
      name: 'Страховка',
      category: 'mandatory',
      planKop: 1_000_000,
      recurrence: 'yearly',
      loanId: loan.data.id,
    });
    expect(res.statusCode).toBe(404);
  });

  it('основные счета нельзя удалить, свои — можно', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const accounts = (await api('GET', `/households/${s.householdId}/accounts`)).data;
    expect((await api('DELETE', `/households/${s.householdId}/accounts/${accounts[0].id}`)).statusCode).toBe(409);
    const custom = await api('POST', `/households/${s.householdId}/accounts`, { kind: 'custom', name: 'Отпуск', balanceKop: 0, targetKop: 10_000_000 });
    expect(custom.statusCode).toBe(201);
    // своя цель встала в порядок распределения перед досрочкой
    const steps = (await api('GET', `/households/${s.householdId}/settings`)).data.allocation.steps;
    const idx = steps.findIndex((x: { accountId?: string }) => x.accountId === custom.data.id);
    expect(idx).toBe(steps.findIndex((x: { target: string }) => x.target === 'prepayment') - 1);
    expect((await api('DELETE', `/households/${s.householdId}/accounts/${custom.data.id}`)).statusCode).toBe(204);
  });

  it('ошибки валидации — по-русски и с указанием поля', async () => {
    const s = await register(ctx);
    const res = await client(ctx, s.token)('POST', `/households/${s.householdId}/incomes`, {
      name: 'Вычет',
      type: 'tax_refund',
      amountKop: 26_000_000,
      periodicity: 'once',
      reliability: 'expected',
    });
    expect(res.statusCode).toBe(400);
    expect(res.data.details[0]).toMatchObject({ path: 'date', message: 'Укажите дату поступления' });
    const float = await client(ctx, s.token)('POST', `/households/${s.householdId}/living-expenses`, { name: 'x', amountKop: 10.5 });
    expect(float.statusCode).toBe(400);
  });
});
