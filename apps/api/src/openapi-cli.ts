// Генерация openapi.json для мобильного клиента: pnpm --filter @hypothec/api openapi > openapi.json
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { Db } from './db/client.js';
import { noopJobs } from './deps.js';
import { createMemoryMailer } from './lib/mailer.js';

const config = loadConfig({
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused',
  JWT_SECRET: process.env.JWT_SECRET ?? 'x'.repeat(32),
  TOKEN_PEPPER: process.env.TOKEN_PEPPER ?? 'x'.repeat(16),
  LOG_LEVEL: 'silent',
});
const app = await buildApp({ config, db: {} as Db, mailer: createMemoryMailer(), jobs: noopJobs, now: () => new Date() }, { logger: false });
await app.ready();
process.stdout.write(JSON.stringify(app.swagger(), null, 2));
await app.close();
