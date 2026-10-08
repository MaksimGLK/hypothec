import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { syncContent } from './sync.js';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL, { max: 1 });
const result = await syncContent(db);
await close();
console.log(`Контент загружен: уроков ${result.lessons}, терминов ${result.glossary}, правил ${result.rules}`);
