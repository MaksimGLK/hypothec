import { API_PREFIX } from '@hypothec/api-contract';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { path?: string; message: string }[],
  ) {
    super(message);
  }

  /** Ошибка конкретного поля формы. */
  field(path: string): string | undefined {
    return this.details?.find((d) => d.path === path)?.message;
  }
}

/**
 * Access-токен живёт только в памяти вкладки. Refresh-токен — в httpOnly-cookie,
 * поэтому JavaScript его не видит, а после перезагрузки страницы сессия восстанавливается запросом /auth/refresh.
 */
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

export function setAccessToken(token: string | null) {
  accessToken = token;
  listeners.forEach((l) => l(token !== null));
}

export function onAuthChange(listener: (signedIn: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function parse(res: Response): Promise<unknown> {
  if (res.status === 204 || res.status === 304) return null;
  const type = res.headers.get('content-type') ?? '';
  return type.includes('application/json') ? res.json() : res.text();
}

async function toError(res: Response): Promise<ApiError> {
  const body = (await parse(res).catch(() => null)) as { code?: string; message?: string; details?: ApiError['details'] } | null;
  return new ApiError(res.status, body?.code ?? 'internal_error', body?.message ?? 'Не удалось связаться с сервером', body?.details);
}

/** Обновить access-токен по cookie. Параллельные запросы ждут одно обновление. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_PREFIX}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (!res.ok) {
      setAccessToken(null);
      return false;
    }
    const body = (await res.json()) as { accessToken: string };
    setAccessToken(body.accessToken);
    return true;
  } catch {
    return false;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Не пытаться обновить токен при 401 (для самих запросов авторизации). */
  noRefresh?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const doFetch = () =>
    fetch(`${API_PREFIX}${path}`, {
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  let res: Response;
  try {
    res = await doFetch();
  } catch {
    throw new ApiError(0, 'network', 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  if (res.status === 401 && !opts.noRefresh) {
    if (await refreshSession()) res = await doFetch();
  }
  if (!res.ok) throw await toError(res);
  return (await parse(res)) as T;
}

/** Скачать ответ как файл (экспорт данных, календарь .ics). */
export async function download(path: string, filename: string) {
  const run = () => fetch(`${API_PREFIX}${path}`, { credentials: 'include', headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {} });
  let res = await run();
  if (res.status === 401 && (await refreshSession())) res = await run();
  if (!res.ok) throw await toError(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
