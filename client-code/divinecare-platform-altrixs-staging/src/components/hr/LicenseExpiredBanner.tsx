'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert } from '@/components/ui';

type Flag = { userId: string; name: string; title: string; expiredOn: string };

/**
 * Warning for HR / leadership / Office Manager / Billing on scheduling and billing screens:
 * clinicians whose license has expired. Other roles get an empty list from the API, so the
 * banner renders nothing for them. Scheduling is blocked only when the practice setting is on.
 */
export function LicenseExpiredBanner({ clinicianIds }: { clinicianIds?: string[] }) {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [block, setBlock] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/hr/license-alerts', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.success) {
          setFlags(d.flags ?? []);
          setBlock(Boolean(d.blockScheduling));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const shown = clinicianIds ? flags.filter((f) => clinicianIds.includes(f.userId)) : flags;
  if (!shown.length) return null;
  return (
    <Alert tone="warning" title={`Expired license: ${shown.map((f) => f.name).join(', ')}`}>
      {shown.map((f) => `${f.title} expired ${f.expiredOn}`).join('; ')}.{' '}
      {block ? 'Practice setting: new appointments for these clinicians are blocked until HR records the renewal.' : 'Scheduling is not blocked; confirm the renewal before billing.'}{' '}
      <Link href="/dashboard/hr/credentialing" className="font-medium underline">Open credentialing</Link>
    </Alert>
  );
}
