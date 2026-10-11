import type { User } from '@hypothec/api-contract';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, setAccessToken } from './client.js';

export const CONSENT_VERSION = '2026-10';

interface AuthState {
  status: 'loading' | 'signed-in' | 'signed-out';
  user: User | null;
  login(email: string, password: string): Promise<void>;
  register(input: { email: string; password: string; name: string; marketing?: boolean }): Promise<void>;
  logout(): Promise<void>;
  reloadUser(): Promise<void>;
  /** Простой режим — главное без лишних настроек, продвинутый — все разделы. Хранится на сервере, общий для всех устройств. */
  uiMode: 'simple' | 'advanced';
  setUiMode(mode: 'simple' | 'advanced'): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const device = { platform: 'web' as const, name: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 90) : 'web' };

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<User | null>(null);

  const accept = useCallback((res: { accessToken: string; user: User }) => {
    setAccessToken(res.accessToken);
    setUser(res.user);
    setStatus('signed-in');
  }, []);

  // при открытии страницы пробуем восстановить сессию по cookie
  useEffect(() => {
    (async () => {
      if (await refreshSession()) {
        const me = await api<User>('/me').catch(() => null);
        if (me) {
          setUser(me);
          setStatus('signed-in');
          return;
        }
      }
      setStatus('signed-out');
    })();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      async login(email, password) {
        accept(await api('/auth/login', { method: 'POST', body: { email, password, device }, noRefresh: true }));
      },
      async register({ email, password, name, marketing }) {
        const consents = [{ type: 'personal_data', documentVersion: CONSENT_VERSION, accepted: true }];
        if (marketing) consents.push({ type: 'marketing', documentVersion: CONSENT_VERSION, accepted: true });
        accept(await api('/auth/register', { method: 'POST', body: { email, password, name, consents, device }, noRefresh: true }));
      },
      async logout() {
        await api('/auth/logout', { method: 'POST', noRefresh: true }).catch(() => {});
        setAccessToken(null);
        setUser(null);
        setStatus('signed-out');
        qc.clear();
      },
      async reloadUser() {
        setUser(await api<User>('/me'));
      },
      uiMode: user?.uiMode ?? 'simple',
      async setUiMode(mode) {
        setUser(await api<User>('/me', { method: 'PATCH', body: { uiMode: mode } }));
      },
    }),
    [status, user, accept, qc],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
