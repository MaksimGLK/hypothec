import { describe, expect, it } from 'vitest';
import { CONSENT, client, lastCode, register, setupApp, uniqueEmail } from './helpers.js';

const ctx = setupApp();
const PASSWORD = 'ипотека без паники';

describe('регистрация', () => {
  it('создаёт аккаунт, семью со счетами и отправляет код подтверждения', async () => {
    const email = uniqueEmail();
    const res = await client(ctx)('POST', '/auth/register', { email: email.toUpperCase(), password: PASSWORD, name: 'Мария', consents: CONSENT, device: { platform: 'android' } });
    expect(res.statusCode).toBe(201);
    expect(res.data.user).toMatchObject({ email, name: 'Мария', emailVerified: false });
    expect(res.data.refreshToken).toBeTruthy();
    expect(ctx.mailer.last(email)!.subject).toMatch(/Код подтверждения/);

    const api = client(ctx, res.data.accessToken);
    const hh = await api('GET', '/households');
    expect(hh.data).toHaveLength(1);
    expect(hh.data[0].role).toBe('owner');
    const accounts = await api('GET', `/households/${hh.data[0].id}/accounts`);
    expect(accounts.data.map((a: { kind: string }) => a.kind)).toEqual(['mortgage', 'cushion', 'setup', 'prepayment', 'life', 'annual_reserve', 'deal']);
  });

  it('подтверждение почты кодом; неверный код и лимит попыток', async () => {
    const s = await register(ctx, { verify: false });
    const api = client(ctx, s.token);
    const code = lastCode(ctx, s.email);
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await api('POST', '/auth/verify-email', { code: wrong })).data.code).toBe('invalid_code');
    for (let i = 0; i < 4; i++) await api('POST', '/auth/verify-email', { code: wrong });
    // после 5 ошибок даже верный код не принимается
    expect((await api('POST', '/auth/verify-email', { code })).statusCode).toBe(400);
    await api('POST', '/auth/verify-email/resend');
    const ok = await api('POST', '/auth/verify-email', { code: lastCode(ctx, s.email) });
    expect(ok.data.emailVerified).toBe(true);
  });

  it('без согласия на обработку ПДн — нельзя', async () => {
    const res = await client(ctx)('POST', '/auth/register', { email: uniqueEmail(), password: PASSWORD, name: 'А', consents: [], device: { platform: 'web' } });
    expect(res.statusCode).toBe(400);
    const old = await client(ctx)('POST', '/auth/register', {
      email: uniqueEmail(),
      password: PASSWORD,
      name: 'А',
      consents: [{ type: 'personal_data', documentVersion: '2020-01', accepted: true }],
      device: { platform: 'web' },
    });
    expect(old.data.code).toBe('consent_required');
  });

  it('слабый пароль и пароль с адресом почты отклоняются', async () => {
    const weak = await client(ctx)('POST', '/auth/register', { email: uniqueEmail(), password: 'qwerty123', name: 'А', consents: CONSENT, device: { platform: 'web' } });
    expect(weak.data.code).toBe('weak_password');
    const short = await client(ctx)('POST', '/auth/register', { email: uniqueEmail(), password: 'abc', name: 'А', consents: CONSENT, device: { platform: 'web' } });
    expect(short.data.code).toBe('validation_error');
    const email = uniqueEmail('mariya');
    const withEmail = await client(ctx)('POST', '/auth/register', { email, password: `${email.split('@')[0]}2026`, name: 'А', consents: CONSENT, device: { platform: 'web' } });
    expect(withEmail.data.code).toBe('weak_password');
  });

  it('повторная регистрация на ту же почту — 409', async () => {
    const s = await register(ctx);
    const res = await client(ctx)('POST', '/auth/register', { email: s.email, password: PASSWORD, name: 'А', consents: CONSENT, device: { platform: 'web' } });
    expect(res.statusCode).toBe(409);
    expect(res.data.code).toBe('email_taken');
  });
});

describe('вход', () => {
  it('по почте и паролю; неверный пароль и несуществующая почта — одинаковая ошибка', async () => {
    const s = await register(ctx);
    const ok = await client(ctx)('POST', '/auth/login', { email: s.email, password: PASSWORD, device: { platform: 'ios' } });
    expect(ok.statusCode).toBe(200);
    const bad = await client(ctx)('POST', '/auth/login', { email: s.email, password: 'не тот пароль', device: { platform: 'ios' } });
    const none = await client(ctx)('POST', '/auth/login', { email: uniqueEmail(), password: 'не тот пароль', device: { platform: 'ios' } });
    expect(bad.statusCode).toBe(401);
    expect(none.data).toEqual(bad.data);
  });

  it('после 10 неудачных попыток вход блокируется на 15 минут', async () => {
    const s = await register(ctx);
    for (let i = 0; i < 10; i++) await client(ctx)('POST', '/auth/login', { email: s.email, password: 'неверный пароль', device: { platform: 'web' } });
    const locked = await client(ctx)('POST', '/auth/login', { email: s.email, password: PASSWORD, device: { platform: 'web' } });
    expect(locked.data.code).toBe('rate_limited');
    ctx.clock.advance(16 * 60_000);
    const ok = await client(ctx)('POST', '/auth/login', { email: s.email, password: PASSWORD, device: { platform: 'web' } });
    expect(ok.statusCode).toBe(200);
  });

  it('access-токен истекает через 15 минут', async () => {
    const s = await register(ctx);
    expect((await client(ctx, s.token)('GET', '/me')).statusCode).toBe(200);
    ctx.clock.advance(16 * 60_000);
    const res = await client(ctx, s.token)('GET', '/me');
    expect(res.statusCode).toBe(401);
    expect(res.data.code).toBe('unauthorized');
  });

  it('без токена и с поддельным токеном — 401', async () => {
    expect((await client(ctx)('GET', '/me')).statusCode).toBe(401);
    expect((await client(ctx, 'eyJhbGciOiJIUzI1NiJ9.e30.xxx')('GET', '/me')).statusCode).toBe(401);
  });
});

describe('обновление токенов', () => {
  it('ротация: старый refresh-токен перестаёт работать, повтор — отзывает всю цепочку', async () => {
    const s = await register(ctx);
    const r1 = await client(ctx)('POST', '/auth/refresh', { refreshToken: s.refreshToken });
    expect(r1.statusCode).toBe(200);
    expect(r1.data.refreshToken).not.toBe(s.refreshToken);
    ctx.clock.advance(60_000);
    // кто-то повторно использует украденный старый токен
    const reuse = await client(ctx)('POST', '/auth/refresh', { refreshToken: s.refreshToken });
    expect(reuse.statusCode).toBe(401);
    // вся цепочка отозвана — новый токен тоже не работает
    const r2 = await client(ctx)('POST', '/auth/refresh', { refreshToken: r1.data.refreshToken });
    expect(r2.statusCode).toBe(401);
  });

  it('два почти одновременных обновления (две вкладки) не разлогинивают', async () => {
    const s = await register(ctx);
    const a = await client(ctx)('POST', '/auth/refresh', { refreshToken: s.refreshToken });
    const b = await client(ctx)('POST', '/auth/refresh', { refreshToken: s.refreshToken });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
  });

  it('веб получает refresh-токен в httpOnly-cookie, а не в теле', async () => {
    const email = uniqueEmail();
    const res = await client(ctx)('POST', '/auth/register', { email, password: PASSWORD, name: 'Веб', consents: CONSENT, device: { platform: 'web' } });
    expect(res.data.refreshToken).toBeUndefined();
    const cookie = res.cookies.find((c) => c.name === 'hp_refresh')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1/auth' });
    const refreshed = await client(ctx)('POST', '/auth/refresh', undefined, { cookie: `hp_refresh=${cookie.value}` });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.data.user.email).toBe(email);
    const logout = await client(ctx)('POST', '/auth/logout', undefined, { cookie: `hp_refresh=${refreshed.cookies[0]!.value}` });
    expect(logout.statusCode).toBe(204);
  });

  it('выход отзывает refresh-токен', async () => {
    const s = await register(ctx);
    await client(ctx)('POST', '/auth/logout', { refreshToken: s.refreshToken });
    expect((await client(ctx)('POST', '/auth/refresh', { refreshToken: s.refreshToken })).statusCode).toBe(401);
  });
});

describe('пароль', () => {
  it('восстановление: код на почту, новый пароль, все сессии отозваны', async () => {
    const s = await register(ctx);
    const forgot = await client(ctx)('POST', '/auth/password/forgot', { email: s.email });
    expect(forgot.statusCode).toBe(204);
    // для несуществующей почты — тот же ответ
    expect((await client(ctx)('POST', '/auth/password/forgot', { email: uniqueEmail() })).statusCode).toBe(204);
    const code = lastCode(ctx, s.email);
    const reset = await client(ctx)('POST', '/auth/password/reset', { email: s.email, code, newPassword: 'новый длинный пароль' });
    expect(reset.statusCode).toBe(204);
    expect((await client(ctx)('POST', '/auth/refresh', { refreshToken: s.refreshToken })).statusCode).toBe(401);
    expect((await client(ctx)('POST', '/auth/login', { email: s.email, password: PASSWORD, device: { platform: 'web' } })).statusCode).toBe(401);
    expect((await client(ctx)('POST', '/auth/login', { email: s.email, password: 'новый длинный пароль', device: { platform: 'web' } })).statusCode).toBe(200);
    // код одноразовый
    expect((await client(ctx)('POST', '/auth/password/reset', { email: s.email, code, newPassword: 'ещё один пароль 2' })).statusCode).toBe(400);
  });

  it('смена пароля: текущее устройство остаётся, остальные выходят', async () => {
    const s = await register(ctx);
    const other = await client(ctx)('POST', '/auth/login', { email: s.email, password: PASSWORD, device: { platform: 'android', name: 'Телефон' } });
    const api = client(ctx, s.token);
    expect((await api('POST', '/auth/password/change', { currentPassword: 'неверный', newPassword: 'новый пароль 2026' })).statusCode).toBe(401);
    expect((await api('POST', '/auth/password/change', { currentPassword: PASSWORD, newPassword: 'новый пароль 2026' })).statusCode).toBe(204);
    expect((await client(ctx)('POST', '/auth/refresh', { refreshToken: other.data.refreshToken })).statusCode).toBe(401);
    expect((await client(ctx)('POST', '/auth/refresh', { refreshToken: s.refreshToken })).statusCode).toBe(200);
  });

  it('список устройств и выход на одном из них', async () => {
    const s = await register(ctx);
    const other = await client(ctx)('POST', '/auth/login', { email: s.email, password: PASSWORD, device: { platform: 'android', name: 'Телефон Марии' } });
    const api = client(ctx, s.token);
    const list = await api('GET', '/auth/sessions');
    expect(list.data).toHaveLength(2);
    expect(list.data.filter((x: { current: boolean }) => x.current)).toHaveLength(1);
    const phone = list.data.find((x: { deviceName: string }) => x.deviceName === 'Телефон Марии');
    expect((await api('DELETE', `/auth/sessions/${phone.id}`)).statusCode).toBe(204);
    expect((await client(ctx)('POST', '/auth/refresh', { refreshToken: other.data.refreshToken })).statusCode).toBe(401);
  });
});
