'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MarketingKind } from '@/lib/marketing/store';

export function useMarketingItems(kind: MarketingKind | null) {
  const [items, setItems] = useState<Array<Record<string, unknown> & { id: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!kind) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/marketing/items?kind=${kind}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to load');
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async (data: Record<string, unknown>) => {
    if (!kind) return null;
    const res = await fetch('/api/marketing/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, data }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Create failed');
    await reload();
    return json.item;
  };

  const patch = async (
    id: string,
    next: Record<string, unknown>,
    transition?: 'submit' | 'approve' | 'send_back' | 'send'
  ) => {
    if (!kind) return null;
    const res = await fetch('/api/marketing/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, id, patch: next, transition }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Update failed');
    await reload();
    return json.item;
  };

  return { items, loading, error, reload, create, patch };
}
