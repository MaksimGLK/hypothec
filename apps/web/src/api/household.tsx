import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { useToast } from '../components/ui/toast.js';
import { api, ApiError } from './client.js';
import type { HouseholdDto } from './types.js';

const STORAGE_KEY = 'hp-household';

interface HouseholdState {
  households: HouseholdDto[];
  current: HouseholdDto | null;
  hid: string;
  select(id: string): void;
}

const Ctx = createContext<HouseholdState | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { data: households = [], isLoading } = useQuery({ queryKey: ['households'], queryFn: () => api<HouseholdDto[]>('/households') });
  const [selected, setSelected] = useState<string | null>(readStored);
  const current = households.find((h) => h.id === selected) ?? households[0] ?? null;

  useEffect(() => {
    if (current && current.id !== selected) setSelected(current.id);
  }, [current, selected]);

  if (isLoading || !current) return null;
  const value: HouseholdState = {
    households,
    current,
    hid: current.id,
    select(id) {
      setSelected(id);
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        /* приватный режим — просто не запоминаем */
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHousehold(): HouseholdState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useHousehold outside HouseholdProvider');
  return ctx;
}

/** Данные семьи: GET /households/:hid/<path>. Все ключи семьи начинаются с ['h', hid]. */
export function useHh<T>(path: string, options: { enabled?: boolean } = {}) {
  const { hid } = useHousehold();
  return useQuery({
    queryKey: ['h', hid, path],
    queryFn: ({ signal }) => api<T>(`/households/${hid}${path}`, { signal }),
    enabled: options.enabled ?? true,
  });
}

/**
 * Изменение данных семьи. Любая правка может поменять весь план, поэтому после неё
 * обновляются все запросы семьи — пересчёт делает сервер, клиенту нужно только перечитать.
 */
export function useHhMutation<TBody = unknown, TResult = unknown>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string | ((body: TBody) => string),
  opts: { success?: string; silent?: boolean } = {},
) {
  const { hid } = useHousehold();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TResult, ApiError, TBody>({
    mutationFn: (body) => {
      const p = typeof path === 'function' ? path(body) : path;
      const payload = method === 'DELETE' ? undefined : (body as { __path?: string } | undefined);
      return api<TResult>(`/households/${hid}${p}`, { method, ...(payload !== undefined ? { body: stripMeta(payload) } : {}) });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['h', hid] });
      if (opts.success) toast.show(opts.success);
    },
    onError: async (err) => {
      if (opts.silent) return;
      toast.show(err.message, 'error');
      if (err.code === 'conflict') await qc.invalidateQueries({ queryKey: ['h', hid] });
    },
  });
}

/** Поля, начинающиеся с «_», служат только для построения пути и в тело не идут. */
function stripMeta(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  return Object.fromEntries(Object.entries(body).filter(([k]) => !k.startsWith('_')));
}
