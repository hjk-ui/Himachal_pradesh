'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { initOfflineEncryption, wipeOfflineEncryption } from '@/lib/offline/crypto';
import { wipeOfflineDraftsAndQueue } from '@/lib/offline/db';

/** Initializes AES key from session user id after login; wipes on session end. */
export function OfflineCryptoProvider({ children }: { children: React.ReactNode }) {
  const { data, status } = useSession();

  useEffect(() => {
    if (status === 'authenticated' && data?.user?.id) {
      void initOfflineEncryption(`${data.user.id}:${data.user.organizationId || 'org'}`);
    }
    if (status === 'unauthenticated') {
      wipeOfflineEncryption();
      void wipeOfflineDraftsAndQueue(true);
    }
  }, [status, data?.user?.id, data?.user?.organizationId]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') return;
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  return <>{children}</>;
}
