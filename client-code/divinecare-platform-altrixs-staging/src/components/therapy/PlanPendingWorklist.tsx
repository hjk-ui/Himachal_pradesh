'use client';

/**
 * Treatment Plans › Before go-live: clients with a therapy progress note signed under the go-live
 * transition ("Treatment plan pending") who still have no active plan
 * (GET /api/ehr/therapy-workflow?pending=1, same client access as the chart).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';

type PendingClient = {
  clientId: string;
  clientName: string;
  noteCount: number;
  lastSignedAt: string | null;
  until: string;
  authorNames: string[];
};

type Response = {
  success: true;
  settings: { transitionUntilEffective: string | null; transitionActive: boolean };
  pending: PendingClient[];
  pendingError: string | null;
};

export function PlanPendingWorklist() {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiJson<Response>('/api/ehr/therapy-workflow?pending=1')
      .then((res) => setData(res))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load'));
  }, []);
  if (error) return <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">Pending-plan list could not be loaded ({error}).</p>;
  if (!data) return null;
  if (data.pendingError) return <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">{data.pendingError}</p>;
  if (!data.pending.length) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">
        Before go-live: treatment plan pending ({data.pending.length} client{data.pending.length === 1 ? '' : 's'})
      </p>
      <p className="mt-0.5 text-xs text-amber-800">
        Therapy progress notes were signed for these Valant clients without an active treatment plan, under the go-live transition
        {data.settings.transitionUntilEffective ? ` (allowed through ${data.settings.transitionUntilEffective})` : ''}. Write and sign each plan in
        Altrixs; after the transition, notes for a client without a plan cannot be signed.
      </p>
      <ul className="mt-2 space-y-1 text-xs text-amber-900">
        {data.pending.slice(0, 50).map((c) => (
          <li key={c.clientId} className="flex flex-wrap items-center gap-x-2">
            <Link href={`/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(c.clientId)}`} className="font-semibold underline">
              {c.clientName}
            </Link>
            <span>
              Plan needed by {c.until} · {c.noteCount} note{c.noteCount === 1 ? '' : 's'} signed with the plan pending
              {c.authorNames.length ? ` · ${c.authorNames.join(', ')}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {data.pending.length > 50 ? <p className="mt-1 text-[11px] text-amber-800">Showing 50 of {data.pending.length}.</p> : null}
    </div>
  );
}
