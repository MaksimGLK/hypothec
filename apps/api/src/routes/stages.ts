import {
  CreateDocumentRequest,
  CreateStageRequest,
  ReorderStagesRequest,
  Stage as StageDto,
  UpdateDocumentRequest,
  UpdateStageRequest,
} from '@hypothec/api-contract';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import * as s from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { IdParams, mutate } from './helpers.js';

export async function loadStages(db: Db, householdId: string): Promise<z.infer<typeof StageDto>[]> {
  const [rows, docs] = await Promise.all([
    db.select().from(s.stages).where(eq(s.stages.householdId, householdId)).orderBy(asc(s.stages.sort), asc(s.stages.createdAt)),
    db.select().from(s.stageDocuments).where(eq(s.stageDocuments.householdId, householdId)).orderBy(asc(s.stageDocuments.sort)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    templateKey: r.templateKey,
    title: r.title,
    hint: r.hint,
    status: r.status as 'todo',
    plannedDate: r.plannedDate,
    actualDate: r.actualDate,
    lessonKey: r.lessonKey,
    sort: r.sort,
    version: r.version,
    documents: docs.filter((d) => d.stageId === r.id).map((d) => ({ id: d.id, title: d.title, isReady: d.isReady })),
  }));
}

async function loadStage(db: Db, householdId: string, id: string) {
  const stage = (await loadStages(db, householdId)).find((x) => x.id === id);
  if (!stage) throw notFound('Этап');
  return stage;
}

export const stageRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;
  const tags = ['stages'];

  app.get('/stages', { schema: { tags, summary: 'Этапы сделки с документами', response: { 200: z.array(StageDto) } } }, (req) => loadStages(db, req.household.id));

  app.post('/stages', { schema: { tags, summary: 'Добавить свой этап', body: CreateStageRequest, response: { 201: StageDto } } }, async (req, reply) => {
    const { afterStageId, ...values } = req.body;
    const created = await mutate(req, 'stage', 'create', async (tx) => {
      let sort = 0;
      const all = await tx.select({ id: s.stages.id, sort: s.stages.sort }).from(s.stages).where(eq(s.stages.householdId, req.household.id)).orderBy(asc(s.stages.sort));
      if (afterStageId) {
        const after = all.find((x) => x.id === afterStageId);
        if (!after) throw notFound('Этап');
        sort = after.sort + 1;
        await tx.update(s.stages).set({ sort: sql`${s.stages.sort} + 1` }).where(and(eq(s.stages.householdId, req.household.id), sql`${s.stages.sort} >= ${sort}`));
      } else sort = (all.at(-1)?.sort ?? -1) + 1;
      const [row] = await tx.insert(s.stages).values({ householdId: req.household.id, ...values, hint: values.hint ?? null, sort }).returning();
      return row!;
    });
    reply.code(201);
    return loadStage(db, req.household.id, created.id);
  });

  app.patch('/stages/:id', { schema: { tags, summary: 'Изменить этап (статус, даты)', params: IdParams, body: UpdateStageRequest, response: { 200: StageDto } } }, async (req) => {
    const { version, ...values } = req.body;
    await mutate(req, 'stage', 'update', async (tx) => {
      const [row] = await tx
        .update(s.stages)
        .set({ ...values, version: sql`${s.stages.version} + 1`, updatedAt: new Date() })
        .where(and(eq(s.stages.id, req.params.id), eq(s.stages.householdId, req.household.id), eq(s.stages.version, version)))
        .returning();
      if (!row) {
        const [exists] = await tx.select({ id: s.stages.id }).from(s.stages).where(and(eq(s.stages.id, req.params.id), eq(s.stages.householdId, req.household.id)));
        throw exists ? conflict() : notFound('Этап');
      }
      // этап «Ключи и переезд» задаёт дату ключей: от неё зависят аренда, расходы на обустройство и вычет
      if (row.templateKey === 'move_in' && (values.actualDate !== undefined || values.plannedDate !== undefined)) {
        const keysDate = row.actualDate ?? row.plannedDate;
        await tx
          .update(s.scenarios)
          .set({ keysDate, version: sql`${s.scenarios.version} + 1` })
          .where(eq(s.scenarios.householdId, req.household.id));
      }
      return row;
    });
    return loadStage(db, req.household.id, req.params.id);
  });

  app.delete('/stages/:id', { schema: { tags, summary: 'Удалить этап', params: IdParams } }, async (req, reply) => {
    await mutate(req, 'stage', 'delete', async (tx) => {
      const rows = await tx.delete(s.stages).where(and(eq(s.stages.id, req.params.id), eq(s.stages.householdId, req.household.id))).returning({ id: s.stages.id });
      if (!rows.length) throw notFound('Этап');
      return rows[0]!;
    });
    reply.code(204);
  });

  app.post('/stages/reorder', { schema: { tags, summary: 'Поменять порядок этапов', body: ReorderStagesRequest, response: { 200: z.array(StageDto) } } }, async (req) => {
    await mutate(req, 'stage', 'reorder', async (tx) => {
      const owned = await tx.select({ id: s.stages.id }).from(s.stages).where(and(eq(s.stages.householdId, req.household.id), inArray(s.stages.id, req.body.ids)));
      if (owned.length !== new Set(req.body.ids).size) throw notFound('Этап');
      for (const [i, id] of req.body.ids.entries()) await tx.update(s.stages).set({ sort: i }).where(eq(s.stages.id, id));
    });
    return loadStages(db, req.household.id);
  });

  // ── документы этапа ──
  app.post('/stages/:id/documents', { schema: { tags, summary: 'Добавить документ в чек-лист', params: IdParams, body: CreateDocumentRequest, response: { 201: StageDto } } }, async (req, reply) => {
    await mutate(req, 'document', 'create', async (tx) => {
      const [stage] = await tx.select({ id: s.stages.id }).from(s.stages).where(and(eq(s.stages.id, req.params.id), eq(s.stages.householdId, req.household.id)));
      if (!stage) throw notFound('Этап');
      const [row] = await tx.insert(s.stageDocuments).values({ householdId: req.household.id, stageId: stage.id, title: req.body.title, sort: 1000 }).returning();
      return row!;
    });
    reply.code(201);
    return loadStage(db, req.household.id, req.params.id);
  });

  const DocParams = z.object({ id: z.uuid(), docId: z.uuid() });

  app.patch('/stages/:id/documents/:docId', { schema: { tags, summary: 'Отметить документ готовым', params: DocParams, body: UpdateDocumentRequest, response: { 200: StageDto } } }, async (req) => {
    await mutate(req, 'document', 'update', async (tx) => {
      const rows = await tx
        .update(s.stageDocuments)
        .set(req.body)
        .where(and(eq(s.stageDocuments.id, req.params.docId), eq(s.stageDocuments.stageId, req.params.id), eq(s.stageDocuments.householdId, req.household.id)))
        .returning({ id: s.stageDocuments.id });
      if (!rows.length) throw notFound('Документ');
      return rows[0]!;
    });
    return loadStage(db, req.household.id, req.params.id);
  });

  app.delete('/stages/:id/documents/:docId', { schema: { tags, summary: 'Удалить документ', params: DocParams } }, async (req, reply) => {
    await mutate(req, 'document', 'delete', async (tx) => {
      const rows = await tx
        .delete(s.stageDocuments)
        .where(and(eq(s.stageDocuments.id, req.params.docId), eq(s.stageDocuments.stageId, req.params.id), eq(s.stageDocuments.householdId, req.household.id)))
        .returning({ id: s.stageDocuments.id });
      if (!rows.length) throw notFound('Документ');
      return rows[0]!;
    });
    reply.code(204);
  });
};
