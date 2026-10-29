'use client';

import { useCallback, useEffect, useState } from 'react';
import { DRFIRST_SYNCED_EVENT, type DrFirstSyncedDetail } from '@/lib/drfirst/openRcopiaClient';

/** Sections a DrFirst download can change (problems, allergies): reloaded on 'altrixs:drfirst-synced'. */
const DRFIRST_SECTIONS = new Set(['diagnoses', 'medical-history']);

/** GET /api/clients/[id]/chart?section=… — one chart tab's per-client data */
export function useChartSection<T>(clientId: string, section: string, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!clientId || !enabled || !DRFIRST_SECTIONS.has(section)) return;
    const onSynced = (e: Event) => {
      if ((e as CustomEvent<DrFirstSyncedDetail>).detail?.clientId === clientId) reload();
    };
    window.addEventListener(DRFIRST_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(DRFIRST_SYNCED_EVENT, onSynced);
  }, [clientId, section, enabled, reload]);

  useEffect(() => {
    if (!clientId || !enabled) return;
    let live = true;
    setLoading(true);
    setError(null);
    fetch(`/api/clients/${encodeURIComponent(clientId)}/chart?section=${encodeURIComponent(section)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok || !body.success) {
          setData(null);
          setError(body.error === 'SENSITIVE_RECORD' ? 'Protected record: access not granted.' : body.error || `Could not load (${res.status})`);
          return;
        }
        setData(body as T);
      })
      .catch(() => live && setError('Could not load this section'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [clientId, section, enabled, nonce]);

  return { data, error, loading, reload };
}
