'use client';

import { useEffect } from 'react';
import { isChunkLoadError, reloadOnceForChunkError } from '@/lib/client/chunkReload';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, RotateCcw } from 'lucide-react';

export default function DashboardError({
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
    console.error('Dashboard error:', error);
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
    <div className="mx-auto my-8 max-w-lg rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 text-center shadow-sm space-y-5">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
        <AlertCircle size={28} />
      </div>

      <div className="space-y-1.5">
        <h2 className="text-lg font-bold text-slate-900">Unable to load this section</h2>
        <p className="text-xs sm:text-sm text-slate-500">
          We encountered an issue loading this record or dashboard view. Your session is active and safe.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
        >
          <RotateCcw size={15} />
          Try Again
        </button>
        <Link
          href="/dashboard/clients"
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#5C2D91] px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-[#4a2475] transition shadow-xs"
        >
          <ArrowLeft size={15} />
          Back to Clients
        </Link>
      </div>
    </div>
  );
}
