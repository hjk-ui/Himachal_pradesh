'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FileSignature } from 'lucide-react';

/**
 * Non-blocking notice for Admin / Practice Director when the organization has not accepted the
 * current BAA (organizations created before click-through acceptance, or after a new version).
 * Rendered by the dashboard layout only for those roles; /api/admin/baa?status=1 re-checks.
 */
export function BaaNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/baa?status=1', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) return;
        const d = (await r.json().catch(() => null)) as { success?: boolean; needsAcceptance?: boolean } | null;
        if (!cancelled && d?.success && d.needsAcceptance) setShow(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (!show) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 print:hidden">
      <FileSignature className="h-4 w-4 shrink-0" aria-hidden />
      <span>Please review and accept the Altrixs Business Associate Agreement for your organization.</span>
      <Link href="/dashboard/admin/baa" className="font-bold underline">
        Review the BAA
      </Link>
    </div>
  );
}
