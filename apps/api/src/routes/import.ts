import { ImportCommitRequest, ImportPreviewRequest } from '@hypothec/api-contract';
import { BANK_NAMES, parseStatement, suggestCategory, SUGGESTION_REASONS } from '@hypothec/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import * as s from '../db/schema.js';
import { mutate } from './helpers.js';

/**
 * Импорт выписки банка в бюджет: предпросмотр с предложенными категориями → подтверждение пользователем → траты.
 * Файл разбирает клиент (CSV или Excel) и присылает таблицу — сервер не хранит выписку целиком.
 */
export const importRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;
  const tags = ['budget'];

  app.post('/budget/import/preview', { bodyLimit: 8_000_000, schema: { tags, summary: 'Разобрать выписку и предложить категории', body: ImportPreviewRequest } }, async (req) => {
    const parsed = parseStatement(req.body.rows, req.body.manual);
    const hid = req.household.id;
    const [cats, rules] = await Promise.all([
      db.select({ id: s.livingExpenses.id, name: s.livingExpenses.name, catalogKey: s.livingExpenses.catalogKey }).from(s.livingExpenses).where(eq(s.livingExpenses.householdId, hid)),
      db.select({ merchantKey: s.categorizationRules.merchantKey, categoryId: s.categorizationRules.categoryId }).from(s.categorizationRules).where(eq(s.categorizationRules.householdId, hid)),
    ]);
    const keys = parsed.operations.map((o) => o.importKey);
    const existing = keys.length
      ? await db.select({ k: s.spendings.importKey }).from(s.spendings).where(and(eq(s.spendings.householdId, hid), inArray(s.spendings.importKey, keys)))
      : [];
    const imported = new Set(existing.map((e) => e.k));
    const operations = parsed.operations.map((o) => {
      const suggestion = o.kind === 'expense' ? suggestCategory(o, cats, rules) : { categoryId: null, reason: 'none' as const };
      return { ...o, suggestion: { ...suggestion, reasonText: SUGGESTION_REASONS[suggestion.reason] }, duplicate: imported.has(o.importKey) };
    });
    const sum = (k: string) => operations.filter((o) => o.kind === k).reduce((acc, o) => acc + o.amountKop, 0);
    return {
      bank: parsed.bank,
      bankName: BANK_NAMES[parsed.bank],
      header: parsed.header,
      headerRow: parsed.headerRow,
      mapping: parsed.mapping,
      errors: parsed.errors.slice(0, 50),
      operations,
      summary: {
        expenseKop: sum('expense'),
        incomeKop: sum('income'),
        transferKop: sum('transfer'),
        loanKop: sum('loan'),
        cashKop: sum('cash'),
        duplicates: operations.filter((o) => o.duplicate).length,
        period: operations.length ? { from: operations.reduce((m, o) => (o.date < m ? o.date : m), operations[0]!.date), to: operations.reduce((m, o) => (o.date > m ? o.date : m), operations[0]!.date) } : null,
      },
    };
  });

  app.post('/budget/import/commit', { bodyLimit: 8_000_000, schema: { tags, summary: 'Внести выбранные операции в бюджет', body: ImportCommitRequest } }, async (req) => {
    const hid = req.household.id;
    const result = await mutate(req, 'spending', 'import', async (tx) => {
      const own = await tx.select({ id: s.livingExpenses.id }).from(s.livingExpenses).where(eq(s.livingExpenses.householdId, hid));
      const ownIds = new Set(own.map((c) => c.id));
      const items = req.body.items.map((i) => ({ ...i, categoryId: i.categoryId && ownIds.has(i.categoryId) ? i.categoryId : null }));
      const inserted = await tx
        .insert(s.spendings)
        .values(items.map((i) => ({ householdId: hid, categoryId: i.categoryId, date: i.date, amountKop: i.amountKop, note: i.description.slice(0, 200), source: 'import', importKey: i.importKey, createdBy: req.user.id })))
        .onConflictDoNothing({ target: [s.spendings.householdId, s.spendings.importKey] })
        .returning({ id: s.spendings.id });
      let learned = 0;
      if (req.body.learn) {
        const byMerchant = new Map<string, string>();
        for (const i of items) if (i.categoryId && i.merchantKey) byMerchant.set(i.merchantKey, i.categoryId);
        for (const [merchantKey, categoryId] of byMerchant) {
          await tx
            .insert(s.categorizationRules)
            .values({ householdId: hid, merchantKey, categoryId })
            .onConflictDoUpdate({ target: [s.categorizationRules.householdId, s.categorizationRules.merchantKey], set: { categoryId, updatedAt: sql`now()` } });
          learned++;
        }
      }
      return { created: inserted.length, skipped: items.length - inserted.length, learned };
    });
    return result;
  });
};
