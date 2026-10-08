// Сборка в dist/: свои пакеты (@hypothec/*) вшиваются в бандл, внешние зависимости остаются в node_modules.
import { build } from 'esbuild';
import { cpSync, readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@hypothec/'));

rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: { main: 'src/main.ts', worker: 'src/worker.ts', migrate: 'src/db/migrate-cli.ts', 'content-sync': 'src/content/sync-cli.ts', openapi: 'src/openapi-cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
cpSync('drizzle', 'dist/drizzle', { recursive: true });
