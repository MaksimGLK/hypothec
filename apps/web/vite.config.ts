import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// API на том же адресе (через прокси) — cookie с refresh-токеном работает без CORS.
// В продакшене то же самое делает nginx: веб и /api на одном домене.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false } },
  },
  preview: { port: 5180 },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // библиотеки меняются реже кода — отдельные чанки дольше живут в кеше
        manualChunks: {
          react: ['react', 'react-dom', 'react-router', '@tanstack/react-query'],
          charts: ['recharts'],
          core: ['@hypothec/core'],
        },
      },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], setupFiles: ['./src/test-setup.ts'], css: false },
});
