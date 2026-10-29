'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export const AUDIT_LOG_PATH = '/dashboard/admin/audit-log';

/** Org audit-event count for the Admin & Compliance stat card, loaded on page open. */
export function useAuditEventTotal(): number | string | null {
  const [total, setTotal] = useState<number | string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/audit-log/summary?countOnly=1', { cache: 'no-store' })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as { success?: boolean; total?: number } | null;
        if (cancelled) return;
        if (r.status === 403) setTotal('Leadership only');
        else if (r.ok && d?.success && typeof d.total === 'number') setTotal(d.total);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return total;
}

/** The Admin page's "HIPAA Audit Log" tab now opens the dedicated audit-log page. */
export function AuditLogTabRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(AUDIT_LOG_PATH);
  }, [router]);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-xs">
      Opening the HIPAA audit log…{' '}
      <Link href={AUDIT_LOG_PATH} className="rounded font-semibold text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
        Go to HIPAA audit log
      </Link>
    </div>
  );
}
