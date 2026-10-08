import pino from 'pino';
import { asc } from 'drizzle-orm';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { households } from './db/schema.js';
import type { AppDeps } from './deps.js';
import { createBoss, ensureQueues, pgBossJobs, QUEUES } from './jobs/queue.js';
import { createSmtpMailer } from './lib/mailer.js';
import { rebuildHouseholdReminders, sendDueNotifications } from './services/notifications.js';

/**
 * Фоновый процесс: напоминания по email. Тот же образ, что и API, отдельный процесс.
 * Push для мобильных приложений добавится сюда же: модель уведомлений общая, отличается канал.
 */
const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL });
const { db, close } = createDb(config.DATABASE_URL, { max: 5 });
await runMigrations(db);
const boss = createBoss(config.DATABASE_URL);
boss.on('error', (err) => log.error({ err }, 'pg-boss error'));
await boss.start();
await ensureQueues(boss);
const deps: AppDeps = { config, db, mailer: createSmtpMailer(config), jobs: pgBossJobs(boss), now: () => new Date() };

await boss.work<{ householdId: string }>(QUEUES.householdReminders, async (jobs) => {
  for (const job of jobs) {
    const r = await rebuildHouseholdReminders(deps, job.data.householdId);
    log.info({ householdId: job.data.householdId, ...r }, 'reminders rebuilt');
  }
});

await boss.work(QUEUES.dailyReminders, async () => {
  const rows = await db.select({ id: households.id }).from(households).orderBy(asc(households.createdAt));
  for (const h of rows) await boss.send(QUEUES.householdReminders, { householdId: h.id });
  log.info({ households: rows.length }, 'daily reminders queued');
});

await boss.work(QUEUES.sendNotifications, async () => {
  const sent = await sendDueNotifications(deps);
  if (sent) log.info({ sent }, 'notifications sent');
});

// время — московское
await boss.schedule(QUEUES.dailyReminders, '0 5 * * *', null, { tz: 'Europe/Moscow' });
await boss.schedule(QUEUES.sendNotifications, '*/5 * * * *', null, { tz: 'Europe/Moscow' });
log.info('worker started');

const shutdown = async () => {
  await boss.stop({ graceful: true });
  await close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
