import { useQuery } from '@tanstack/react-query';
import type { HouseholdDto } from './types';
import { api } from './api/client';

export function useHouseholdId(): string | undefined {
  const { data } = useQuery({ queryKey: ['households'], queryFn: () => api<HouseholdDto[]>('/households') });
  return data?.[0]?.id;
}

export function useHh<T>(path: string) {
  const hid = useHouseholdId();
  return useQuery({ queryKey: ['h', hid, path], queryFn: () => api<T>(`/households/${hid}${path}`), enabled: Boolean(hid) });
}
