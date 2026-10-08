import type { AuthResponse, User } from '@hypothec/api-contract';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearSession, device, refreshSession, saveSession } from './client';

interface AuthState {
  status: 'loading' | 'signed-in' | 'signed-out';
  user: User | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    void (async () => {
      if (await refreshSession()) {
        setUser(await api<User>('/me').catch(() => null));
        setStatus('signed-in');
      } else setStatus('signed-out');
    })();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      async login(email, password) {
        const res = await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password, device }, noRefresh: true });
        await saveSession(res);
        setUser(res.user);
        setStatus('signed-in');
      },
      async logout() {
        await clearSession();
        qc.clear();
        setUser(null);
        setStatus('signed-out');
      },
    }),
    [status, user, qc],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
