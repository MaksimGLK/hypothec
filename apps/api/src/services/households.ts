import { DEFAULT_ALLOCATION_SETTINGS, defaultAccounts, type HouseholdSettings } from '@hypothec/core';
import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { accounts, auditLog, householdMembers, households, prepaymentScenarios } from '../db/schema.js';
import type { AppDeps, HouseholdAccess } from '../deps.js';
import { forbidden, notFound } from '../lib/errors.js';

export const DEFAULT_SETTINGS: HouseholdSettings = {
  allocation: DEFAULT_ALLOCATION_SETTINGS,
  depositRatePercent: null,
  depositTaxPercent: '13',
  marketRatePercent: null,
  refinanceCostsKop: null,
  dtiWarnPercent: 45,
};

/** Новая семья со счетами-конвертами по умолчанию и основным сценарием досрочки. */
export async function createHousehold(tx: DbOrTx, userId: string, name: string): Promise<string> {
  const [h] = await tx.insert(households).values({ name, settings: DEFAULT_SETTINGS }).returning({ id: households.id });
  const householdId = h!.id;
  await tx.insert(householdMembers).values({ householdId, userId, role: 'owner' });
  await tx.insert(accounts).values(defaultAccounts().map((a, i) => ({ householdId, kind: a.kind, name: a.name, balanceKop: 0, sort: i })));
  await tx.insert(prepaymentScenarios).values({ householdId, name: 'Основной план', isActive: true });
  return householdId;
}

export async function getAccess(deps: AppDeps, householdId: string, userId: string): Promise<HouseholdAccess> {
  if (!/^[0-9a-f-]{36}$/i.test(householdId)) throw notFound('Семья');
  const [m] = await deps.db
    .select({ id: householdMembers.id, role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .limit(1);
  // не раскрываем существование чужой семьи
  if (!m) throw notFound('Семья');
  return { id: householdId, role: m.role as HouseholdAccess['role'], memberId: m.id };
}

export function requireOwner(access: HouseholdAccess): void {
  if (access.role !== 'owner') throw forbidden('Это может сделать только владелец семьи');
}

/** Любое изменение данных семьи: растёт ревизия (сбрасывает кэш плана), пишется журнал, пересобираются напоминания. */
export async function touchHousehold(
  deps: AppDeps,
  tx: DbOrTx,
  householdId: string,
  userId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
): Promise<void> {
  await tx.update(households).set({ revision: sql`${households.revision} + 1`, updatedAt: deps.now() }).where(eq(households.id, householdId));
  await tx.insert(auditLog).values({ householdId, userId, action, entity, entityId: entityId ?? null });
}
