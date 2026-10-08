import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  /** Секрет подписи access-токенов, не короче 32 символов. */
  JWT_SECRET: z.string().min(32),
  /** Секрет для хэширования одноразовых кодов и токенов. */
  TOKEN_PEPPER: z.string().min(16),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(60),
  /** Адреса веб-клиента через запятую (CORS). */
  WEB_ORIGINS: z.string().default('http://localhost:5180'),
  /** Публичный адрес веба — для ссылок в письмах. */
  PUBLIC_WEB_URL: z.string().default('http://localhost:5180'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z.stringbool().default(false),
  MAIL_FROM: z.string().default('Ипотечный планировщик <no-reply@localhost>'),
  /** Версия документа «Согласие на обработку ПДн», которую должен принять пользователь. */
  CONSENT_DOCUMENT_VERSION: z.string().default('2026-10'),
  /** Час отправки напоминаний по Москве. */
  REMINDER_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof Env> & { webOrigins: string[]; isProd: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Некорректные переменные окружения:\n${issues}`);
  }
  return {
    ...parsed.data,
    webOrigins: parsed.data.WEB_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    isProd: parsed.data.NODE_ENV === 'production',
  };
}

/** Сервис работает по московскому времени: «сегодня» для плана и время напоминаний. */
export const TIME_ZONE = 'Europe/Moscow';

export function todayInMoscow(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
