import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setAccessToken } from './client.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('API-клиент', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setAccessToken(null);
  });

  it('при 401 один раз обновляет токен по cookie и повторяет запрос', async () => {
    setAccessToken('old');
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get('authorization');
      calls.push(`${url} ${auth ?? ''}`);
      if (url.endsWith('/auth/refresh')) return json(200, { accessToken: 'new' });
      return auth === 'Bearer new' ? json(200, { ok: true }) : json(401, { code: 'unauthorized', message: 'Сессия истекла' });
    });
    await expect(api('/me')).resolves.toEqual({ ok: true });
    expect(calls).toEqual(['/api/v1/me Bearer old', '/api/v1/auth/refresh ', '/api/v1/me Bearer new']);
  });

  it('параллельные запросы ждут одно обновление', async () => {
    setAccessToken('old');
    let refreshes = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        return json(200, { accessToken: 'new' });
      }
      return new Headers(init?.headers).get('authorization') === 'Bearer new' ? json(200, {}) : json(401, {});
    });
    await Promise.all([api('/a'), api('/b'), api('/c')]);
    expect(refreshes).toBe(1);
  });

  it('ошибка сервера превращается в ApiError с текстом и полями', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(400, { code: 'validation_error', message: 'Проверьте введённые данные', details: [{ path: 'date', message: 'Укажите дату' }] }));
    const err = (await api('/x', { method: 'POST', body: {} }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('validation_error');
    expect(err.field('date')).toBe('Укажите дату');
  });

  it('нет сети — понятное сообщение', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/x')).rejects.toMatchObject({ code: 'network', message: expect.stringMatching(/Нет связи/) });
  });
});
