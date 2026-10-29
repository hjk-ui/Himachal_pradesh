'use client';

import { useEffect } from 'react';
import { isChunkLoadError, reloadOnceForChunkError } from '@/lib/client/chunkReload';
import Link from 'next/link';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A tab left open across a deploy asks for the old build's chunks: reload once to get the new build
  const updating = isChunkLoadError(error);
  useEffect(() => {
    if (reloadOnceForChunkError(error)) return;
    console.error('Unhandled application error:', error);
  }, [error]);

  if (updating) {
    return (
      <div className="mx-auto my-8 max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
        Altrixs was just updated. Loading the latest version…
        <div className="mt-3">
          <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-[#5C2D91] px-4 py-2 text-xs font-semibold text-white">
            Refresh now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl p-8 text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600">
          <AlertTriangle size={32} />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
          <p className="text-sm text-slate-500">
            An unexpected error occurred while loading this view. You can try refreshing or returning to your dashboard.
          </p>
          {error?.message ? (
            <div className="mt-2 rounded-xl bg-slate-100 p-2.5 text-xs text-slate-600 font-mono text-left overflow-x-auto max-h-24">
              {error.message}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition shadow-xs"
          >
            <RotateCcw size={16} />
            Try Again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#5C2D91] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#4a2475] transition shadow-xs"
          >
            <Home size={16} />
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
