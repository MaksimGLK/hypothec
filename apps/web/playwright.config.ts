import { defineConfig, devices } from '@playwright/test';

/**
 * Сквозной тест интерфейса. Нужны запущенные API (pnpm dev:api), веб (pnpm --filter @hypothec/web dev)
 * и Mailpit (pnpm db:up) — из него тест берёт код подтверждения почты.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  outputDir: './e2e/.results',
  use: { baseURL: process.env.WEB_URL ?? 'http://127.0.0.1:5180', locale: 'ru-RU', timezoneId: 'Europe/Moscow' },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { viewport: { width: 1366, height: 900 } } },
  ],
});
