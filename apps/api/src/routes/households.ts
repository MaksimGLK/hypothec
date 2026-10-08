import {
  CreateHouseholdRequest,
  Household,
  HouseholdMember,
  HouseholdSettings as HouseholdSettingsDto,
  Invitation,
  InviteRequest,
  Scenario as ScenarioDto,
  Stage as StageDto,
  TaxMember,
  UpdateHouseholdSettingsRequest,
  UpdateScenarioRequest,
  UpdateTaxMembersRequest,
  WizardAnswers,
} from '@hypothec/api-contract';
import { buildInitialPlan, type HouseholdSettings } from '@hypothec/core';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { todayInMoscow } from '../config.js';
import * as s from '../db/schema.js';
import { hashSecret, randomToken } from '../lib/crypto.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { sendInvitation } from '../services/emails.js';
import { createHousehold, requireOwner } from '../services/households.js';
import { cancelUserReminders } from '../services/notifications.js';
import { settingsOf } from '../services/plan.js';
import { mutate } from './helpers.js';
import { loadStages } from './stages.js';

const INVITE_TTL_DAYS = 7;

/** Эндпоинты, не привязанные к конкретной семье: список, создание, принятие приглашения. */
export const householdRootRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;

  app.get('/households', { schema: { tags: ['household'], summary: 'Мои семьи', response: { 200: z.array(Household) } } }, async (req) => {
    const rows = await db
      .select({ id: s.households.id, name: s.households.name, revision: s.households.revision, role: s.householdMembers.role })
      .from(s.householdMembers)
      .innerJoin(s.households, eq(s.households.id, s.householdMembers.householdId))
      .where(eq(s.householdMembers.userId, req.user.id))
      .orderBy(asc(s.householdMembers.createdAt));
    return rows.map((r) => ({ ...r, role: r.role as 'owner' | 'member' }));
  });

  app.post('/households', { schema: { tags: ['household'], summary: 'Создать семью', body: CreateHouseholdRequest, response: { 201: Household } } }, async (req, reply) => {
    const id = await db.transaction((tx) => createHousehold(tx, req.user.id, req.body.name));
    reply.code(201);
    return { id, name: req.body.name, revision: 1, role: 'owner' as const };
  });

  app.post(
    '/invitations/:token/accept',
    { schema: { tags: ['household'], summary: 'Принять приглашение', params: z.object({ token: z.string().min(20).max(100) }), response: { 200: Household } } },
    async (req) => {
      const deps = app.deps;
      const [inv] = await db.select().from(s.invitations).where(eq(s.invitations.tokenHash, hashSecret(req.params.token, deps.config.TOKEN_PEPPER))).limit(1);
      if (!inv || inv.status !== 'pending' || inv.expiresAt <= deps.now()) throw new AppError('not_found', 'Приглашение не найдено или устарело. Попросите прислать новое.');
      const [user] = await db.select().from(s.users).where(eq(s.users.id, req.user.id)).limit(1);
      if (user!.email !== inv.email) throw forbidden(`Приглашение отправлено на ${inv.email}. Войдите с этой почтой.`);
      await db.transaction(async (tx) => {
        await tx.insert(s.householdMembers).values({ householdId: inv.householdId, userId: req.user.id, role: inv.role }).onConflictDoNothing();
        await tx.update(s.invitations).set({ status: 'accepted' }).where(eq(s.invitations.id, inv.id));
        // приглашение подтверждает владение почтой
        if (!user!.emailVerifiedAt) await tx.update(s.users).set({ emailVerifiedAt: deps.now() }).where(eq(s.users.id, user!.id));
        await tx.update(s.households).set({ revision: sql`${s.households.revision} + 1` }).where(eq(s.households.id, inv.householdId));
        await tx.insert(s.auditLog).values({ householdId: inv.householdId, userId: req.user.id, action: 'join', entity: 'member', entityId: req.user.id });
      });
      const [h] = await db.select().from(s.households).where(eq(s.households.id, inv.householdId)).limit(1);
      await deps.jobs.planChanged(inv.householdId);
      return { id: h!.id, name: h!.name, revision: h!.revision, role: inv.role as 'owner' | 'member' };
    },
  );
};

/** Эндпоинты внутри /households/:hid — доступ уже проверен. */
export const householdRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = app.deps;
  const { db } = deps;

  app.get('', { schema: { tags: ['household'], summary: 'Семья', response: { 200: Household } } }, async (req) => {
    const [h] = await db.select().from(s.households).where(eq(s.households.id, req.household.id)).limit(1);
    return { id: h!.id, name: h!.name, revision: h!.revision, role: req.household.role };
  });

  app.patch('', { schema: { tags: ['household'], summary: 'Переименовать', body: CreateHouseholdRequest, response: { 200: Household } } }, async (req) => {
    requireOwner(req.household);
    await mutate(req, 'household', 'rename', (tx) => tx.update(s.households).set({ name: req.body.name }).where(eq(s.households.id, req.household.id)));
    const [h] = await db.select().from(s.households).where(eq(s.households.id, req.household.id)).limit(1);
    return { id: h!.id, name: h!.name, revision: h!.revision, role: req.household.role };
  });

  app.delete('', { schema: { tags: ['household'], summary: 'Удалить семью со всеми данными' } }, async (req, reply) => {
    requireOwner(req.household);
    await db.delete(s.households).where(eq(s.households.id, req.household.id));
    reply.code(204);
  });

  // ── участники ──
  app.get('/members', { schema: { tags: ['household'], summary: 'Участники', response: { 200: z.array(HouseholdMember) } } }, async (req) => {
    const rows = await db
      .select({ id: s.householdMembers.id, userId: s.users.id, name: s.users.name, email: s.users.email, role: s.householdMembers.role, displayName: s.householdMembers.displayName })
      .from(s.householdMembers)
      .innerJoin(s.users, eq(s.users.id, s.householdMembers.userId))
      .where(eq(s.householdMembers.householdId, req.household.id))
      .orderBy(asc(s.householdMembers.createdAt));
    return rows.map((r) => ({ ...r, role: r.role as 'owner' | 'member' }));
  });

  app.patch(
    '/members/:memberId',
    {
      schema: {
        tags: ['household'],
        summary: 'Изменить участника (имя в плане, роль)',
        params: z.object({ memberId: z.uuid() }),
        body: z.object({ displayName: z.string().max(100).nullable().optional(), role: z.enum(['owner', 'member']).optional() }),
      },
    },
    async (req, reply) => {
      const [m] = await db.select().from(s.householdMembers).where(and(eq(s.householdMembers.id, req.params.memberId), eq(s.householdMembers.householdId, req.household.id))).limit(1);
      if (!m) throw notFound('Участник');
      if (req.body.role !== undefined || m.userId !== req.user.id) requireOwner(req.household);
      if (req.body.role === 'member' && m.role === 'owner') {
        const owners = await db.select({ id: s.householdMembers.id }).from(s.householdMembers).where(and(eq(s.householdMembers.householdId, req.household.id), eq(s.householdMembers.role, 'owner')));
        if (owners.length <= 1) throw new AppError('conflict', 'В семье должен остаться хотя бы один владелец');
      }
      await mutate(req, 'member', 'update', (tx) =>
        tx
          .update(s.householdMembers)
          .set({ ...(req.body.displayName !== undefined ? { displayName: req.body.displayName } : {}), ...(req.body.role ? { role: req.body.role } : {}) })
          .where(eq(s.householdMembers.id, m.id)),
      );
      reply.code(204);
    },
  );

  app.delete('/members/:memberId', { schema: { tags: ['household'], summary: 'Исключить участника или выйти из семьи', params: z.object({ memberId: z.uuid() }) } }, async (req, reply) => {
    const [m] = await db.select().from(s.householdMembers).where(and(eq(s.householdMembers.id, req.params.memberId), eq(s.householdMembers.householdId, req.household.id))).limit(1);
    if (!m) throw notFound('Участник');
    if (m.userId !== req.user.id) requireOwner(req.household);
    const all = await db.select().from(s.householdMembers).where(eq(s.householdMembers.householdId, req.household.id));
    if (m.role === 'owner' && all.filter((x) => x.role === 'owner').length <= 1 && all.length > 1) {
      throw new AppError('conflict', 'Сначала передайте права владельца другому участнику');
    }
    if (all.length <= 1) throw new AppError('conflict', 'Вы единственный участник — удалите семью целиком');
    await mutate(req, 'member', 'remove', (tx) => tx.delete(s.householdMembers).where(eq(s.householdMembers.id, m.id)));
    await cancelUserReminders(deps, m.userId, req.household.id);
    reply.code(204);
  });

  // ── приглашения ──
  app.get('/invitations', { schema: { tags: ['household'], summary: 'Приглашения', response: { 200: z.array(Invitation) } } }, async (req) => {
    const rows = await db.select().from(s.invitations).where(eq(s.invitations.householdId, req.household.id)).orderBy(asc(s.invitations.createdAt));
    const now = deps.now();
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role as 'owner' | 'member',
      status: (r.status === 'pending' && r.expiresAt <= now ? 'expired' : r.status) as 'pending',
      expiresAt: r.expiresAt.toISOString(),
    }));
  });

  app.post(
    '/invitations',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } }, schema: { tags: ['household'], summary: 'Пригласить супруга(у)', body: InviteRequest, response: { 201: Invitation } } },
    async (req, reply) => {
      requireOwner(req.household);
      const { email, role } = req.body;
      const existing = await db
        .select({ id: s.householdMembers.id })
        .from(s.householdMembers)
        .innerJoin(s.users, eq(s.users.id, s.householdMembers.userId))
        .where(and(eq(s.householdMembers.householdId, req.household.id), eq(s.users.email, email)));
      if (existing.length) throw new AppError('conflict', 'Этот человек уже в семье');
      const token = randomToken();
      const expiresAt = new Date(deps.now().getTime() + INVITE_TTL_DAYS * 86_400_000);
      const inv = await mutate(req, 'invitation', 'create', async (tx) => {
        await tx.update(s.invitations).set({ status: 'revoked' }).where(and(eq(s.invitations.householdId, req.household.id), eq(s.invitations.email, email), eq(s.invitations.status, 'pending')));
        const [row] = await tx
          .insert(s.invitations)
          .values({ householdId: req.household.id, email, role, tokenHash: hashSecret(token, deps.config.TOKEN_PEPPER), invitedBy: req.user.id, expiresAt })
          .returning();
        return row!;
      });
      const [[inviter], [h]] = await Promise.all([
        db.select().from(s.users).where(eq(s.users.id, req.user.id)).limit(1),
        db.select().from(s.households).where(eq(s.households.id, req.household.id)).limit(1),
      ]);
      await sendInvitation(deps, email, inviter!.name, h!.name, token);
      reply.code(201);
      return { id: inv.id, email: inv.email, role: inv.role as 'member', status: 'pending' as const, expiresAt: inv.expiresAt.toISOString() };
    },
  );

  app.delete('/invitations/:id', { schema: { tags: ['household'], summary: 'Отозвать приглашение', params: z.object({ id: z.uuid() }) } }, async (req, reply) => {
    requireOwner(req.household);
    await db
      .update(s.invitations)
      .set({ status: 'revoked' })
      .where(and(eq(s.invitations.id, req.params.id), eq(s.invitations.householdId, req.household.id), eq(s.invitations.status, 'pending'), gt(s.invitations.expiresAt, deps.now())));
    reply.code(204);
  });

  // ── настройки семьи ──
  app.get('/settings', { schema: { tags: ['household'], summary: 'Настройки плана', response: { 200: HouseholdSettingsDto } } }, async (req) => {
    const [h] = await db.select().from(s.households).where(eq(s.households.id, req.household.id)).limit(1);
    return { ...settingsOf(h!), version: h!.settingsVersion };
  });

  app.patch('/settings', { schema: { tags: ['household'], summary: 'Изменить настройки плана', body: UpdateHouseholdSettingsRequest, response: { 200: HouseholdSettingsDto } } }, async (req) => {
    const { version, ...patch } = req.body;
    const updated = await mutate(req, 'settings', 'update', async (tx) => {
      const [h] = await tx.select().from(s.households).where(eq(s.households.id, req.household.id)).limit(1);
      const merged: HouseholdSettings = { ...settingsOf(h!), ...patch, allocation: { ...settingsOf(h!).allocation, ...(patch.allocation ?? {}) } };
      const [row] = await tx
        .update(s.households)
        .set({ settings: merged, settingsVersion: sql`${s.households.settingsVersion} + 1` })
        .where(and(eq(s.households.id, req.household.id), eq(s.households.settingsVersion, version)))
        .returning();
      if (!row) throw conflict();
      return row;
    });
    return { ...settingsOf(updated), version: updated.settingsVersion };
  });

  // ── налоговый вычет: данные по каждому супругу ──
  app.get('/tax-members', { schema: { tags: ['tax'], summary: 'Данные для вычета', response: { 200: z.object({ members: z.array(TaxMember), version: z.number() }) } } }, async (req) => {
    const [h] = await db.select().from(s.households).where(eq(s.households.id, req.household.id)).limit(1);
    return { members: h!.taxMembers as z.infer<typeof TaxMember>[], version: h!.taxVersion };
  });

  app.put(
    '/tax-members',
    { schema: { tags: ['tax'], summary: 'Сохранить данные для вычета', body: UpdateTaxMembersRequest.extend({ version: z.number().int() }), response: { 200: z.object({ members: z.array(TaxMember), version: z.number() }) } } },
    async (req) => {
      const row = await mutate(req, 'tax', 'update', async (tx) => {
        const [r] = await tx
          .update(s.households)
          .set({ taxMembers: req.body.members, taxVersion: sql`${s.households.taxVersion} + 1` })
          .where(and(eq(s.households.id, req.household.id), eq(s.households.taxVersion, req.body.version)))
          .returning();
        if (!r) throw conflict();
        return r;
      });
      return { members: row.taxMembers as z.infer<typeof TaxMember>[], version: row.taxVersion };
    },
  );

  // ── сценарий покупки ──
  const scenarioDto = (r: typeof s.scenarios.$inferSelect) => ({
    housingType: r.housingType as 'secondary',
    program: r.program as 'base',
    priceKop: r.priceKop,
    downPaymentKop: r.downPaymentKop,
    maternityCapitalKop: r.maternityCapitalKop,
    keysDate: r.keysDate,
    rightDate: r.rightDate,
    version: r.version,
  });

  app.get('/scenario', { schema: { tags: ['scenario'], summary: 'Сценарий покупки', response: { 200: ScenarioDto.nullable() } } }, async (req) => {
    const [r] = await db.select().from(s.scenarios).where(eq(s.scenarios.householdId, req.household.id)).limit(1);
    return r ? scenarioDto(r) : null;
  });

  app.patch('/scenario', { schema: { tags: ['scenario'], summary: 'Изменить сценарий (например, сдвинуть дату ключей)', body: UpdateScenarioRequest, response: { 200: ScenarioDto } } }, async (req) => {
    const { version, ...patch } = req.body;
    const row = await mutate(req, 'scenario', 'update', async (tx) => {
      const [r] = await tx
        .update(s.scenarios)
        .set({ ...patch, version: sql`${s.scenarios.version} + 1`, updatedAt: deps.now() })
        .where(and(eq(s.scenarios.householdId, req.household.id), eq(s.scenarios.version, version)))
        .returning();
      if (!r) throw conflict();
      return r;
    });
    return scenarioDto(row);
  });

  /**
   * Мастер: по ответам собирает сценарий, этапы, расходы и черновик кредита.
   * Повторный запуск заменяет этапы и расходы из шаблонов, пользовательские сохраняет.
   */
  app.post(
    '/wizard',
    {
      schema: {
        tags: ['scenario'],
        summary: 'Мастер первого входа',
        body: WizardAnswers,
        response: { 200: z.object({ scenario: ScenarioDto, stages: z.array(StageDto), loanId: z.uuid(), notes: z.array(z.string()) }) },
      },
    },
    async (req) => {
      const answers = req.body;
      const draft = buildInitialPlan(answers, todayInMoscow(deps.now()));
      const hid = req.household.id;
      const result = await mutate(req, 'scenario', 'wizard', async (tx) => {
        const values = {
          housingType: answers.housingType,
          program: answers.program,
          priceKop: answers.priceKop,
          downPaymentKop: answers.downPaymentKop,
          maternityCapitalKop: answers.maternityCapitalKop,
          keysDate: draft.keysDate,
          wizardAnswers: answers,
        };
        const [scenario] = await tx
          .insert(s.scenarios)
          .values({ householdId: hid, ...values })
          .onConflictDoUpdate({ target: s.scenarios.householdId, set: { ...values, version: sql`${s.scenarios.version} + 1`, updatedAt: deps.now() } })
          .returning();

        // шаблонные этапы и расходы пересоздаются, пользовательские остаются
        await tx.delete(s.expenses).where(and(eq(s.expenses.householdId, hid), sql`${s.expenses.catalogKey} is not null`));
        await tx.delete(s.stages).where(and(eq(s.stages.householdId, hid), sql`${s.stages.templateKey} is not null`));
        const stageIds = new Map<string, string>();
        for (const st of draft.stages) {
          const [row] = await tx
            .insert(s.stages)
            .values({ householdId: hid, templateKey: st.templateKey, title: st.title, hint: st.hint, status: st.status, plannedDate: st.plannedDate, lessonKey: st.lessonKey ?? null, sort: st.sort })
            .returning({ id: s.stages.id });
          stageIds.set(st.key, row!.id);
          if (st.documents.length) {
            await tx.insert(s.stageDocuments).values(st.documents.map((d, i) => ({ householdId: hid, stageId: row!.id, title: d.title, isReady: false, sort: i })));
          }
        }

        // основной кредит: обновляем черновик мастера или создаём
        const [existingLoan] = await tx.select().from(s.loans).where(eq(s.loans.householdId, hid)).orderBy(asc(s.loans.createdAt)).limit(1);
        const loanValues = {
          name: draft.loan.name ?? 'Ипотека',
          principalKop: draft.loan.principalKop,
          annualRate: draft.loan.annualRate,
          termMonths: draft.loan.termMonths,
          type: draft.loan.type,
          issueDate: draft.loan.issueDate,
          paymentDay: draft.loan.paymentDay ?? null,
          interestMode: draft.loan.interestMode ?? 'monthly',
          bankRules: draft.loan.bankRules ?? null,
        };
        const loanId = existingLoan
          ? (await tx.update(s.loans).set({ ...loanValues, version: sql`${s.loans.version} + 1` }).where(eq(s.loans.id, existingLoan.id)).returning({ id: s.loans.id }))[0]!.id
          : (await tx.insert(s.loans).values({ householdId: hid, ...loanValues }).returning({ id: s.loans.id }))[0]!.id;

        if (draft.expenses.length) {
          await tx.insert(s.expenses).values(
            draft.expenses.map((e) => ({
              householdId: hid,
              name: e.name,
              category: e.category,
              catalogKey: e.catalogKey ?? null,
              stageId: e.stageId ? (stageIds.get(e.stageId) ?? null) : null,
              planKop: e.planKop,
              date: e.date ?? null,
              recurrence: e.recurrence,
              priority: e.priority ?? null,
              loanId: e.loanId ? loanId : null,
              percentOfLoanBalance: e.percentOfLoanBalance ?? null,
              atKeys: e.atKeys ?? false,
            })),
          );
        }
        return { scenario: scenario!, loanId };
      });
      return { scenario: scenarioDto(result.scenario), stages: await loadStages(db, hid), loanId: result.loanId, notes: draft.notes };
    },
  );
};
