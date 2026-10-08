import { EXPENSE_CATALOG, lessonValues, PROGRAM_DEFAULTS, PROGRAM_DEFAULTS_REVIEWED_AT, renderTemplate, STAGE_TEMPLATES } from '@hypothec/core';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { contentItems } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { getAccess } from '../services/households.js';
import { getPlan } from '../services/plan.js';
import type { ParsedLesson } from '../content/parse.js';

type LessonBody = Omit<ParsedLesson, 'key' | 'title' | 'sources' | 'reviewedAt'>;

export const contentRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = app.deps;
  const { db } = deps;
  const tags = ['content'];

  app.get('/content/lessons', { schema: { tags, summary: 'Уроки (без текста)' } }, async () => {
    const rows = await db.select().from(contentItems).where(eq(contentItems.kind, 'lesson')).orderBy(asc(contentItems.key));
    return rows.map((r) => {
      const b = r.body as LessonBody;
      return { key: r.key, title: r.title, minutes: b.minutes, screens: b.screens, reviewedAt: r.reviewedAt };
    });
  });

  /**
   * Урок. С householdId блок «В вашем случае» заполняется цифрами семьи;
   * без кредита в плане блок не показывается.
   */
  app.get(
    '/content/lessons/:key',
    { schema: { tags, summary: 'Урок с расчётом на ваших данных', params: z.object({ key: z.string().max(64) }), querystring: z.object({ householdId: z.uuid().optional() }) } },
    async (req) => {
      const [row] = await db.select().from(contentItems).where(and(eq(contentItems.kind, 'lesson'), eq(contentItems.key, req.params.key))).limit(1);
      if (!row) throw notFound('Урок');
      const body = row.body as LessonBody;
      let personal: string | null = null;
      if (body.personal && req.query.householdId) {
        await getAccess(deps, req.query.householdId, req.user.id);
        const { plan, input } = await getPlan(deps, req.query.householdId);
        const values = lessonValues(plan, input);
        if (values.hasLoan) personal = renderTemplate(body.personal, values, null);
      }
      return {
        key: row.key,
        title: row.title,
        minutes: body.minutes,
        screens: body.screens,
        markdown: body.markdown,
        personal,
        quiz: body.quiz,
        sources: row.sources,
        reviewedAt: row.reviewedAt,
        version: row.version,
      };
    },
  );

  app.get('/content/glossary', { schema: { tags, summary: 'Словарь терминов для подсказок' } }, async () => {
    const rows = await db.select().from(contentItems).where(eq(contentItems.kind, 'glossary')).orderBy(asc(contentItems.title));
    return rows.map((r) => ({ key: r.key, term: r.title, ...(r.body as { short: string; lessonKey: string | null; aliases: string[] }) }));
  });

  app.get('/catalog/expenses', { schema: { tags: ['catalog'], summary: 'Справочник типовых расходов' } }, async () => EXPENSE_CATALOG);
  app.get('/catalog/stage-templates', { schema: { tags: ['catalog'], summary: 'Шаблоны этапов сделки' } }, async () => STAGE_TEMPLATES);
  app.get('/catalog/programs', { schema: { tags: ['catalog'], summary: 'Программы ипотеки (ориентиры для мастера)' } }, async () => ({
    programs: PROGRAM_DEFAULTS,
    reviewedAt: PROGRAM_DEFAULTS_REVIEWED_AT,
    note: 'Ставки — ориентир для черновика плана. Укажите ставку из одобрения вашего банка.',
  }));
};
