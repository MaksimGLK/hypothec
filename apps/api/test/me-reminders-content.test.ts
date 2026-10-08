import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { parseLesson } from '../src/content/parse.js';
import { notifications, users } from '../src/db/schema.js';
import { rebuildHouseholdReminders, sendDueNotifications } from '../src/services/notifications.js';
import { client, lastCode, register, setupApp, WIZARD } from './helpers.js';

const ctx = setupApp();

async function familyWithPlan() {
  const s = await register(ctx);
  const api = client(ctx, s.token);
  const path = (p: string) => `/households/${s.householdId}${p}`;
  await api('POST', path('/wizard'), WIZARD);
  await api('POST', path('/incomes'), { name: 'Зарплата', type: 'salary', amountKop: 30_000_000, periodicity: 'monthly', dayOfMonth: 10, reliability: 'stable' });
  return { s, api, path };
}

describe('мои данные (152-ФЗ)', () => {
  it('экспорт содержит профиль, согласия и данные семьи, но не секреты', async () => {
    const { api } = await familyWithPlan();
    const res = await api('GET', '/me/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.data.consents[0]).toMatchObject({ type: 'personal_data', documentVersion: '2026-10' });
    expect(res.data.incomes).toHaveLength(1);
    expect(res.data.stages.length).toBeGreaterThan(5);
    expect(res.body).not.toMatch(/passwordHash|password_hash|tokenHash|argon2/);
  });

  it('удаление аккаунта: нужен пароль и код из письма; данные стираются', async () => {
    const { s, api } = await familyWithPlan();
    await api('POST', '/me/delete/request');
    const code = lastCode(ctx, s.email);
    expect((await api('DELETE', '/me', { password: 'неверный', code })).statusCode).toBe(401);
    expect((await api('DELETE', '/me', { password: 'ипотека без паники', code })).statusCode).toBe(204);
    const [u] = await ctx.deps.db.select().from(users).where(eq(users.id, s.userId));
    expect(u).toBeUndefined();
    expect((await client(ctx)('POST', '/auth/login', { email: s.email, password: 'ипотека без паники', device: { platform: 'web' } })).statusCode).toBe(401);
  });

  it('если в семье есть супруг — план остаётся у него, права владельца переходят', async () => {
    const owner = await register(ctx);
    const spouse = await register(ctx);
    await client(ctx, owner.token)('POST', `/households/${owner.householdId}/invitations`, { email: spouse.email });
    const token = ctx.mailer.last(spouse.email)!.text.match(/\/invite\/([\w-]+)/)![1]!;
    await client(ctx, spouse.token)('POST', `/invitations/${token}/accept`);
    await client(ctx, owner.token)('POST', '/me/delete/request');
    await client(ctx, owner.token)('DELETE', '/me', { password: 'ипотека без паники', code: lastCode(ctx, owner.email) });
    const h = await client(ctx, spouse.token)('GET', `/households/${owner.householdId}`);
    expect(h.statusCode).toBe(200);
    expect(h.data.role).toBe('owner');
  });
});

describe('напоминания', () => {
  it('строятся по плану для подтверждённых участников и уходят одним письмом', async () => {
    const { s, path } = await familyWithPlan();
    const r = await rebuildHouseholdReminders(ctx.deps, s.householdId);
    expect(r.scheduled).toBeGreaterThan(0);
    const rows = await ctx.deps.db.select().from(notifications).where(eq(notifications.householdId, s.householdId));
    const types = new Set(rows.map((x) => x.type));
    expect(types).toContain('stage');
    expect(types).toContain('transfer');
    // повторная пересборка не плодит дубли
    await rebuildHouseholdReminders(ctx.deps, s.householdId);
    const again = await ctx.deps.db.select().from(notifications).where(eq(notifications.householdId, s.householdId));
    expect(again).toHaveLength(rows.length);

    // наступает время — письма уходят пачкой
    ctx.clock.advance(3 * 86_400_000);
    const before = ctx.mailer.sent.length;
    const sent = await sendDueNotifications(ctx.deps);
    expect(sent).toBeGreaterThan(0);
    const mail = ctx.mailer.sent.slice(before).find((m) => m.to === s.email)!;
    expect(mail.text).toMatch(/Настроить напоминания/);
    expect(await sendDueNotifications(ctx.deps)).toBe(0);

    // этап удалён — его напоминание отменяется (часы ушли вперёд — входим заново)
    const login = await client(ctx)('POST', '/auth/login', { email: s.email, password: 'ипотека без паники', device: { platform: 'web' } });
    const api = client(ctx, login.data.accessToken);
    const stages = (await api('GET', path('/stages'))).data;
    const pendingStage = (await ctx.deps.db.select().from(notifications).where(eq(notifications.householdId, s.householdId))).find(
      (n) => n.type === 'stage' && n.status === 'pending',
    );
    if (pendingStage) {
      const stage = stages.find((x: { title: string }) => pendingStage.body.includes(x.title));
      await api('DELETE', path(`/stages/${stage.id}`));
      await rebuildHouseholdReminders(ctx.deps, s.householdId);
      const [after] = await ctx.deps.db.select().from(notifications).where(eq(notifications.id, pendingStage.id));
      expect(after!.status).toBe('cancelled');
    }
  });

  it('неподтверждённая почта — без писем; отключённый тип — без напоминаний', async () => {
    const unverified = await register(ctx, { verify: false });
    await client(ctx, unverified.token)('POST', `/households/${unverified.householdId}/wizard`, WIZARD);
    expect((await rebuildHouseholdReminders(ctx.deps, unverified.householdId)).scheduled).toBe(0);

    const { s, api } = await familyWithPlan();
    const prefs = (await api('GET', '/me/notification-preferences')).data.prefs;
    await api('PUT', '/me/notification-preferences', { prefs: { ...prefs, stage: { ...prefs.stage, email: false } } });
    await rebuildHouseholdReminders(ctx.deps, s.householdId);
    const rows = await ctx.deps.db.select().from(notifications).where(eq(notifications.householdId, s.householdId));
    expect(rows.some((x) => x.type === 'stage' && x.status === 'pending')).toBe(false);
  });
});

describe('уроки и словарь', () => {
  it('список уроков и урок с расчётом на данных семьи', async () => {
    const { s, api } = await familyWithPlan();
    const list = await api('GET', '/content/lessons');
    expect(list.data.map((l: { key: string }) => l.key)).toEqual(expect.arrayContaining(['annuity', 'cushion', 'prepayment', 'tax_deduction', 'insurance', 'escrow']));
    const general = await api('GET', '/content/lessons/annuity');
    expect(general.data.personal).toBeNull();
    expect(general.data.quiz.length).toBeGreaterThanOrEqual(2);
    expect(general.data.sources[0].url).toMatch(/^https?:\/\//);
    const personal = await api('GET', `/content/lessons/annuity?householdId=${s.householdId}`);
    expect(personal.data.personal).toMatch(/Первый платёж — [\d\s ]+₽/);
    expect(personal.data.personal).not.toContain('{{');
  });

  it('урок с чужой семьёй не персонализируется', async () => {
    const a = await familyWithPlan();
    const b = await register(ctx);
    expect((await client(ctx, b.token)('GET', `/content/lessons/annuity?householdId=${a.s.householdId}`)).statusCode).toBe(404);
  });

  it('словарь терминов', async () => {
    const { api } = await familyWithPlan();
    const g = await api('GET', '/content/glossary');
    expect(g.data.length).toBeGreaterThan(20);
    expect(g.data.find((t: { key: string }) => t.key === 'escrow')).toMatchObject({ term: 'Эскроу-счёт', lessonKey: 'escrow' });
  });

  it('разбор урока проверяет формат', () => {
    expect(() => parseLesson('x', 'без frontmatter')).toThrow(/frontmatter/);
    const noSources = '---\ntitle: T\nminutes: 2\nreviewedAt: 2026-10-08\n---\nтекст';
    expect(() => parseLesson('x', noSources)).toThrow(/источник/);
    const twoCorrect = '---\ntitle: T\nminutes: 2\nsources: A | https://a.ru\nreviewedAt: 2026-10-08\n---\nтекст\n## Проверьте себя\n? Вопрос\n- [x] а\n- [x] б';
    expect(() => parseLesson('x', twoCorrect)).toThrow(/ровно один/);
  });

  it('OpenAPI-документация доступна', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/docs/json' });
    expect(res.statusCode).toBe(200);
    const spec = JSON.parse(res.body);
    expect(Object.keys(spec.paths).length).toBeGreaterThan(50);
    expect(spec.paths['/api/v1/auth/register'].post.requestBody).toBeDefined();
  });
});
