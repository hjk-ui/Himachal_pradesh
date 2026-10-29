'use client';

import { useCallback, useEffect, useState } from 'react';
import { encryptJson } from './crypto';
import { offlineDb } from './db';

function uuid() {
  return crypto.randomUUID();
}

/**
 * Online → POST API. Offline → encrypt payload + enqueue sync.
 */
export function useOfflineDraft(opts: {
  url: string;
  onlinePost: (body: unknown) => Promise<unknown>;
}) {
  const [isOnline, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    const poll = window.setInterval(sync, 1000);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      window.clearInterval(poll);
    };
  }, []);

  const save = useCallback(
    async (
      body: unknown,
      draftKind: 'note' | 'assessment' | 'other' = 'other',
      urlOverride?: string
    ) => {
      const url = urlOverride || opts.url;
      if (navigator.onLine) {
        return opts.onlinePost(body);
      }
      // Persist API-shaped body for sync (notes: { body }; assessments: full payload)
      const syncBody =
        draftKind === 'note' &&
        body &&
        typeof body === 'object' &&
        'body' in (body as object) &&
        'clientId' in (body as object)
          ? { body: (body as { body: string }).body }
          : body;
      const encrypted = await encryptJson(syncBody);
      const localId = uuid();
      if (draftKind === 'note') {
        await offlineDb.draftNotes.put({
          localId,
          encrypted,
          updatedAt: new Date().toISOString(),
        });
      } else if (draftKind === 'assessment') {
        await offlineDb.draftAssessments.put({
          localId,
          encrypted,
          updatedAt: new Date().toISOString(),
        });
      }
      await offlineDb.syncQueue.add({
        queueId: uuid(),
        method: 'POST',
        url,
        encryptedBody: encrypted,
        attempts: 0,
        createdAt: new Date().toISOString(),
      });
      return { offline: true, localId };
    },
    [opts]
  );

  return { save, isOnline };
}
