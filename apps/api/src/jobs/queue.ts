import { PgBoss } from 'pg-boss';
import type { JobQueue } from '../deps.js';

export const QUEUES = {
  /** Пересобрать напоминания одной семьи. */
  householdReminders: 'household-reminders',
  /** Раз в сутки — пересобрать напоминания всех семей (наступил новый день). */
  dailyReminders: 'daily-reminders',
  /** Каждые 5 минут — отправить наступившие напоминания. */
  sendNotifications: 'send-notifications',
} as const;

export function createBoss(databaseUrl: string): PgBoss {
  return new PgBoss({ connectionString: databaseUrl, schema: 'pgboss' });
}

export async function ensureQueues(boss: PgBoss) {
  for (const name of Object.values(QUEUES)) {
    if (!(await boss.getQueue(name))) await boss.createQueue(name);
  }
}

/** Очередь на pg-boss: после правки плана напоминания пересобираются через минуту — серия правок схлопывается в одну задачу. */
export function pgBossJobs(boss: PgBoss): JobQueue {
  return {
    async planChanged(householdId) {
      await boss.sendDebounced(QUEUES.householdReminders, { householdId }, null, 60, householdId);
    },
  };
}
