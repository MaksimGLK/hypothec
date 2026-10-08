import type { FastifyReply, FastifyRequest } from 'fastify';
import type { IssuedTokens } from './tokens.js';
import { verifyAccessToken } from './tokens.js';
import { AppError } from '../lib/errors.js';

export const REFRESH_COOKIE = 'hp_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** onRequest-хук: проверяет Bearer-токен и кладёт пользователя в request.user. */
export async function authenticate(req: FastifyRequest): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AppError('unauthorized', 'Нужно войти в аккаунт');
  req.user = await verifyAccessToken(req.server.deps, header.slice(7));
}

/**
 * Веб получает refresh-токен в httpOnly-cookie (недоступен JavaScript), мобильные клиенты — в теле ответа.
 */
export function deliverTokens(req: FastifyRequest, reply: FastifyReply, tokens: IssuedTokens) {
  const { config } = req.server.deps;
  if (tokens.platform === 'web') {
    reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400,
    });
    return { accessToken: tokens.accessToken, accessTokenExpiresIn: tokens.accessTokenExpiresIn };
  }
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, accessTokenExpiresIn: tokens.accessTokenExpiresIn };
}

export function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}
