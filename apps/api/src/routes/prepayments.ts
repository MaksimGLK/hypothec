import {
  CompareScenariosRequest,
  ConfirmPrepaymentRequest,
  CreatePrepaymentRequest,
  CreatePrepaymentScenarioRequest,
  PrepaymentScenario,
  TaxToPrepaymentRequest,
  TimingRequest,
  UpdatePrepaymentRequest,
  UpdatePrepaymentScenarioRequest,
} from '@hypothec/api-contract';
import { compareScenarios, prepaymentTimingEffect, taxRefundsToPrepayments } from '@hypothec/core';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db, DbOrTx } from '../db/client.js';
import * as s from '../db/schema.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { getPlan, loadPlanInput, toPrepaymentInput } from '../services/plan.js';
import { adjustPrepaymentAccount, applyDuePrepayments } from '../services/prepayment-execution.js';
import { assertOwned, IdParams, mutate, stripNulls } from './helpers.js';

const MAX_SCENARIOS = 10;

export async function loadScenarios(db: Db, householdId: string): Promise<z.infer<typeof PrepaymentScenario>[]> {
  const [scs, pps] = await Promise.all([
    db.select().from(s.prepaymentScenarios).where(eq(s.prepaymentScenarios.householdId, householdId)).orderBy(asc(s.prepaymentScenarios.createdAt)),
    db.select().from(s.prepayments).where(eq(s.prepayments.householdId, householdId)).orderBy(asc(s.prepayments.createdAt)),
  ]);
  return scs.map((sc) => ({
    id: sc.id,
    name: sc.name,
    isActive: sc.isActive,
    color: sc.color,
    version: sc.version,
    prepayments: pps
      .filter((p) => p.scenarioId === sc.id)
      .map((p) => stripNulls({ ...toPrepaymentInput(p), amountKop: p.amountKop, factAmountKop: p.factAmountKop, status: p.status, confirmed: p.confirmed, version: p.version }) as never),
  }));
}

async function loadScenario(db: Db, householdId: string, id: string) {
  const sc = (await loadScenarios(db, householdId)).find((x) => x.id === id);
  if (!sc) throw notFound('Сценарий');
  return sc;
}

/** Новый сценарий из набора досрочек (например, из рекомендации или вычета) — неактивный, чтобы сравнить. */
export async function createScenarioWith(
  tx: DbOrTx,
  householdId: string,
  name: string,
  prepayments: { loanId: string; kind: string; amountKop: number; date?: string | null; startDate?: string | null; endDate?: string | null; dayOfMonth?: number | null; mode: string; source?: string }[],
): Promise<string> {
  const [sc] = await tx.insert(s.prepaymentScenarios).values({ householdId, name, isActive: false }).returning({ id: s.prepaymentScenarios.id });
  if (prepayments.length) {
    await tx.insert(s.prepayments).values(
      prepayments.map((p) => ({
        householdId,
        scenarioId: sc!.id,
        loanId: p.loanId,
        kind: p.kind,
        amountKop: p.amountKop,
        date: p.date ?? null,
        startDate: p.startDate ?? null,
        endDate: p.endDate ?? null,
        dayOfMonth: p.dayOfMonth ?? null,
        mode: p.mode,
        source: p.source ?? 'manual',
      })),
    );
  }
  return sc!.id;
}

export const prepaymentRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = app.deps;
  const { db } = deps;
  const tags = ['prepayment'];

  app.get('/prepayment-scenarios', { schema: { tags, summary: 'Сценарии досрочки', response: { 200: z.array(PrepaymentScenario) } } }, async (req) => {
    await applyDuePrepayments(deps, req.household.id);
    return loadScenarios(db, req.household.id);
  });

  /** Ждут подтверждения: дата досрочки наступила, сумма списана со счёта «Досрочка». */
  app.get('/prepayments/pending', { schema: { tags, summary: 'Досрочки, которые нужно подтвердить' } }, async (req) => {
    await applyDuePrepayments(deps, req.household.id);
    const rows = await db
      .select()
      .from(s.prepayments)
      .where(and(eq(s.prepayments.householdId, req.household.id), eq(s.prepayments.status, 'done'), eq(s.prepayments.confirmed, false)));
    return rows.map((r) => ({ id: r.id, scenarioId: r.scenarioId, date: r.date, amountKop: r.factAmountKop ?? r.amountKop, planKop: r.amountKop }));
  });

  /**
   * Подтверждение досрочки: внёс; банк принял другую сумму; не вносил; остаток счёта уже поправил сам.
   * Остаток счёта «Досрочка» и график кредита пересчитываются по факту.
   */
  app.post(
    '/prepayments/:id/confirm',
    { schema: { tags, summary: 'Подтвердить досрочку', params: IdParams, body: ConfirmPrepaymentRequest } },
    async (req) => {
      const { action, amountKop } = req.body;
      const result = await mutate(req, 'prepayment', `confirm:${action}`, async (tx) => {
        const [p] = await tx.select().from(s.prepayments).where(and(eq(s.prepayments.id, req.params.id), eq(s.prepayments.householdId, req.household.id)));
        if (!p) throw notFound('Досрочка');
        if (p.status !== 'done') throw new AppError('conflict', 'Эта досрочка ещё не наступила или уже отменена');
        const current = p.factAmountKop ?? p.amountKop;
        if (action === 'confirm') {
          await tx.update(s.prepayments).set({ confirmed: true }).where(eq(s.prepayments.id, p.id));
        } else if (action === 'amount') {
          if (!amountKop) throw new AppError('validation_error', 'Укажите сумму, которую принял банк');
          await adjustPrepaymentAccount(tx, req.household.id, -(amountKop - current));
          await tx.update(s.prepayments).set({ factAmountKop: amountKop, confirmed: true }).where(eq(s.prepayments.id, p.id));
        } else if (action === 'skip') {
          await adjustPrepaymentAccount(tx, req.household.id, current);
          await tx.update(s.prepayments).set({ status: 'skipped', confirmed: true }).where(eq(s.prepayments.id, p.id));
        } else {
          // внёс, но остаток счёта уже поправил вручную — возвращаем списанное, чтобы не вычесть дважды
          await adjustPrepaymentAccount(tx, req.household.id, current);
          await tx.update(s.prepayments).set({ confirmed: true }).where(eq(s.prepayments.id, p.id));
        }
        return { id: p.id };
      });
      return { ...result, action };
    },
  );

  app.post(
    '/prepayment-scenarios',
    { schema: { tags, summary: 'Новый сценарий (можно копией существующего)', body: CreatePrepaymentScenarioRequest, response: { 201: PrepaymentScenario } } },
    async (req, reply) => {
      const created = await mutate(req, 'prepayment_scenario', 'create', async (tx) => {
        const count = await tx.select({ id: s.prepaymentScenarios.id }).from(s.prepaymentScenarios).where(eq(s.prepaymentScenarios.householdId, req.household.id));
        if (count.length >= MAX_SCENARIOS) throw new AppError('conflict', `Можно хранить до ${MAX_SCENARIOS} сценариев — удалите ненужные`);
        let source: (typeof s.prepayments.$inferSelect)[] = [];
        if (req.body.copyFromId) {
          await assertOwned(tx, s.prepaymentScenarios, req.body.copyFromId, req.household.id, 'Сценарий');
          source = await tx.select().from(s.prepayments).where(eq(s.prepayments.scenarioId, req.body.copyFromId));
        }
        return { id: await createScenarioWith(tx, req.household.id, req.body.name, source) };
      });
      reply.code(201);
      return loadScenario(db, req.household.id, created.id);
    },
  );

  app.patch(
    '/prepayment-scenarios/:id',
    { schema: { tags, summary: 'Переименовать или сделать основным', params: IdParams, body: UpdatePrepaymentScenarioRequest, response: { 200: PrepaymentScenario } } },
    async (req) => {
      const { version, ...values } = req.body;
      await mutate(req, 'prepayment_scenario', 'update', async (tx) => {
        // основным может быть только один сценарий
        if (values.isActive) {
          await tx
            .update(s.prepaymentScenarios)
            .set({ isActive: false })
            .where(and(eq(s.prepaymentScenarios.householdId, req.household.id), ne(s.prepaymentScenarios.id, req.params.id)));
        }
        const rows = await tx
          .update(s.prepaymentScenarios)
          .set({ ...values, version: sql`${s.prepaymentScenarios.version} + 1`, updatedAt: new Date() })
          .where(and(eq(s.prepaymentScenarios.id, req.params.id), eq(s.prepaymentScenarios.householdId, req.household.id), eq(s.prepaymentScenarios.version, version)))
          .returning({ id: s.prepaymentScenarios.id });
        if (!rows.length) throw conflict();
        return rows[0]!;
      });
      return loadScenario(db, req.household.id, req.params.id);
    },
  );

  app.delete('/prepayment-scenarios/:id', { schema: { tags, summary: 'Удалить сценарий', params: IdParams } }, async (req, reply) => {
    await mutate(req, 'prepayment_scenario', 'delete', async (tx) => {
      const rows = await tx
        .delete(s.prepaymentScenarios)
        .where(and(eq(s.prepaymentScenarios.id, req.params.id), eq(s.prepaymentScenarios.householdId, req.household.id)))
        .returning({ id: s.prepaymentScenarios.id });
      if (!rows.length) throw notFound('Сценарий');
      return rows[0]!;
    });
    reply.code(204);
  });

  // ── досрочки внутри сценария ──
  const ScParams = z.object({ id: z.uuid() });
  const PpParams = z.object({ id: z.uuid(), prepaymentId: z.uuid() });

  app.post('/prepayment-scenarios/:id/prepayments', { schema: { tags, summary: 'Добавить досрочку', params: ScParams, body: CreatePrepaymentRequest, response: { 201: PrepaymentScenario } } }, async (req, reply) => {
    await mutate(req, 'prepayment', 'create', async (tx) => {
      await assertOwned(tx, s.prepaymentScenarios, req.params.id, req.household.id, 'Сценарий');
      await assertOwned(tx, s.loans, req.body.loanId, req.household.id, 'Кредит');
      const [row] = await tx.insert(s.prepayments).values({ ...req.body, householdId: req.household.id, scenarioId: req.params.id }).returning({ id: s.prepayments.id });
      return row!;
    });
    reply.code(201);
    return loadScenario(db, req.household.id, req.params.id);
  });

  app.patch(
    '/prepayment-scenarios/:id/prepayments/:prepaymentId',
    { schema: { tags, summary: 'Изменить досрочку', params: PpParams, body: UpdatePrepaymentRequest, response: { 200: PrepaymentScenario } } },
    async (req) => {
      const { version, ...values } = req.body;
      await mutate(req, 'prepayment', 'update', async (tx) => {
        if (values.loanId) await assertOwned(tx, s.loans, values.loanId, req.household.id, 'Кредит');
        const rows = await tx
          .update(s.prepayments)
          .set({ ...values, version: sql`${s.prepayments.version} + 1`, updatedAt: new Date() })
          .where(
            and(
              eq(s.prepayments.id, req.params.prepaymentId),
              eq(s.prepayments.scenarioId, req.params.id),
              eq(s.prepayments.householdId, req.household.id),
              eq(s.prepayments.version, version),
            ),
          )
          .returning({ id: s.prepayments.id });
        if (!rows.length) throw conflict();
        return rows[0]!;
      });
      return loadScenario(db, req.household.id, req.params.id);
    },
  );

  app.delete('/prepayment-scenarios/:id/prepayments/:prepaymentId', { schema: { tags, summary: 'Удалить досрочку', params: PpParams } }, async (req, reply) => {
    await mutate(req, 'prepayment', 'delete', async (tx) => {
      const rows = await tx
        .delete(s.prepayments)
        .where(and(eq(s.prepayments.id, req.params.prepaymentId), eq(s.prepayments.scenarioId, req.params.id), eq(s.prepayments.householdId, req.household.id)))
        .returning({ id: s.prepayments.id });
      if (!rows.length) throw notFound('Досрочка');
      return rows[0]!;
    });
    reply.code(204);
  });

  // ── расчёты ──
  app.post('/prepayment-scenarios/compare', { schema: { tags, summary: 'Сравнить до 4 сценариев', body: CompareScenariosRequest } }, async (req) => {
    const { input } = await loadPlanInput(deps, req.household.id);
    const loan = input.loans.find((l) => l.id === req.body.loanId);
    if (!loan) throw notFound('Кредит');
    const selected = req.body.scenarioIds.map((id) => {
      const sc = input.prepaymentScenarios.find((x) => x.id === id);
      if (!sc) throw notFound('Сценарий');
      return { id: sc.id, name: sc.name, prepayments: sc.prepayments };
    });
    const result = compareScenarios(loan, selected);
    // строки графиков большие — для сравнения отдаём помесячный остаток
    const slim = (r: typeof result.baseline) => ({
      ...r,
      schedule: undefined,
      balances: r.schedule.rows.filter((x) => x.kind === 'payment').map((x) => ({ date: x.date, balanceKop: x.balanceKop, paymentKop: x.paymentKop + x.keepExtraKop + x.prepaymentKop })),
      warnings: r.schedule.warnings,
    });
    return { baseline: slim(result.baseline), scenarios: result.scenarios.map(slim) };
  });

  app.post('/prepayment-timing', { schema: { tags, summary: '«1 млн сейчас или через 5 лет»', body: TimingRequest } }, async (req) => {
    const { input } = await loadPlanInput(deps, req.household.id);
    const loan = input.loans.find((l) => l.id === req.body.loanId);
    if (!loan) throw notFound('Кредит');
    const active = input.prepaymentScenarios.find((x) => x.isActive)?.prepayments ?? [];
    return prepaymentTimingEffect(loan, req.body.amountKop, req.body.dates, req.body.mode, active);
  });

  app.post('/prepayment-scenarios/from-tax', { schema: { tags, summary: 'Направить налоговые вычеты в досрочку', body: TaxToPrepaymentRequest, response: { 200: PrepaymentScenario } } }, async (req) => {
    const { plan } = await getPlan(deps, req.household.id);
    const pps = taxRefundsToPrepayments(plan.tax, req.body.loanId, req.body.mode, {
      includeProperty: req.body.includeProperty,
      includeInterest: req.body.includeInterest,
      fromDate: plan.today,
    });
    if (pps.length === 0) throw new AppError('conflict', 'По вашим данным пока нечего направить: заполните данные для вычета');
    await mutate(req, 'prepayment', 'from_tax', async (tx) => {
      await assertOwned(tx, s.prepaymentScenarios, req.body.scenarioId, req.household.id, 'Сценарий');
      await assertOwned(tx, s.loans, req.body.loanId, req.household.id, 'Кредит');
      await tx.delete(s.prepayments).where(and(eq(s.prepayments.scenarioId, req.body.scenarioId), eq(s.prepayments.source, 'tax_refund')));
      await tx.insert(s.prepayments).values(
        pps.map((p) => ({ householdId: req.household.id, scenarioId: req.body.scenarioId, loanId: p.loanId, kind: p.kind, amountKop: p.amountKop, date: p.date!, mode: p.mode, source: 'tax_refund' })),
      );
    });
    return loadScenario(db, req.household.id, req.body.scenarioId);
  });
};
