'use client';

import { useModuleList } from '@/lib/modules/useModuleList';

export function useSeededModuleList<T>(module: string, _seed: T[]) {
  // Pre-live production: do not auto-seed dummy records into the database when table is empty.
  const [items, setItems, meta] = useModuleList<T>(module, []);
  return [items, setItems, meta] as const;
}

