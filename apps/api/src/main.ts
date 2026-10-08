import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { syncContent } from './content/sync.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createBoss, ensureQueues, pgBossJobs } from './jobs/queue.js';
import { createSmtpMailer } from './lib/mailer.js';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
await runMigrations(db);
await syncContent(db);

const boss = createBoss(config.DATABASE_URL);
await boss.start();
await ensureQueues(boss);

const app = await buildApp({ config, db, mailer: createSmtpMailer(config), jobs: pgBossJobs(boss), now: () => new Date() });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await boss.stop({ graceful: true });
  await close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
