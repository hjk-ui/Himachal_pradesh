'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import type { PracticeIdentity } from '@/lib/practice/identity';

/** Practice name + accreditation from Practice settings; null fields when not recorded or not loaded. */
export function usePracticeIdentity(): { identity: PracticeIdentity | null; error: string | null } {
  const [identity, setIdentity] = useState<PracticeIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiJson<{ success: true; identity: PracticeIdentity }>('/api/practice-settings/identity')
      .then((res) => {
        if (!cancelled) setIdentity(res.identity);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the practice name');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { identity, error };
}
