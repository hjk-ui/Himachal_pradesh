'use client';

import Dexie, { type Table } from 'dexie';

export type OfflineDraftNote = {
  id?: number;
  localId: string;
  encrypted: string;
  updatedAt: string;
};

export type OfflineDraftAssessment = {
  id?: number;
  localId: string;
  encrypted: string;
  updatedAt: string;
};

export type OfflineCachedClient = {
  id: string;
  encrypted: string;
  updatedAt: string;
};

export type SyncQueueItem = {
  id?: number;
  queueId: string;
  method: string;
  url: string;
  encryptedBody: string;
  attempts: number;
  createdAt: string;
  lastError?: string;
};

class OfflineDb extends Dexie {
  draftNotes!: Table<OfflineDraftNote, number>;
  draftAssessments!: Table<OfflineDraftAssessment, number>;
  cachedClients!: Table<OfflineCachedClient, string>;
  syncQueue!: Table<SyncQueueItem, number>;

  constructor() {
    super('product-offline-v1');
    this.version(1).stores({
      draftNotes: '++id, localId, updatedAt',
      draftAssessments: '++id, localId, updatedAt',
      cachedClients: 'id, updatedAt',
      syncQueue: '++id, queueId, createdAt, attempts',
    });
  }
}

export const offlineDb = typeof window !== 'undefined' ? new OfflineDb() : (null as unknown as OfflineDb);

export async function wipeOfflineDraftsAndQueue(keepCachedClients = true) {
  if (!offlineDb) return;
  await offlineDb.draftNotes.clear();
  await offlineDb.draftAssessments.clear();
  await offlineDb.syncQueue.clear();
  if (!keepCachedClients) await offlineDb.cachedClients.clear();
}
