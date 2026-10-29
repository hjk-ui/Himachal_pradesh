'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { reloadOnceForChunkError } from '@/lib/client/chunkReload';

/** Build this bundle was compiled from (stamped by next.config.js) */
const LOADED_BUILD = process.env.NEXT_PUBLIC_ALTRIXS_BUILT_AT || '';
const CHECK_EVERY_MS = 5 * 60_000;

/**
 * Moving between pages in Altrixs never reloads the browser, so a tab opened before a deploy keeps running the old
 * build and eventually asks for files the server no longer has. This checks /api/version now and then and, once a
 * newer build is live, loads the next page the user opens in full so the tab picks up the new build.
 */
export function BuildUpdateWatcher() {
  const pathname = usePathname();
  const stale = useRef(false);
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (!LOADED_BUILD) return;
    let cancelled = false;
    const check = async () => {
      if (stale.current || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const live = (await res.json()) as { builtAt?: string };
        if (!cancelled && live.builtAt && live.builtAt !== LOADED_BUILD) stale.current = true;
      } catch {
        // Offline or server restarting: try again on the next tick
      }
    };
    void check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    window.addEventListener('focus', check);
    // A lazy-loaded part of the page can fail outside an error boundary
    const onRejection = (e: PromiseRejectionEvent) => {
      reloadOnceForChunkError(e.reason);
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  useEffect(() => {
    if (pathname === lastPath.current) return;
    lastPath.current = pathname;
    // The URL already shows the new page: a full load opens it on the new build
    if (stale.current) window.location.reload();
  }, [pathname]);

  return null;
}
