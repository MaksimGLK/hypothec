import { and, desc, eq, isNull } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { emailCodes } from '../db/schema.js';
import { hashSecret, randomCode, safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

export type CodePurpose = 'verify_email' | 'reset_password' | 'delete_account';

const TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

/** Новый код; предыдущие неиспользованные коды того же назначения перестают действовать. */
export async function createEmailCode(deps: AppDeps, userId: string, purpose: CodePurpose): Promise<string> {
  const code = randomCode();
  const now = deps.now();
  await deps.db
    .update(emailCodes)
    .set({ consumedAt: now })
    .where(and(eq(emailCodes.userId, userId), eq(emailCodes.purpose, purpose), isNull(emailCodes.consumedAt)));
  await deps.db.insert(emailCodes).values({
    userId,
    purpose,
    codeHash: hashSecret(`${purpose}:${code}`, deps.config.TOKEN_PEPPER),
    expiresAt: new Date(now.getTime() + TTL_MS),
  });
  return code;
}

export async function consumeEmailCode(deps: AppDeps, userId: string, purpose: CodePurpose, code: string): Promise<void> {
  const now = deps.now();
  const [row] = await deps.db
    .select()
    .from(emailCodes)
    .where(and(eq(emailCodes.userId, userId), eq(emailCodes.purpose, purpose), isNull(emailCodes.consumedAt)))
    .orderBy(desc(emailCodes.createdAt))
    .limit(1);
  const invalid = new AppError('invalid_code', 'Код неверный или устарел. Запросите новый.');
  if (!row || row.expiresAt <= now || row.attempts >= MAX_ATTEMPTS) throw invalid;
  const ok = safeEqual(row.codeHash, hashSecret(`${purpose}:${code}`, deps.config.TOKEN_PEPPER));
  if (!ok) {
    await deps.db.update(emailCodes).set({ attempts: row.attempts + 1 }).where(eq(emailCodes.id, row.id));
    throw invalid;
  }
  await deps.db.update(emailCodes).set({ consumedAt: now }).where(eq(emailCodes.id, row.id));
}
