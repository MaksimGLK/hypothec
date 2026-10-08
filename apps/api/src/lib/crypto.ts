import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Случайный токен для refresh-сессий и приглашений (256 бит). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 6-значный код для писем. */
export function randomCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Храним только HMAC от токенов и кодов — утечка базы не даёт ими воспользоваться. */
export function hashSecret(value: string, pepper: string): string {
  return createHmac('sha256', pepper).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
