'use client';

import { useEffect, useState } from 'react';

const RELOAD_KEY = 'altrixs-chunk-reload';

function isChunkError(value: unknown) {
  const text = value instanceof Error ? value.message : String(value || '');
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|dynamically imported module/i.test(text);
}

/** After a deploy, a stale tab reloads once instead of staying on a blank page. */
export function ChunkReload() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (!isChunkError(event.error || event.message)) return;
      if (sessionStorage.getItem(RELOAD_KEY) === '1') {
        setReady(true);
        return;
      }
      sessionStorage.setItem(RELOAD_KEY, '1');
      window.location.reload();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isChunkError(event.reason)) return;
      if (sessionStorage.getItem(RELOAD_KEY) === '1') {
        setReady(true);
        return;
      }
      sessionStorage.setItem(RELOAD_KEY, '1');
      window.location.reload();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    const clear = window.setTimeout(() => sessionStorage.removeItem(RELOAD_KEY), 15000);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.clearTimeout(clear);
    };
  }, []);

  if (!ready) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      A new build is ready. Refresh the page if this screen stays blank.
    </div>
  );
}
