import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL, { max: 1 });
await runMigrations(db);
await close();
console.log('Миграции применены');
