'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

type Enrollment = {
  id: string;
  clientName: string;
  track: string;
  days: string[];
  status: string;
  part2?: boolean;
};

export default function IntensiveEpisodePage() {
  const params = useParams<{ enrollmentId: string }>();
  const [row, setRow] = useState<Enrollment | null>(null);

  useEffect(() => {
    fetch('/api/programs/intensive', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) return;
        const found = (data.enrollments || []).find(
          (e: Enrollment) => e.id === params.enrollmentId
        );
        setRow(found || null);
      })
      .catch(() => undefined);
  }, [params.enrollmentId]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/dashboard/programs/intensive" className="text-sm font-semibold text-indigo-700">
        ← Intensive hub
      </Link>
      {!row ? (
        <p className="text-sm text-slate-500">Enrollment not found on your caseload.</p>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h1 className="text-xl font-bold text-slate-900">{row.clientName}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {row.track} · {row.status}
            {row.part2 ? ' · Part 2' : ''}
          </p>
          <p className="mt-2 text-sm text-slate-700">Schedule days: {row.days.join(', ')}</p>
          <p className="mt-4 text-xs text-slate-500">
            Attendance and charge drafts stay on the billing subpage. No claim submit from this
            module.
          </p>
        </section>
      )}
    </div>
  );
}
