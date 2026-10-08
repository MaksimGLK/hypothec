import { RecommendationStateRequest } from '@hypothec/api-contract';
import { addDays, DEFAULT_GOAL_STEPS, type GoalStep, taxRefundsToPrepayments } from '@hypothec/core';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as s from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import { getPlan, settingsOf } from '../services/plan.js';
import { mutate } from './helpers.js';
import { createScenarioWith } from './prepayments.js';

const KeyParams = z.object({ key: z.string().regex(/^[a-z0-9_]+$/).max(64) });

export const recommendationRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = app.deps;
  const { db } = deps;
  const tags = ['recommendations'];

  app.get('/recommendations', { schema: { tags, summary: 'Рекомендации с объяснением' } }, async (req) => {
    const { plan } = await getPlan(deps, req.household.id);
    const hidden = await db.select().from(s.recommendationStates).where(eq(s.recommendationStates.householdId, req.household.id));
    return { items: plan.recommendations, hidden: hidden.map((h) => ({ ruleKey: h.ruleKey, status: h.status, until: h.until })) };
  });

  app.put('/recommendations/:key/state', { schema: { tags, summary: 'Скрыть или отложить рекомендацию', params: KeyParams, body: RecommendationStateRequest } }, async (req, reply) => {
    const { status, until, fingerprint } = req.body;
    if (status === 'snoozed' && !until) throw new AppError('validation_error', 'Укажите, до какой даты отложить');
    const values = { status, until: until ?? null, fingerprint: fingerprint ?? null, updatedAt: deps.now() };
    await mutate(req, 'recommendation', status, (tx) =>
      tx
        .insert(s.recommendationStates)
        .values({ householdId: req.household.id, ruleKey: req.params.key, ...values })
        .onConflictDoUpdate({ target: [s.recommendationStates.householdId, s.recommendationStates.ruleKey], set: values }),
    );
    reply.code(204);
  });

  app.delete('/recommendations/:key/state', { schema: { tags, summary: 'Вернуть скрытую рекомендацию', params: KeyParams } }, async (req, reply) => {
    await mutate(req, 'recommendation', 'restore', (tx) =>
      tx.delete(s.recommendationStates).where(and(eq(s.recommendationStates.householdId, req.household.id), eq(s.recommendationStates.ruleKey, req.params.key))),
    );
    reply.code(204);
  });

  /**
   * Действие «применить в сценарии». Ничего не меняет в основном плане без спроса:
   * досрочки попадают в новый неактивный сценарий, чтобы сравнить; настройки меняются явно названным действием.
   */
  app.post(
    '/recommendations/:key/apply',
    { schema: { tags, summary: 'Применить действие рекомендации', params: KeyParams, body: z.object({ patch: z.string().max(64), mode: z.string().optional() }) } },
    async (req) => {
      const { plan, input } = await getPlan(deps, req.household.id);
      const rec = plan.recommendations.find((r) => r.ruleKey === req.params.key);
      if (!rec) throw notFound('Рекомендация');
      const action = rec.actions.find((a) => a.type === 'apply_scenario' && a.payload?.patch === req.body.patch);
      if (!action) throw new AppError('validation_error', 'У этой рекомендации нет такого действия');
      const loan = input.loans[0];
      const active = input.prepaymentScenarios.find((x) => x.isActive);
      const hid = req.household.id;

      switch (req.body.patch) {
        case 'prepayment_after_cushion':
        case 'enable_annual_reserve': {
          await mutate(req, 'settings', `recommendation:${req.body.patch}`, async (tx) => {
            const [h] = await tx.select().from(s.households).where(eq(s.households.id, hid)).limit(1);
            const settings = settingsOf(h!);
            if (req.body.patch === 'enable_annual_reserve') settings.allocation.annualReserveEnabled = true;
            else settings.allocation.steps = movePrepaymentAfterCushion(settings.allocation.steps);
            await tx.update(s.households).set({ settings, settingsVersion: sql`${s.households.settingsVersion} + 1` }).where(eq(s.households.id, hid));
          });
          return { applied: req.body.patch, scenarioId: null };
        }
        case 'switch_mode': {
          if (!active) throw notFound('Активный сценарий');
          const mode = (action.payload?.mode as string) ?? 'reduce_payment_keep_amount';
          const id = await mutate(req, 'prepayment_scenario', 'recommendation:switch_mode', (tx) =>
            createScenarioWith(tx, hid, `${active.name}: ${mode === 'reduce_term' ? 'сокращение срока' : 'платить прежнюю сумму'}`, active.prepayments.map((p) => ({ ...p, mode: p.mode === 'reduce_payment' ? mode : p.mode }))),
          );
          return { applied: req.body.patch, scenarioId: id };
        }
        case 'add_one_off_now': {
          if (!loan || !rec.effect) throw notFound('Кредит');
          const amount = Number(rec.effect.details.amountKop ?? 0);
          const date = nextPaymentDate(plan, loan.id) ?? addDays(plan.today, 1);
          const id = await mutate(req, 'prepayment_scenario', 'recommendation:add_one_off_now', (tx) =>
            createScenarioWith(tx, hid, 'Досрочка сейчас', [
              ...(active?.prepayments ?? []),
              { loanId: loan.id, kind: 'one_off', amountKop: amount, date, mode: 'reduce_term', source: 'recommendation' },
            ]),
          );
          return { applied: req.body.patch, scenarioId: id };
        }
        case 'tax_to_prepayment': {
          if (!loan) throw notFound('Кредит');
          const pps = taxRefundsToPrepayments(plan.tax, loan.id, 'reduce_term', { fromDate: plan.today });
          const id = await mutate(req, 'prepayment_scenario', 'recommendation:tax_to_prepayment', (tx) =>
            createScenarioWith(tx, hid, 'Вычеты в досрочку', [...(active?.prepayments.filter((p) => p.source !== 'tax_refund') ?? []), ...pps]),
          );
          return { applied: req.body.patch, scenarioId: id };
        }
        default:
          throw new AppError('validation_error', 'Неизвестное действие');
      }
    },
  );
};

function nextPaymentDate(plan: Awaited<ReturnType<typeof getPlan>>['plan'], loanId: string): string | null {
  return plan.loans.find((l) => l.loanId === loanId)?.nextPayment?.date ?? null;
}

/** Досрочка — после полной подушки (остальной порядок сохраняется). */
export function movePrepaymentAfterCushion(steps: GoalStep[]): GoalStep[] {
  const list = steps.length ? [...steps] : [...DEFAULT_GOAL_STEPS];
  const prepay = list.filter((x) => x.target === 'prepayment');
  const rest = list.filter((x) => x.target !== 'prepayment');
  const idx = rest.findIndex((x) => x.target === 'full_cushion');
  if (idx < 0) return [...rest, { target: 'full_cushion', sources: 'any', enabled: true }, ...prepay];
  rest.splice(idx + 1, 0, ...prepay);
  return rest;
}
