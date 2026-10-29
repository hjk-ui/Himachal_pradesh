'use client';

import { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { processSyncQueue } from '@/lib/offline/syncQueue';

/**
 * Offline / back-online banner for dashboard.
 * Notes, assessments, TMS forms OK offline; eligibility/eRx/CRISP/claims paused.
 */
export function OfflineBanner() {
  // Start online on both server and client. Node's navigator has no onLine,
  // so reading it during render hydrates an offline banner the browser never drew.
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    // Poll: Playwright context.setOffline can flip navigator.onLine without a window event.
    const poll = window.setInterval(update, 1000);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    if (offline) return;
    void (async () => {
      setSyncing(true);
      try {
        const result = await processSyncQueue(async (url, init) => fetch(url, init));
        if (result.synced > 0) setMsg(`Synced ${result.synced} offline item(s)`);
      } finally {
        setSyncing(false);
      }
    })();
  }, [offline]);

  if (!offline && !msg) return null;

  return (
    <div
      className={`px-4 py-2 text-sm font-semibold ${
        offline ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'
      }`}
    >
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {offline ? <WifiOff size={16} /> : <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />}
          <span>
            {offline
              ? 'You are offline — notes, assessments, and TMS/Spravato forms can be saved locally. Eligibility, eRx, CRISP, and claims are paused.'
              : msg || 'Back online'}
          </span>
        </div>
        {!offline ? (
          <button
            type="button"
            className="rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs font-bold"
            onClick={() => {
              setMsg(null);
              void processSyncQueue(async (url, init) => fetch(url, init)).then((r) =>
                setMsg(`Synced ${r.synced} · failed ${r.failed}`)
              );
            }}
          >
            Sync Now
          </button>
        ) : null}
      </div>
    </div>
  );
}
