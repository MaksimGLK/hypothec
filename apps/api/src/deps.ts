import type { Config } from './config.js';
import type { Db } from './db/client.js';
import type { Mailer } from './lib/mailer.js';

/** Фоновые задачи. В тестах — заглушка, в проде — pg-boss. */
export interface JobQueue {
  /** Пересобрать напоминания семьи после изменения плана (с задержкой, чтобы не дёргать на каждую правку). */
  planChanged(householdId: string): Promise<void>;
}

export const noopJobs: JobQueue = { planChanged: async () => {} };

export interface AppDeps {
  config: Config;
  db: Db;
  mailer: Mailer;
  jobs: JobQueue;
  now: () => Date;
}

export interface AuthUser {
  id: string;
  sessionId: string;
}

export interface HouseholdAccess {
  id: string;
  role: 'owner' | 'member';
  memberId: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
  interface FastifyRequest {
    user: AuthUser;
    household: HouseholdAccess;
  }
}
