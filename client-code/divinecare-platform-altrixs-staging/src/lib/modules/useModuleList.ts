'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { SaveQueue, type SaveState } from './saveQueue';
import { publishPersistence } from './persistenceStatus';

type ListMeta = SaveState & { loading: boolean; retry: () => void; reload: () => void };

/** Database-only data, serialized saves, visible failures, and retryable local drafts. */
export function useModuleList<T>(
  module: string,
  _seed: T[] = [],
): [T[], (next: T[] | ((prev: T[]) => T[])) => void, ListMeta] {
  const [items, setItemsState] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>({ pending: false, error: null });
  const [reloadKey, setReloadKey] = useState(0);
  const current = useRef<T[]>([]);
  const loaded = useRef(false);
  const queue = useRef<SaveQueue<T[]> | null>(null);
  const noticeId = useRef('');
  const reload = useCallback(() => {
    if (queue.current?.hasUnsavedChanges()) return;
    setReloadKey((key) => key + 1);
  }, []);
  const retry = useCallback(() => { if (loaded.current) queue.current?.retry(); else reload(); }, [reload]);

  useEffect(() => {
    let cancelled = false;
    if (noticeId.current) publishPersistence({ id: noticeId.current, module, pending: false, error: null });
    const id = module + ':' + crypto.randomUUID();
    noticeId.current = id;
    let version: string | undefined;
    loaded.current = false;
    setLoading(true);
    const changed = (state: SaveState) => {
      if (!cancelled) setSaveState(state);
      publishPersistence({ id, module, ...state, retry: () => writer.retry() });
    };
    const writer = new SaveQueue<T[]>(async (value) => {
      const response = await apiJson<{ success: true; version?: string }>(`/api/modules/${module}`, {
        method: 'PUT',
        body: JSON.stringify({ data: value, version }),
      });
      version = response.version;
    }, changed);
    queue.current = writer;
    apiJson<{ success: true; data: T[] | null; version?: string }>(`/api/modules/${module}`)
      .then((response) => {
        if (cancelled) return;
        current.current = Array.isArray(response.data) ? response.data : [];
        version = response.version;
        setItemsState(current.current);
        loaded.current = true;
        setSaveState({ pending: false, error: null });
        publishPersistence({ id, module, pending: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Could not load records';
        setSaveState({ pending: false, error: message });
        publishPersistence({ id, module, pending: false, error: message, retry: reload });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [module, reloadKey, reload]);

  const setItems = useCallback((next: T[] | ((prev: T[]) => T[])) => {
    if (!loaded.current || !queue.current) {
      const error = 'Records have not loaded. Reload before editing';
      setSaveState({ pending: false, error });
      publishPersistence({ id: noticeId.current, module, pending: false, error, retry: reload });
      return;
    }
    const value = typeof next === 'function' ? next(current.current) : next;
    current.current = value;
    setItemsState(value);
    queue.current.enqueue(value);
  }, [module, reload]);

  return [items, setItems, { loading, ...saveState, retry, reload }];
}
