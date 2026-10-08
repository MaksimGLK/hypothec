import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { FACT_DESCRIPTIONS, type RecommendationRule, validateRule } from '@hypothec/core';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { contentItems, recommendationRules } from '../db/schema.js';
import { resetRulesCache } from '../services/plan.js';
import { parseLesson } from './parse.js';

/** Где лежит пакет content: переменная CONTENT_DIR (в Docker) или рядом в монорепозитории. */
export function contentDir(): string {
  if (process.env.CONTENT_DIR) return process.env.CONTENT_DIR;
  return path.dirname(createRequire(import.meta.url).resolve('@hypothec/content/package.json'));
}

export interface SyncResult {
  lessons: number;
  glossary: number;
  rules: number;
}

/** Загружает уроки, словарь и правила в БД. Идемпотентно: можно запускать при каждом старте. */
export async function syncContent(db: Db, dir = contentDir()): Promise<SyncResult> {
  const lessonsDir = path.join(dir, 'lessons');
  const lessons = readdirSync(lessonsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseLesson(path.basename(f, '.md'), readFileSync(path.join(lessonsDir, f), 'utf8')));
  const glossary = JSON.parse(readFileSync(path.join(dir, 'glossary.json'), 'utf8')) as {
    reviewedAt: string;
    terms: { key: string; term: string; short: string; lessonKey?: string; aliases?: string[] }[];
  };
  const rules = (JSON.parse(readFileSync(path.join(dir, 'rules', 'starter.json'), 'utf8')) as { rules: RecommendationRule[] }).rules;
  const known = Object.keys(FACT_DESCRIPTIONS);
  for (const r of rules) {
    const errors = validateRule(r, known);
    if (errors.length) throw new Error(`Правило ${r.key}: ${errors.join('; ')}`);
  }

  await db.transaction(async (tx) => {
    const upsert = (kind: string, key: string, title: string, body: unknown, sources: unknown, reviewedAt: string) =>
      tx
        .insert(contentItems)
        .values({ kind, key, title, body, sources, reviewedAt })
        .onConflictDoUpdate({
          target: [contentItems.kind, contentItems.key],
          set: { title, body, sources, reviewedAt, updatedAt: new Date(), version: sql`${contentItems.version} + 1` },
          setWhere: sql`${contentItems.body} is distinct from ${JSON.stringify(body)}::jsonb or ${contentItems.title} <> ${title}`,
        });
    for (const l of lessons) {
      const { key, title, sources, reviewedAt, ...body } = l;
      await upsert('lesson', key, title, body, sources, reviewedAt);
    }
    for (const t of glossary.terms) {
      await upsert('glossary', t.key, t.term, { short: t.short, lessonKey: t.lessonKey ?? null, aliases: t.aliases ?? [] }, [], glossary.reviewedAt);
    }
    for (const r of rules) {
      await tx
        .insert(recommendationRules)
        .values({ key: r.key, version: r.version, definition: r, isActive: r.active !== false })
        .onConflictDoUpdate({ target: [recommendationRules.key, recommendationRules.version], set: { definition: r, isActive: r.active !== false } });
    }
  });
  resetRulesCache();
  return { lessons: lessons.length, glossary: glossary.terms.length, rules: rules.length };
}
