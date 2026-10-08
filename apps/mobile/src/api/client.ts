import { API_PREFIX } from '@hypothec/api-contract';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Тот же контракт, что у веба, но refresh-токен приходит в теле ответа и хранится в защищённом хранилище
 * (Keychain на iOS, Keystore на Android). Access-токен — только в памяти.
 */
const REFRESH_KEY = 'hp_refresh';
const base = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? `http://localhost:3000${API_PREFIX}`;

export const device = { platform: Platform.OS === 'ios' ? ('ios' as const) : ('android' as const), name: `${Platform.OS} ${Platform.Version}` };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export async function saveSession(tokens: { accessToken: string; refreshToken?: string }) {
  accessToken = tokens.accessToken;
  if (tokens.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
}

export async function clearSession() {
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${base}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
      if (!res.ok) {
        await clearSession();
        return false;
      }
      await saveSession(await res.json());
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; noRefresh?: boolean } = {}): Promise<T> {
  const run = () =>
    fetch(`${base}${path}`, {
      method: opts.method ?? 'GET',
      headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  let res: Response;
  try {
    res = await run();
  } catch {
    throw new ApiError(0, 'network', 'Нет связи с сервером');
  }
  if (res.status === 401 && !opts.noRefresh && (await refreshSession())) res = await run();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ApiError(res.status, body?.code ?? 'internal_error', body?.message ?? 'Не удалось связаться с сервером');
  }
  return (res.status === 204 ? null : await res.json()) as T;
}
