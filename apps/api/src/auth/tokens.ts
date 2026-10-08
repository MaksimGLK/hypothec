import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import type { AppDeps, AuthUser } from '../deps.js';
import { refreshSessions } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { hashSecret, randomToken } from '../lib/crypto.js';

const ISSUER = 'hypothec';
/** Если два запроса обновления пришли почти одновременно (две вкладки), второй не считаем кражей токена. */
const ROTATION_GRACE_MS = 20_000;

export type Platform = 'web' | 'ios' | 'android';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  sessionId: string;
  platform: Platform;
}

function secretKey(deps: AppDeps) {
  return new TextEncoder().encode(deps.config.JWT_SECRET);
}

export async function signAccessToken(deps: AppDeps, userId: string, sessionId: string): Promise<string> {
  const now = Math.floor(deps.now().getTime() / 1000);
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + deps.config.ACCESS_TOKEN_TTL_SEC)
    .sign(secretKey(deps));
}

export async function verifyAccessToken(deps: AppDeps, token: string): Promise<AuthUser> {
  try {
    const { payload } = await jwtVerify(token, secretKey(deps), {
      issuer: ISSUER,
      algorithms: ['HS256'],
      currentDate: deps.now(),
    });
    if (!payload.sub || typeof payload.sid !== 'string') throw new Error('bad claims');
    return { id: payload.sub, sessionId: payload.sid };
  } catch {
    throw new AppError('unauthorized', 'Сессия истекла, войдите снова');
  }
}

async function createSession(
  deps: AppDeps,
  userId: string,
  platform: Platform,
  deviceName: string | null,
  familyId: string,
): Promise<{ id: string; token: string }> {
  const token = randomToken();
  const expiresAt = new Date(deps.now().getTime() + deps.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  const [row] = await deps.db
    .insert(refreshSessions)
    .values({ userId, familyId, tokenHash: hashSecret(token, deps.config.TOKEN_PEPPER), platform, deviceName, expiresAt })
    .returning({ id: refreshSessions.id });
  return { id: row!.id, token };
}

export async function issueTokens(deps: AppDeps, userId: string, platform: Platform, deviceName: string | null): Promise<IssuedTokens> {
  const session = await createSession(deps, userId, platform, deviceName, randomUUID());
  return {
    accessToken: await signAccessToken(deps, userId, session.id),
    refreshToken: session.token,
    accessTokenExpiresIn: deps.config.ACCESS_TOKEN_TTL_SEC,
    sessionId: session.id,
    platform,
  };
}

/** Обмен refresh-токена на новую пару. Старый токен перестаёт действовать; его повторное использование отзывает всю цепочку. */
export async function rotateRefreshToken(deps: AppDeps, token: string): Promise<IssuedTokens & { userId: string }> {
  const { db } = deps;
  const now = deps.now();
  const [session] = await db
    .select()
    .from(refreshSessions)
    .where(eq(refreshSessions.tokenHash, hashSecret(token, deps.config.TOKEN_PEPPER)))
    .limit(1);
  const invalid = new AppError('unauthorized', 'Сессия истекла, войдите снова');
  if (!session) throw invalid;
  if (session.revokedAt) {
    const rotatedRecently = session.replacedById && now.getTime() - session.revokedAt.getTime() < ROTATION_GRACE_MS;
    if (!rotatedRecently) {
      await db.update(refreshSessions).set({ revokedAt: now }).where(and(eq(refreshSessions.familyId, session.familyId), isNull(refreshSessions.revokedAt)));
      throw invalid;
    }
  }
  if (session.expiresAt <= now) throw invalid;

  const next = await createSession(deps, session.userId, session.platform as Platform, session.deviceName, session.familyId);
  if (!session.revokedAt) {
    await db.update(refreshSessions).set({ revokedAt: now, replacedById: next.id, lastUsedAt: now }).where(eq(refreshSessions.id, session.id));
  }
  return {
    userId: session.userId,
    accessToken: await signAccessToken(deps, session.userId, next.id),
    refreshToken: next.token,
    accessTokenExpiresIn: deps.config.ACCESS_TOKEN_TTL_SEC,
    sessionId: next.id,
    platform: session.platform as Platform,
  };
}

export async function revokeRefreshToken(deps: AppDeps, token: string): Promise<void> {
  await deps.db
    .update(refreshSessions)
    .set({ revokedAt: deps.now() })
    .where(and(eq(refreshSessions.tokenHash, hashSecret(token, deps.config.TOKEN_PEPPER)), isNull(refreshSessions.revokedAt)));
}

export async function revokeAllSessions(deps: AppDeps, userId: string): Promise<void> {
  await deps.db.update(refreshSessions).set({ revokedAt: deps.now() }).where(and(eq(refreshSessions.userId, userId), isNull(refreshSessions.revokedAt)));
}
