import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { syncContent } from '../src/content/sync.js';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

let container: StartedPostgreSqlContainer | undefined;

/** Один Postgres на весь прогон: миграции и контент применяются один раз. */
export async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    url = container.getConnectionUri();
  }
  const { db, close } = createDb(url, { max: 1 });
  await runMigrations(db);
  await syncContent(db);
  await close();
  project.provide('databaseUrl', url);
}

export async function teardown() {
  await container?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
