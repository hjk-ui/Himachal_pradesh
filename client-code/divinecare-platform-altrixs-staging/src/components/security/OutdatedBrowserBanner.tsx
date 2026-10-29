'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { OUTDATED_BROWSER_MESSAGE, checkBrowser } from '@/lib/browser/browserSupport';

const DISMISS_KEY = 'altrixs:outdatedBrowserDismissed';

/** Dismissible notice on staff and patient pages when the browser is older than the supported baseline. Never blocks. */
export function OutdatedBrowserBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!checkBrowser(navigator.userAgent).outdated) return;
    try {
      if (window.sessionStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      // storage blocked: show it
    }
    setShow(true);
  }, []);

  if (!show) return null;
  return (
    <div
      role="status"
      className="relative z-[60] flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      <p className="min-w-0 flex-1">{OUTDATED_BROWSER_MESSAGE}</p>
      <button
        type="button"
        onClick={() => {
          setShow(false);
          try {
            window.sessionStorage.setItem(DISMISS_KEY, '1');
          } catch {
            // ignore
          }
        }}
        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-amber-800 hover:bg-amber-100"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
