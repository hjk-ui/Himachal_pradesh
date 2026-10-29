'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Send } from 'lucide-react';
import { ASSIGNMENT_STATUS_LABEL, type AssignmentDto } from '@/lib/resources/types';
import { fetchAssignments, withdrawAssignment } from './api';
import { cardClasses, cx, StatusBadge, type Tone } from '@/components/ui';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

const TONE: Record<string, Tone> = {
  sent: 'brand',
  viewed: 'info',
  completed: 'success',
  withdrawn: 'neutral',
};

/**
 * Chart card: resources sent to this client's portal with status (sent / viewed / completed).
 * "Send a resource" opens the library already pointed at this client (context = chart), so
 * sending is two clicks. Renders nothing when the viewer cannot see the client's assignments.
 */
export function ClientResourcesCard({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<AssignmentDto[] | null>(null);
  const [canAssign, setCanAssign] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchAssignments({ clientId })
      .then((r) => { setRows(r.assignments); setCanAssign(Boolean(r.canAssign)); })
      .catch(() => setHidden(true));
  }, [clientId]);
  useEffect(load, [load]);

  if (hidden || !rows) return null;
  const live = rows.filter((r) => r.status !== 'withdrawn');
  const shown = showAll ? rows : live.slice(0, 5);
  const done = live.filter((r) => r.status === 'completed').length;

  async function withdraw(id: string) {
    setBusy(id);
    try { await withdrawAssignment(id); load(); } finally { setBusy(null); }
  }

  return (
    <section aria-label="Resources sent to this client" className={cx(cardClasses, 'p-4')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
          <BookOpen size={16} className="text-blue-600" aria-hidden /> Resources
        </h3>
        {canAssign && (
          <Link href={`/dashboard/resources?clientId=${encodeURIComponent(clientId)}&context=chart`} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline">
            <Send size={13} aria-hidden /> Send a resource
          </Link>
        )}
      </div>
      {live.length === 0 && !showAll ? (
        <p className="mt-2 text-sm text-slate-500">No resources sent to the portal yet.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500">{live.length} sent · {done} completed</p>
          <ul className="mt-2 space-y-1.5">
            {shown.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-slate-800" title={a.itemTitle}>
                  {a.itemTitle}
                  {a.part2 && <StatusBadge tone="warning" size="sm" className="ml-1.5">Part 2</StatusBadge>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-slate-500">{fmt(a.completedAt ?? a.viewedAt ?? a.sentAt ?? a.createdAt)}</span>
                  <StatusBadge tone={TONE[a.status] ?? 'neutral'}>{ASSIGNMENT_STATUS_LABEL[a.status]}</StatusBadge>
                  {canAssign && (a.status === 'sent' || a.status === 'viewed') && (
                    <button type="button" disabled={busy === a.id} onClick={() => withdraw(a.id)} className="rounded text-xs font-semibold text-slate-600 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" aria-label={`Withdraw ${a.itemTitle}`}>
                      Withdraw
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {(rows.length > shown.length || showAll) && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 rounded text-xs font-semibold text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              {showAll ? 'Show fewer' : `Show all ${rows.length} (including withdrawn)`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
