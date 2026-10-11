import { and, eq, lte, sql } from 'drizzle-orm';
import { todayInMoscow } from '../config.js';
import * as s from '../db/schema.js';
import type { DbOrTx } from '../db/client.js';
import type { AppDeps } from '../deps.js';
import { touchHousehold } from './households.js';

/**
 * В день разовой досрочки её сумма списывается со счёта «Досрочка», а досрочка помечается внесённой и ждёт подтверждения.
 * Только для основного сценария. Идемпотентно: статус меняется условным UPDATE.
 */
export async function applyDuePrepayments(deps: AppDeps, householdId: string): Promise<number> {
  const today = todayInMoscow(deps.now());
  const due = await deps.db
    .select({ p: s.prepayments })
    .from(s.prepayments)
    .innerJoin(s.prepaymentScenarios, eq(s.prepaymentScenarios.id, s.prepayments.scenarioId))
    .where(
      and(
        eq(s.prepayments.householdId, householdId),
        eq(s.prepaymentScenarios.isActive, true),
        eq(s.prepayments.kind, 'one_off'),
        eq(s.prepayments.status, 'planned'),
        lte(s.prepayments.date, today),
      ),
    );
  let done = 0;
  for (const { p } of due) {
    await deps.db.transaction(async (tx) => {
      const claimed = await tx
        .update(s.prepayments)
        .set({ status: 'done', executedAt: deps.now(), confirmed: false })
        .where(and(eq(s.prepayments.id, p.id), eq(s.prepayments.status, 'planned')))
        .returning({ id: s.prepayments.id });
      if (!claimed.length) return;
      await adjustPrepaymentAccount(tx, householdId, -(p.factAmountKop ?? p.amountKop));
      await touchHousehold(deps, tx, householdId, null, 'prepayment_executed', 'prepayment', p.id);
      done++;
    });
  }
  return done;
}

/** Изменить остаток счёта «Досрочка» (не уходит ниже нуля). */
export async function adjustPrepaymentAccount(tx: DbOrTx, householdId: string, deltaKop: number) {
  await tx
    .update(s.accounts)
    .set({ balanceKop: sql`greatest(0, ${s.accounts.balanceKop} + ${deltaKop})`, version: sql`${s.accounts.version} + 1`, updatedAt: new Date() })
    .where(and(eq(s.accounts.householdId, householdId), eq(s.accounts.kind, 'prepayment')));
}
