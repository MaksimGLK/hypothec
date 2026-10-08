import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // файлы делят одну базу, но работают с разными пользователями и семьями
    fileParallelism: true,
  },
});
