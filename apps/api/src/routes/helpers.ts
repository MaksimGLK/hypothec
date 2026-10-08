import { and, asc, eq, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { DbOrTx } from '../db/client.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { touchHousehold } from '../services/households.js';

/**
 * Изменение данных семьи в транзакции: ревизия +1, запись в журнал,
 * после коммита — пересборка напоминаний (с задержкой).
 */
export async function mutate<T>(req: FastifyRequest, entity: string, action: string, fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
  const deps = req.server.deps;
  const result = await deps.db.transaction(async (tx) => {
    const r = await fn(tx);
    const entityId = r && typeof r === 'object' && 'id' in r ? String((r as { id: unknown }).id) : null;
    await touchHousehold(deps, tx, req.household.id, req.user.id, action, entity, entityId);
    return r;
  });
  deps.jobs.planChanged(req.household.id).catch((err) => req.log.error({ err }, 'planChanged failed'));
  return result;
}

/** Ссылка на запись другой семьи — как будто её нет. */
export async function assertOwned(tx: DbOrTx, table: PgTable & { id: PgColumn; householdId: PgColumn }, id: string | null | undefined, householdId: string, what: string) {
  if (!id) return;
  const rows = await tx
    .select({ id: table.id })
    .from(table as PgTable)
    .where(and(eq(table.id, id), eq(table.householdId, householdId)))
    .limit(1);
  if (rows.length === 0) throw notFound(what);
}

/** null → отсутствие поля: в контракте необязательные поля описаны как optional. */
export function stripNulls<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (v !== null) out[k] = v;
  return out as T;
}

export const IdParams = z.object({ id: z.uuid() });

type CrudTable = PgTable & { id: PgColumn; householdId: PgColumn; version: PgColumn; createdAt: PgColumn; updatedAt: PgColumn };

export interface CrudOptions {
  path: string;
  entity: string;
  title: string;
  table: CrudTable;
  dto: z.ZodType;
  create: z.ZodType;
  update: z.ZodType;
  orderBy?: PgColumn;
  /** Проверки перед записью (например, ссылки на этап или кредит этой же семьи). */
  validate?: (tx: DbOrTx, householdId: string, values: Record<string, unknown>, existing?: Record<string, unknown>) => Promise<void>;
  /** Запрет удаления (например, системных счетов). */
  canDelete?: (row: Record<string, unknown>) => string | null;
  toDto?: (row: Record<string, unknown>) => unknown;
  /** Действия после создания в той же транзакции. */
  afterCreate?: (tx: DbOrTx, householdId: string, row: Record<string, unknown>) => Promise<void>;
  /** Действия перед удалением в той же транзакции. */
  beforeDelete?: (tx: DbOrTx, householdId: string, row: Record<string, unknown>) => Promise<void>;
}

/**
 * Стандартный набор эндпоинтов для сущности семьи: список, создание, изменение с проверкой версии, удаление.
 * Регистрируется внутри плагина /households/:hid, где уже проверен доступ.
 */
export function registerCrud(app: FastifyInstance, o: CrudOptions) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const t = o.table;
  const toDto = o.toDto ?? ((row: Record<string, unknown>) => stripNulls(row));
  const tags = [o.entity];

  r.get(`/${o.path}`, { schema: { tags, summary: `${o.title}: список`, response: { 200: z.array(o.dto) } } }, async (req) => {
    const rows = await req.server.deps.db
      .select()
      .from(t as PgTable)
      .where(eq(t.householdId, req.household.id))
      .orderBy(asc(o.orderBy ?? t.createdAt));
    return rows.map((x) => toDto(x as Record<string, unknown>));
  });

  r.post(`/${o.path}`, { schema: { tags, summary: `${o.title}: создать`, body: o.create, response: { 201: o.dto } } }, async (req, reply) => {
    const values = req.body as Record<string, unknown>;
    const row = await mutate(req, o.entity, 'create', async (tx) => {
      await o.validate?.(tx, req.household.id, values);
      const [created] = await tx
        .insert(t)
        .values({ ...values, householdId: req.household.id } as never)
        .returning();
      await o.afterCreate?.(tx, req.household.id, created as Record<string, unknown>);
      return created as Record<string, unknown>;
    });
    reply.code(201);
    return toDto(row);
  });

  r.patch(`/${o.path}/:id`, { schema: { tags, summary: `${o.title}: изменить`, params: IdParams, body: o.update, response: { 200: o.dto } } }, async (req) => {
    const { version, ...values } = req.body as Record<string, unknown> & { version: number };
    const row = await mutate(req, o.entity, 'update', async (tx) => {
      const [existing] = await tx
        .select()
        .from(t as PgTable)
        .where(and(eq(t.id, req.params.id), eq(t.householdId, req.household.id)))
        .limit(1);
      if (!existing) throw notFound(o.title);
      await o.validate?.(tx, req.household.id, values, existing as Record<string, unknown>);
      const [updated] = await tx
        .update(t)
        .set({ ...values, version: sql`${t.version} + 1`, updatedAt: new Date() } as never)
        .where(and(eq(t.id, req.params.id), eq(t.householdId, req.household.id), eq(t.version, version)))
        .returning();
      if (!updated) throw conflict();
      return updated as Record<string, unknown>;
    });
    return toDto(row);
  });

  r.delete(`/${o.path}/:id`, { schema: { tags, summary: `${o.title}: удалить`, params: IdParams } }, async (req, reply) => {
    await mutate(req, o.entity, 'delete', async (tx) => {
      const [existing] = await tx
        .select()
        .from(t as PgTable)
        .where(and(eq(t.id, req.params.id), eq(t.householdId, req.household.id)))
        .limit(1);
      if (!existing) throw notFound(o.title);
      const reason = o.canDelete?.(existing as Record<string, unknown>);
      if (reason) throw new AppError('conflict', reason);
      await o.beforeDelete?.(tx, req.household.id, existing as Record<string, unknown>);
      await tx.delete(t).where(eq(t.id, req.params.id));
      return { id: req.params.id };
    });
    reply.code(204);
  });
}
