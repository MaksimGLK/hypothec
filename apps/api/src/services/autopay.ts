import { dueAutoPayments } from '@hypothec/core';
import { and, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { todayInMoscow } from '../config.js';
import * as s from '../db/schema.js';
import type { AppDeps } from '../deps.js';
import { touchHousehold } from './households.js';
import { toLivingInput } from './plan.js';

/**
 * Записывает наступившие автоплатежи семьи. Идемпотентно: месяц отмечается в категории
 * условным UPDATE, поэтому параллельные вызовы (воркер и открытая страница) не создадут дублей.
 */
export async function applyAutoPayments(deps: AppDeps, householdId: string): Promise<number> {
  const today = todayInMoscow(deps.now());
  const monthStart = `${today.slice(0, 7)}-01`;
  const cats = await deps.db.select().from(s.livingExpenses).where(and(eq(s.livingExpenses.householdId, householdId), sql`${s.livingExpenses.autoPayDay} is not null`));
  if (!cats.length) return 0;
  const [scenario] = await deps.db.select({ keysDate: s.scenarios.keysDate }).from(s.scenarios).where(eq(s.scenarios.householdId, householdId));
  const monthSpendings = await deps.db
    .select()
    .from(s.spendings)
    .where(and(eq(s.spendings.householdId, householdId), gte(s.spendings.date, monthStart)));
  const due = dueAutoPayments(
    cats.map(toLivingInput),
    monthSpendings.map((r) => ({ id: r.id, categoryId: r.categoryId, date: r.date, amountKop: r.amountKop })),
    today,
    { keysDate: scenario?.keysDate ?? null },
  );
  let created = 0;
  for (const d of due) {
    await deps.db.transaction(async (tx) => {
      const claimed = await tx
        .update(s.livingExpenses)
        .set({ autoPayLastMonth: d.month })
        .where(and(eq(s.livingExpenses.id, d.categoryId), or(isNull(s.livingExpenses.autoPayLastMonth), lt(s.livingExpenses.autoPayLastMonth, d.month))))
        .returning({ id: s.livingExpenses.id });
      if (!claimed.length || !d.create) return;
      await tx.insert(s.spendings).values({ householdId, categoryId: d.categoryId, date: d.date, amountKop: d.amountKop, note: 'Автоплатёж', source: 'auto' });
      await touchHousehold(deps, tx, householdId, null, 'auto_pay', 'spending', d.categoryId);
      created++;
    });
  }
  return created;
}
