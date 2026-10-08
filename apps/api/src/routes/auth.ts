import {
  AuthResponse,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  LoginRequest,
  RefreshRequest,
  RegisterRequest,
  ResetPasswordRequest,
  Session,
  User,
  VerifyEmailRequest,
} from '@hypothec/api-contract';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { consumeEmailCode, createEmailCode } from '../auth/email-codes.js';
import { authenticate, clearRefreshCookie, deliverTokens, REFRESH_COOKIE } from '../auth/plugin.js';
import { issueTokens, revokeAllSessions, revokeRefreshToken, rotateRefreshToken } from '../auth/tokens.js';
import { authIdentities, consents, notificationPreferences, refreshSessions, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { assertStrongPassword, dummyVerify, hashPassword, verifyPassword } from '../lib/password.js';
import { sendResetPassword, sendVerifyEmail } from '../services/emails.js';
import { createHousehold } from '../services/households.js';
import { DEFAULT_NOTIFICATION_PREFS } from '../services/notifications.js';

const LOCK_AFTER = 10;
const LOCK_MINUTES = 15;

export function toUserDto(u: typeof users.$inferSelect): z.infer<typeof User> {
  return { id: u.id, email: u.email, name: u.name, emailVerified: Boolean(u.emailVerifiedAt), createdAt: u.createdAt.toISOString() };
}

const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = app.deps;
  const { db } = deps;

  app.post(
    '/auth/register',
    { config: authRateLimit, schema: { tags: ['auth'], summary: 'Регистрация по email и паролю', body: RegisterRequest, response: { 201: AuthResponse } } },
    async (req, reply) => {
      const { email, password, name, consents: accepted, device } = req.body;
      assertStrongPassword(password, email);
      const pd = accepted.find((c) => c.type === 'personal_data');
      if (!pd || pd.documentVersion !== deps.config.CONSENT_DOCUMENT_VERSION) {
        throw new AppError('consent_required', 'Нужно принять актуальное согласие на обработку персональных данных');
      }
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing) throw new AppError('email_taken', 'Аккаунт с этой почтой уже есть. Войдите или восстановите пароль.');

      const passwordHash = await hashPassword(password);
      const user = await db.transaction(async (tx) => {
        const [u] = await tx.insert(users).values({ email, name, passwordHash }).returning();
        await tx.insert(authIdentities).values({ userId: u!.id, provider: 'password', subject: email });
        await tx.insert(consents).values(accepted.map((c) => ({ userId: u!.id, type: c.type, documentVersion: c.documentVersion, ip: req.ip })));
        await tx.insert(notificationPreferences).values({ userId: u!.id, prefs: DEFAULT_NOTIFICATION_PREFS });
        await createHousehold(tx, u!.id, 'Наша семья');
        return u!;
      });
      const code = await createEmailCode(deps, user.id, 'verify_email');
      await sendVerifyEmail(deps, email, name, code);
      const tokens = await issueTokens(deps, user.id, device.platform, device.name ?? null);
      reply.code(201);
      return { ...deliverTokens(req, reply, tokens), user: toUserDto(user) };
    },
  );

  app.post(
    '/auth/login',
    { config: authRateLimit, schema: { tags: ['auth'], summary: 'Вход по email и паролю', body: LoginRequest, response: { 200: AuthResponse } } },
    async (req, reply) => {
      const { email, password, device } = req.body;
      const now = deps.now();
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const invalid = new AppError('invalid_credentials', 'Неверная почта или пароль');
      if (!user) {
        await dummyVerify(password);
        throw invalid;
      }
      if (user.lockedUntil && user.lockedUntil > now) {
        throw new AppError('rate_limited', `Слишком много попыток входа. Попробуйте через ${LOCK_MINUTES} минут или восстановите пароль.`);
      }
      if (!(await verifyPassword(user.passwordHash, password))) {
        const failed = user.failedLogins + 1;
        await db
          .update(users)
          .set({ failedLogins: failed >= LOCK_AFTER ? 0 : failed, lockedUntil: failed >= LOCK_AFTER ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null })
          .where(eq(users.id, user.id));
        throw invalid;
      }
      if (user.failedLogins > 0 || user.lockedUntil) await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
      const tokens = await issueTokens(deps, user.id, device.platform, device.name ?? null);
      return { ...deliverTokens(req, reply, tokens), user: toUserDto(user) };
    },
  );

  app.post(
    '/auth/refresh',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['auth'], summary: 'Обновить access-токен', body: RefreshRequest.nullish(), response: { 200: AuthResponse } } },
    async (req, reply) => {
      const token = req.body?.refreshToken ?? req.cookies[REFRESH_COOKIE];
      if (!token) throw new AppError('unauthorized', 'Сессия истекла, войдите снова');
      const tokens = await rotateRefreshToken(deps, token);
      const [user] = await db.select().from(users).where(eq(users.id, tokens.userId)).limit(1);
      if (!user) throw new AppError('unauthorized', 'Сессия истекла, войдите снова');
      return { ...deliverTokens(req, reply, tokens), user: toUserDto(user) };
    },
  );

  app.post('/auth/logout', { schema: { tags: ['auth'], summary: 'Выйти', body: RefreshRequest.nullish() } }, async (req, reply) => {
    const token = req.body?.refreshToken ?? req.cookies[REFRESH_COOKIE];
    if (token) await revokeRefreshToken(deps, token);
    clearRefreshCookie(reply);
    reply.code(204);
  });

  app.post('/auth/password/forgot', { config: authRateLimit, schema: { tags: ['auth'], summary: 'Код для сброса пароля', body: ForgotPasswordRequest } }, async (req, reply) => {
    const [user] = await db.select().from(users).where(eq(users.email, req.body.email)).limit(1);
    if (user) {
      const code = await createEmailCode(deps, user.id, 'reset_password');
      await sendResetPassword(deps, user.email, code);
    }
    // одинаковый ответ, есть аккаунт или нет
    reply.code(204);
  });

  app.post('/auth/password/reset', { config: authRateLimit, schema: { tags: ['auth'], summary: 'Новый пароль по коду из письма', body: ResetPasswordRequest } }, async (req, reply) => {
    const { email, code, newPassword } = req.body;
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) throw new AppError('invalid_code', 'Код неверный или устарел. Запросите новый.');
    await consumeEmailCode(deps, user.id, 'reset_password', code);
    assertStrongPassword(newPassword, email);
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword), failedLogins: 0, lockedUntil: null, emailVerifiedAt: user.emailVerifiedAt ?? deps.now(), updatedAt: deps.now() })
      .where(eq(users.id, user.id));
    await revokeAllSessions(deps, user.id);
    reply.code(204);
  });

  // ── дальше — только для вошедших ──
  await app.register(async (scope) => {
    const authed = scope.withTypeProvider<ZodTypeProvider>();
    authed.addHook('onRequest', authenticate);

    authed.post('/auth/verify-email', { schema: { tags: ['auth'], summary: 'Подтвердить почту кодом', body: VerifyEmailRequest, response: { 200: User } } }, async (req) => {
      await consumeEmailCode(deps, req.user.id, 'verify_email', req.body.code);
      const [u] = await db.update(users).set({ emailVerifiedAt: deps.now() }).where(eq(users.id, req.user.id)).returning();
      return toUserDto(u!);
    });

    authed.post(
      '/auth/verify-email/resend',
      { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } }, schema: { tags: ['auth'], summary: 'Отправить код подтверждения ещё раз' } },
      async (req, reply) => {
        const [u] = await db.select().from(users).where(eq(users.id, req.user.id)).limit(1);
        if (u && !u.emailVerifiedAt) await sendVerifyEmail(deps, u.email, u.name, await createEmailCode(deps, u.id, 'verify_email'));
        reply.code(204);
      },
    );

    authed.post('/auth/password/change', { schema: { tags: ['auth'], summary: 'Сменить пароль', body: ChangePasswordRequest } }, async (req, reply) => {
      const [u] = await db.select().from(users).where(eq(users.id, req.user.id)).limit(1);
      if (!u || !(await verifyPassword(u.passwordHash, req.body.currentPassword))) throw new AppError('invalid_credentials', 'Текущий пароль указан неверно');
      assertStrongPassword(req.body.newPassword, u.email);
      await db.update(users).set({ passwordHash: await hashPassword(req.body.newPassword), updatedAt: deps.now() }).where(eq(users.id, u.id));
      // остальные устройства выходят из аккаунта, текущее остаётся
      await db
        .update(refreshSessions)
        .set({ revokedAt: deps.now() })
        .where(and(eq(refreshSessions.userId, u.id), isNull(refreshSessions.revokedAt), ne(refreshSessions.id, req.user.sessionId)));
      reply.code(204);
    });

    authed.get('/auth/sessions', { schema: { tags: ['auth'], summary: 'Активные устройства', response: { 200: z.array(Session) } } }, async (req) => {
      const rows = await db
        .select()
        .from(refreshSessions)
        .where(and(eq(refreshSessions.userId, req.user.id), isNull(refreshSessions.revokedAt), gt(refreshSessions.expiresAt, deps.now())))
        .orderBy(desc(refreshSessions.lastUsedAt));
      return rows.map((s) => ({
        id: s.id,
        platform: s.platform as 'web' | 'ios' | 'android',
        deviceName: s.deviceName,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        current: s.id === req.user.sessionId,
      }));
    });

    authed.delete('/auth/sessions/:id', { schema: { tags: ['auth'], summary: 'Выйти на устройстве', params: z.object({ id: z.uuid() }) } }, async (req, reply) => {
      await db
        .update(refreshSessions)
        .set({ revokedAt: deps.now() })
        .where(and(eq(refreshSessions.id, req.params.id), eq(refreshSessions.userId, req.user.id)));
      reply.code(204);
    });
  });
};
