import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, inject } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import type { AppDeps, JobQueue } from '../src/deps.js';
import { createMemoryMailer } from '../src/lib/mailer.js';

export const PREFIX = '/api/v1';
export const CONSENT = [{ type: 'personal_data', documentVersion: '2026-10', accepted: true }];

export interface TestContext {
  app: FastifyInstance;
  deps: AppDeps;
  mailer: ReturnType<typeof createMemoryMailer>;
  clock: { now: Date; advance(ms: number): void };
  planChanged: string[];
}

/** Приложение с почтой в памяти, управляемыми часами и записью событий очереди. */
export function setupApp(): TestContext {
  const ctx = {} as TestContext;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: inject('databaseUrl'),
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      TOKEN_PEPPER: 'test-pepper-123456',
      LOG_LEVEL: 'silent',
    });
    const created = createDb(config.DATABASE_URL, { max: 5 });
    close = created.close;
    const mailer = createMemoryMailer();
    const clock = {
      now: new Date('2026-10-08T09:00:00Z'),
      advance(ms: number) {
        this.now = new Date(this.now.getTime() + ms);
      },
    };
    const planChanged: string[] = [];
    const jobs: JobQueue = { planChanged: async (hid) => void planChanged.push(hid) };
    const deps: AppDeps = { config, db: created.db, mailer, jobs, now: () => clock.now };
    Object.assign(ctx, { deps, mailer, clock, planChanged, app: await buildApp(deps, { logger: false, rateLimit: false }) });
  });
  afterAll(async () => {
    await ctx.app?.close();
    await close?.();
  });
  return ctx;
}

export const uniqueEmail = (prefix = 'user') => `${prefix}-${randomUUID().slice(0, 8)}@example.ru`;

export interface Session {
  email: string;
  token: string;
  refreshToken: string;
  userId: string;
  householdId: string;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export function client(ctx: TestContext, token?: string) {
  return async (method: Method, url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse & { body: string; data: any }> => {
    const res = await ctx.app.inject({
      method,
      url: url.startsWith('/api') ? url : `${PREFIX}${url}`,
      ...(payload !== undefined ? { payload: payload as object } : {}),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    });
    let data: any = null;
    try {
      data = res.body ? JSON.parse(res.body) : null;
    } catch {
      data = res.body;
    }
    return Object.assign(res, { data });
  };
}

export async function register(ctx: TestContext, opts: { email?: string; password?: string; name?: string; verify?: boolean } = {}): Promise<Session> {
  const email = opts.email ?? uniqueEmail();
  const res = await client(ctx)('POST', '/auth/register', {
    email,
    password: opts.password ?? 'ипотека без паники',
    name: opts.name ?? 'Иван',
    consents: CONSENT,
    device: { platform: 'ios', name: 'test' },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const token = res.data.accessToken as string;
  const households = await client(ctx, token)('GET', '/households');
  const s: Session = { email, token, refreshToken: res.data.refreshToken, userId: res.data.user.id, householdId: households.data[0].id };
  if (opts.verify !== false) {
    const code = lastCode(ctx, email);
    const v = await client(ctx, token)('POST', '/auth/verify-email', { code });
    if (v.statusCode !== 200) throw new Error(`verify failed: ${v.body}`);
  }
  return s;
}

export function lastCode(ctx: TestContext, email: string): string {
  const m = ctx.mailer.last(email.toLowerCase());
  const code = m?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no code mailed to ${email}`);
  return code;
}

/** Типовые ответы мастера: вторичка 9 млн, взнос 2 млн, ставка 16%, 20 лет. */
export const WIZARD = {
  adults: 2,
  children: 1,
  housingType: 'secondary',
  sellingOwn: false,
  maternityCapitalKop: 0,
  program: 'base',
  priceKop: 900_000_000,
  downPaymentKop: 200_000_000,
  annualRate: '16',
  termYears: 20,
  startDate: '2026-10-08',
};
