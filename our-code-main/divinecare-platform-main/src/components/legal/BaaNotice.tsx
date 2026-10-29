'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BAA_VERSION } from '@/lib/legal/baa';

export function BaaNotice() {
  const [needed, setNeeded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/admin/baa', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.success && !data.currentAccepted) setNeeded(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!needed) return null;

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      <p>
        Please review and accept the Business Associate Agreement (version {BAA_VERSION}).
      </p>
      <Link
        href="/dashboard/admin/baa"
        className="rounded-lg bg-[#5C2D91] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#141C34]"
      >
        Review the BAA
      </Link>
    </div>
  );
}
