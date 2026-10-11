import { DeleteAccountRequest, UpdateMeRequest, User } from '@hypothec/api-contract';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { consumeEmailCode, createEmailCode } from '../auth/email-codes.js';
import { clearRefreshCookie } from '../auth/plugin.js';
import * as s from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import { sendDeleteAccountCode } from '../services/emails.js';
import { mergePrefs, REMINDER_LABELS, type ReminderType } from '../services/notifications.js';
import { toUserDto } from './auth.js';

const ReminderPref = z.object({ email: z.boolean(), push: z.boolean(), daysBefore: z.number().int().min(0).max(60) });
const Prefs = z.record(z.enum(Object.keys(REMINDER_LABELS) as [ReminderType, ...ReminderType[]]), ReminderPref);

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = app.deps;
  const { db } = deps;
  const tags = ['me'];

  app.get('/me', { schema: { tags, summary: 'Профиль', response: { 200: User } } }, async (req) => {
    const [u] = await db.select().from(s.users).where(eq(s.users.id, req.user.id)).limit(1);
    if (!u) throw new AppError('unauthorized', 'Аккаунт не найден');
    return toUserDto(u);
  });

  app.patch('/me', { schema: { tags, summary: 'Изменить имя или режим интерфейса', body: UpdateMeRequest, response: { 200: User } } }, async (req) => {
    const [u] = await db
      .update(s.users)
      .set({ ...(req.body.name ? { name: req.body.name } : {}), ...(req.body.uiMode ? { uiMode: req.body.uiMode } : {}), updatedAt: deps.now() })
      .where(eq(s.users.id, req.user.id))
      .returning();
    return toUserDto(u!);
  });

  app.get('/me/notification-preferences', { schema: { tags, summary: 'Настройки напоминаний' } }, async (req) => {
    const [p] = await db.select().from(s.notificationPreferences).where(eq(s.notificationPreferences.userId, req.user.id)).limit(1);
    return { prefs: mergePrefs(p?.prefs), labels: REMINDER_LABELS };
  });

  app.put('/me/notification-preferences', { schema: { tags, summary: 'Сохранить настройки напоминаний', body: z.object({ prefs: Prefs }) } }, async (req) => {
    const prefs = mergePrefs(req.body.prefs);
    await db
      .insert(s.notificationPreferences)
      .values({ userId: req.user.id, prefs })
      .onConflictDoUpdate({ target: s.notificationPreferences.userId, set: { prefs, updatedAt: deps.now() } });
    const memberships = await db.select().from(s.householdMembers).where(eq(s.householdMembers.userId, req.user.id));
    for (const m of memberships) await deps.jobs.planChanged(m.householdId);
    return { prefs, labels: REMINDER_LABELS };
  });

  app.post(
    '/me/push-devices',
    { schema: { tags, summary: 'Зарегистрировать устройство для push (мобильное приложение)', body: z.object({ token: z.string().min(10).max(500), platform: z.enum(['ios', 'android']) }) } },
    async (req, reply) => {
      await db
        .insert(s.pushDevices)
        .values({ userId: req.user.id, token: req.body.token, platform: req.body.platform })
        .onConflictDoUpdate({ target: s.pushDevices.token, set: { userId: req.user.id } });
      reply.code(204);
    },
  );

  /** Выгрузка всех своих данных (152-ФЗ): профиль, согласия, устройства и данные всех семей, где пользователь участник. */
  app.get('/me/export', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } }, schema: { tags, summary: 'Скачать все мои данные (JSON)' } }, async (req, reply) => {
    const uid = req.user.id;
    const [user] = await db.select().from(s.users).where(eq(s.users.id, uid));
    const memberships = await db.select().from(s.householdMembers).where(eq(s.householdMembers.userId, uid));
    const hids = memberships.map((m) => m.householdId);
    const byH = async <T extends { householdId: never }>(t: T) => (hids.length ? db.select().from(t as never).where(inArray((t as { householdId: never }).householdId, hids)) : []);
    const { passwordHash: _ph, failedLogins: _fl, lockedUntil: _lu, ...profile } = user!;
    const data = {
      exportedAt: deps.now().toISOString(),
      format: 'hypothec-export/1',
      profile,
      consents: await db.select().from(s.consents).where(eq(s.consents.userId, uid)),
      sessions: (await db.select().from(s.refreshSessions).where(eq(s.refreshSessions.userId, uid))).map(({ tokenHash: _t, ...r }) => r),
      notificationPreferences: await db.select().from(s.notificationPreferences).where(eq(s.notificationPreferences.userId, uid)),
      notifications: await db.select().from(s.notifications).where(eq(s.notifications.userId, uid)),
      households: hids.length ? await db.select().from(s.households).where(inArray(s.households.id, hids)) : [],
      members: await byH(s.householdMembers as never),
      scenarios: await byH(s.scenarios as never),
      stages: await byH(s.stages as never),
      stageDocuments: await byH(s.stageDocuments as never),
      loans: await byH(s.loans as never),
      expenses: await byH(s.expenses as never),
      livingExpenses: await byH(s.livingExpenses as never),
      spendings: await byH(s.spendings as never),
      goalContributions: await byH(s.goalContributions as never),
      incomes: await byH(s.incomes as never),
      accounts: await byH(s.accounts as never),
      prepaymentScenarios: await byH(s.prepaymentScenarios as never),
      prepayments: await byH(s.prepayments as never),
      transfersDone: await byH(s.transfersDone as never),
      recommendationStates: await byH(s.recommendationStates as never),
      auditLog: await byH(s.auditLog as never),
    };
    reply.header('content-disposition', `attachment; filename="hypothec-export-${deps.now().toISOString().slice(0, 10)}.json"`);
    return data;
  });

  app.post(
    '/me/delete/request',
    { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } }, schema: { tags, summary: 'Код для удаления аккаунта на почту' } },
    async (req, reply) => {
      const [u] = await db.select().from(s.users).where(eq(s.users.id, req.user.id)).limit(1);
      await sendDeleteAccountCode(deps, u!.email, await createEmailCode(deps, u!.id, 'delete_account'));
      reply.code(204);
    },
  );

  /**
   * Полное удаление аккаунта. Семьи, где пользователь единственный участник, удаляются целиком;
   * в остальных права владельца переходят к другому участнику, общий план остаётся у него.
   */
  app.delete('/me', { schema: { tags, summary: 'Удалить аккаунт и все данные', body: DeleteAccountRequest } }, async (req, reply) => {
    const uid = req.user.id;
    const [u] = await db.select().from(s.users).where(eq(s.users.id, uid)).limit(1);
    if (!u || !(await verifyPassword(u.passwordHash, req.body.password))) throw new AppError('invalid_credentials', 'Пароль указан неверно');
    await consumeEmailCode(deps, uid, 'delete_account', req.body.code);
    await db.transaction(async (tx) => {
      const memberships = await tx.select().from(s.householdMembers).where(eq(s.householdMembers.userId, uid));
      for (const m of memberships) {
        const others = await tx
          .select()
          .from(s.householdMembers)
          .where(and(eq(s.householdMembers.householdId, m.householdId), ne(s.householdMembers.userId, uid)))
          .orderBy(asc(s.householdMembers.createdAt));
        if (others.length === 0) {
          await tx.delete(s.households).where(eq(s.households.id, m.householdId));
        } else if (m.role === 'owner' && !others.some((o) => o.role === 'owner')) {
          await tx.update(s.householdMembers).set({ role: 'owner' }).where(eq(s.householdMembers.id, others[0]!.id));
        }
      }
      // доходы, привязанные к удаляемому участнику, остаются в общем плане без привязки (ON DELETE SET NULL)
      await tx.delete(s.users).where(eq(s.users.id, uid));
    });
    clearRefreshCookie(reply);
    reply.code(204);
  });
};
