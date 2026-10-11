import { BootstrapBudgetRequest, CreateSpendingRequest, MonthQuery, ParseSpendingRequest, SetContributionRequest, SetMonthTotalRequest, Spending, UpdateSpendingRequest } from '@hypothec/api-contract';
import { addMonths, adjustToTotal, averageSpending, BUDGET_CATALOG, endOfMonth, budgetMonth, incomeDistribution, parseSpendingQuickInput } from '@hypothec/core';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { todayInMoscow } from '../config.js';
import * as s from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { loadPlanInput, toLivingInput } from '../services/plan.js';
import { applyAutoPayments } from '../services/autopay.js';
import { applyDuePrepayments } from '../services/prepayment-execution.js';
import { assertOwned, IdParams, mutate, stripNulls } from './helpers.js';

const monthRange = (month: string) => ({ from: `${month}-01`, to: `${addMonths(`${month}-01`, 1)}` });

function toSpendingDto(r: typeof s.spendings.$inferSelect) {
  // categoryId обязателен в ответе (null — трата без категории), поэтому его не вычищаем вместе с остальными null
  return { ...stripNulls({ id: r.id, date: r.date, amountKop: r.amountKop, note: r.note, source: r.source as 'manual', version: r.version, createdBy: r.createdBy }), categoryId: r.categoryId } as z.infer<typeof Spending>;
}

/**
 * Бюджет на жизнь: категории с планом (таблица living_expenses, CRUD — /living-expenses) и фактические траты.
 */
export const budgetRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = app.deps;
  const { db } = deps;
  const tags = ['budget'];

  const loadCategories = (hid: string) => db.select().from(s.livingExpenses).where(eq(s.livingExpenses.householdId, hid)).orderBy(asc(s.livingExpenses.sort), asc(s.livingExpenses.createdAt));

  app.get('/budget/catalog', { schema: { tags, summary: 'Справочник категорий расходов на жизнь' } }, async () => BUDGET_CATALOG);

  app.get('/budget/summary', { schema: { tags, summary: 'План и факт за месяц, средние траты за 3 месяца', querystring: MonthQuery } }, async (req) => {
    // наступившие автоплатежи записываются при открытии бюджета (и раз в сутки воркером)
    await applyAutoPayments(deps, req.household.id);
    const today = todayInMoscow(deps.now());
    const [cats, [scenario], history] = await Promise.all([
      loadCategories(req.household.id),
      db.select({ keysDate: s.scenarios.keysDate }).from(s.scenarios).where(eq(s.scenarios.householdId, req.household.id)),
      db
        .select()
        .from(s.spendings)
        .where(and(eq(s.spendings.householdId, req.household.id), gte(s.spendings.date, addMonths(`${req.query.month}-01`, -3)), lt(s.spendings.date, monthRange(req.query.month).to))),
    ]);
    const inputs = cats.map(toLivingInput);
    const sp = history.map((h) => ({ id: h.id, categoryId: h.categoryId, date: h.date, amountKop: h.amountKop, note: h.note }));
    const month = budgetMonth(inputs, sp, req.query.month, today, { keysDate: scenario?.keysDate ?? null });
    return { ...month, averages: averageSpending(sp, `${req.query.month}-15`) };
  });

  app.get('/budget/distribution', { schema: { tags, summary: 'Куда уходит доход месяца — для круговой диаграммы', querystring: MonthQuery } }, async (req) => {
    await applyAutoPayments(deps, req.household.id);
    await applyDuePrepayments(deps, req.household.id);
    const { from, to } = monthRange(req.query.month);
    const [{ input }, monthSpendings] = await Promise.all([
      loadPlanInput(deps, req.household.id),
      db.select().from(s.spendings).where(and(eq(s.spendings.householdId, req.household.id), gte(s.spendings.date, from), lt(s.spendings.date, to))),
    ]);
    return incomeDistribution(
      { ...input, spendings: monthSpendings.map((r) => ({ id: r.id, categoryId: r.categoryId, date: r.date, amountKop: r.amountKop })) },
      req.query.month,
    );
  });

  app.get('/budget/spendings', { schema: { tags, summary: 'Траты за месяц', querystring: MonthQuery, response: { 200: z.array(Spending) } } }, async (req) => {
    await applyAutoPayments(deps, req.household.id);
    const { from, to } = monthRange(req.query.month);
    const rows = await db
      .select()
      .from(s.spendings)
      .where(and(eq(s.spendings.householdId, req.household.id), gte(s.spendings.date, from), lt(s.spendings.date, to)))
      .orderBy(desc(s.spendings.date), desc(s.spendings.createdAt));
    return rows.map(toSpendingDto);
  });

  app.post('/budget/spendings', { schema: { tags, summary: 'Добавить трату', body: CreateSpendingRequest, response: { 201: Spending } } }, async (req, reply) => {
    const row = await mutate(req, 'spending', 'create', async (tx) => {
      await assertOwned(tx, s.livingExpenses, req.body.categoryId, req.household.id, 'Категория');
      const [r] = await tx
        .insert(s.spendings)
        .values({ ...req.body, note: req.body.note ?? null, source: req.body.source === 'plan' ? 'plan' : 'manual', householdId: req.household.id, createdBy: req.user.id })
        .returning();
      return r!;
    });
    reply.code(201);
    return toSpendingDto(row);
  });

  app.patch('/budget/spendings/:id', { schema: { tags, summary: 'Изменить трату', params: IdParams, body: UpdateSpendingRequest, response: { 200: Spending } } }, async (req) => {
    const { version, ...values } = req.body;
    const row = await mutate(req, 'spending', 'update', async (tx) => {
      if (values.categoryId) await assertOwned(tx, s.livingExpenses, values.categoryId, req.household.id, 'Категория');
      const [r] = await tx
        .update(s.spendings)
        .set({ ...values, version: sql`${s.spendings.version} + 1`, updatedAt: new Date() })
        .where(and(eq(s.spendings.id, req.params.id), eq(s.spendings.householdId, req.household.id), eq(s.spendings.version, version)))
        .returning();
      if (!r) {
        const [exists] = await tx.select({ id: s.spendings.id }).from(s.spendings).where(and(eq(s.spendings.id, req.params.id), eq(s.spendings.householdId, req.household.id)));
        throw exists ? conflict() : notFound('Трата');
      }
      return r;
    });
    return toSpendingDto(row);
  });

  app.delete('/budget/spendings/:id', { schema: { tags, summary: 'Удалить трату', params: IdParams } }, async (req, reply) => {
    await mutate(req, 'spending', 'delete', async (tx) => {
      const rows = await tx.delete(s.spendings).where(and(eq(s.spendings.id, req.params.id), eq(s.spendings.householdId, req.household.id))).returning({ id: s.spendings.id });
      if (!rows.length) throw notFound('Трата');
      return rows[0]!;
    });
    reply.code(204);
  });

  /** Ячейка «Потрачено» как в таблице: вписали итог — факт категории за месяц приводится к нему. */
  app.post(
    '/budget/categories/:id/month-total',
    { schema: { tags, summary: 'Задать итог «Потрачено» по категории за месяц', params: IdParams, body: SetMonthTotalRequest } },
    async (req) => {
      const { month, totalKop } = req.body;
      const { from, to } = monthRange(month);
      const today = todayInMoscow(deps.now());
      const result = await mutate(req, 'spending', 'month_total', async (tx) => {
        await assertOwned(tx, s.livingExpenses, req.params.id, req.household.id, 'Категория');
        const rows = await tx
          .select()
          .from(s.spendings)
          .where(and(eq(s.spendings.householdId, req.household.id), eq(s.spendings.categoryId, req.params.id), gte(s.spendings.date, from), lt(s.spendings.date, to)));
        const plan = adjustToTotal(rows.map((r) => ({ id: r.id, categoryId: r.categoryId, date: r.date, amountKop: r.amountKop })), totalKop);
        if (plan.createKop > 0) {
          const date = today.startsWith(month) ? today : today > from ? endOfMonth(from) : from;
          await tx.insert(s.spendings).values({ householdId: req.household.id, categoryId: req.params.id, date, amountKop: plan.createKop, note: 'Внесено в таблице', source: 'manual', createdBy: req.user.id });
        }
        for (const u of plan.updates) await tx.update(s.spendings).set({ amountKop: u.amountKop, version: sql`${s.spendings.version} + 1`, updatedAt: new Date() }).where(eq(s.spendings.id, u.id));
        for (const id of plan.deletes) await tx.delete(s.spendings).where(eq(s.spendings.id, id));
        return plan;
      });
      return { totalKop, added: result.createKop, changed: result.updates.length, removed: result.deletes.length };
    },
  );

  // ── факт взносов в цели копилки ──
  app.get('/budget/contributions', { schema: { tags, summary: 'Сколько фактически отложено на цели за месяц', querystring: MonthQuery } }, async (req) => {
    const rows = await db
      .select()
      .from(s.goalContributions)
      .where(and(eq(s.goalContributions.householdId, req.household.id), eq(s.goalContributions.month, req.query.month)));
    return rows.map((r) => ({ accountId: r.accountId, month: r.month, amountKop: r.amountKop }));
  });

  /**
   * Вписали факт — остаток счёта цели меняется на разницу с прежним фактом:
   * отложили 75 000 в подушку — подушка выросла на 75 000, исправили на 70 000 — уменьшилась на 5 000.
   */
  app.put('/budget/contributions', { schema: { tags, summary: 'Задать факт взноса в цель за месяц', body: SetContributionRequest } }, async (req) => {
    const { accountId, month, amountKop } = req.body;
    const result = await mutate(req, 'goal_contribution', 'set', async (tx) => {
      const [acc] = await tx.select().from(s.accounts).where(and(eq(s.accounts.id, accountId), eq(s.accounts.householdId, req.household.id)));
      if (!acc) throw notFound('Счёт');
      const [prev] = await tx.select().from(s.goalContributions).where(and(eq(s.goalContributions.accountId, accountId), eq(s.goalContributions.month, month)));
      const delta = amountKop - (prev?.amountKop ?? 0);
      if (prev) {
        await tx
          .update(s.goalContributions)
          .set({ amountKop, updatedBy: req.user.id, version: sql`${s.goalContributions.version} + 1`, updatedAt: new Date() })
          .where(eq(s.goalContributions.id, prev.id));
      } else {
        await tx.insert(s.goalContributions).values({ householdId: req.household.id, accountId, month, amountKop, updatedBy: req.user.id });
      }
      const balance = Math.max(0, acc.balanceKop + delta);
      await tx.update(s.accounts).set({ balanceKop: balance, version: sql`${s.accounts.version} + 1`, updatedAt: new Date() }).where(eq(s.accounts.id, accountId));
      return { delta, balance };
    });
    return { accountId, month, amountKop, balanceKop: result.balance, deltaKop: result.delta };
  });

  app.post('/budget/parse', { schema: { tags, summary: 'Разобрать трату из строки «пятёрочка 1 250»', body: ParseSpendingRequest } }, async (req) => {
    const cats = await loadCategories(req.household.id);
    return parseSpendingQuickInput(req.body.text, cats.map((c) => ({ id: c.id, name: c.name, catalogKey: c.catalogKey })));
  });

  /** Стартовый набор категорий: добавляет недостающие из справочника, план — 0, пользователь вписывает свои суммы. */
  app.post('/budget/bootstrap', { schema: { tags, summary: 'Создать типовые категории', body: BootstrapBudgetRequest } }, async (req) => {
    const keys = req.body.keys ?? BUDGET_CATALOG.filter((c) => c.starter).map((c) => c.key);
    const created = await mutate(req, 'budget', 'bootstrap', async (tx) => {
      const existing = await tx.select({ catalogKey: s.livingExpenses.catalogKey, sort: s.livingExpenses.sort }).from(s.livingExpenses).where(eq(s.livingExpenses.householdId, req.household.id));
      const have = new Set(existing.map((e) => e.catalogKey));
      let sort = existing.reduce((m, e) => Math.max(m, e.sort), -1) + 1;
      const items = BUDGET_CATALOG.filter((c) => keys.includes(c.key) && !have.has(c.key));
      if (items.length) {
        await tx.insert(s.livingExpenses).values(
          items.map((c) => ({
            householdId: req.household.id,
            name: c.name,
            amountKop: 0,
            essential: c.essential,
            group: c.group,
            catalogKey: c.key,
            sort: sort++,
            ...(c.key === 'rent' ? { kind: 'rent', endsAtKeys: true } : {}),
          })),
        );
      }
      return items.length;
    });
    return { created };
  });
};
