'use client';

import { useState } from 'react';
import { BarChart3, Mail } from 'lucide-react';

/**
 * DrFirst NCDM3: open Rcopia's Message (renewals, change requests, pending prescriptions) and Report
 * screens. /api/drfirst/sso launches these in Limited Multi Patient Mode (limp_mode=y), which they
 * need under Single Patient Mode. Opens a normal browser tab (never an iframe: GM11).
 */
export function RcopiaQuickLaunch() {
  const [busy, setBusy] = useState<'message' | 'report' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (screen: 'message' | 'report') => {
    setError(null);
    // Open the tab synchronously on click so the pop-up blocker allows it
    const win = window.open('about:blank', '_blank');
    setBusy(screen);
    try {
      const res = await fetch(`/api/drfirst/sso?screen=${screen}`);
      const data = (await res.json().catch(() => ({}))) as { url?: string; demo?: boolean; error?: string; message?: string };
      if (!res.ok || !data.url || data.demo) {
        win?.close();
        setError(data.error || data.message || 'DrFirst could not be opened.');
        return;
      }
      if (win) win.location.href = data.url;
      else window.open(data.url, '_blank');
    } catch {
      win?.close();
      setError('Could not reach DrFirst. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => open('message')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-white px-3 py-2 text-xs font-bold text-[#5C2D91] hover:bg-purple-50 disabled:opacity-60"
        >
          <Mail size={14} aria-hidden /> {busy === 'message' ? 'Opening…' : 'DrFirst messages'}
        </button>
        <button
          type="button"
          onClick={() => open('report')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-white px-3 py-2 text-xs font-bold text-[#5C2D91] hover:bg-purple-50 disabled:opacity-60"
        >
          <BarChart3 size={14} aria-hidden /> {busy === 'report' ? 'Opening…' : 'DrFirst reports'}
        </button>
      </div>
      {error ? <p role="alert" className="text-[11px] font-semibold text-rose-700">{error}</p> : null}
    </div>
  );
}
