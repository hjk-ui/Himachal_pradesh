'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, RotateCcw } from 'lucide-react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Dashboard error:', error);
  }, [error]);

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
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#6868D0] px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-[#5555b8] transition shadow-xs"
        >
          <ArrowLeft size={15} />
          Back to Clients
        </Link>
      </div>
    </div>
  );
}
