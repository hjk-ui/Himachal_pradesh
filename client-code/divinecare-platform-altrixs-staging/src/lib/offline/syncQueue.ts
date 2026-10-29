'use client';

import { decryptJson } from './crypto';
import { offlineDb } from './db';

export async function processSyncQueue(
  fetchWithAuth: (url: string, init: RequestInit) => Promise<Response>
): Promise<{ synced: number; failed: number }> {
  if (!offlineDb || !navigator.onLine) return { synced: 0, failed: 0 };
  const items = await offlineDb.syncQueue.orderBy('createdAt').toArray();
  let synced = 0;
  let failed = 0;

  for (const item of items) {
    if ((item.attempts || 0) >= 5) {
      failed++;
      continue;
    }
    try {
      const body = await decryptJson(item.encryptedBody);
      const res = await fetchWithAuth(item.url, {
        method: item.method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok || res.status === 200 || res.status === 201) {
        if (item.id != null) {
          await offlineDb.syncQueue.delete(item.id);
        } else if (item.queueId) {
          await offlineDb.syncQueue.where('queueId').equals(item.queueId).delete();
        }
        synced++;
      } else {
        if (item.id != null) {
          await offlineDb.syncQueue.update(item.id, {
            attempts: (item.attempts || 0) + 1,
            lastError: `HTTP ${res.status}`,
          });
        }
        failed++;
      }
    } catch (err) {
      if (item.id != null) {
        await offlineDb.syncQueue.update(item.id, {
          attempts: (item.attempts || 0) + 1,
          lastError: err instanceof Error ? err.message : 'sync failed',
        });
      }
      failed++;
    }
  }
  return { synced, failed };
}
