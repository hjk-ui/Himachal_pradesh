'use client';

/**
 * Home strip: the clinician's documentation queue with counts (GET /api/notes/worklist, "mine"
 * scope), each opening the Notes worklist on that tab: visits to document, drafts, ready to sign,
 * returned by a supervisor, co-signatures and (supervisors) notes overdue more than 7 days.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CornerUpLeft, FilePen, FileSignature, FileText, Loader2, UserCheck } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { notesQueueTiles, type NotesQueueCounts } from '@/lib/notes/queueTiles';

const ICONS: Record<string, React.ReactNode> = {
  missing: <FileText size={15} aria-hidden />,
  drafts: <FilePen size={15} aria-hidden />,
  ready: <FileSignature size={15} aria-hidden />,
  returned: <CornerUpLeft size={15} aria-hidden />,
  cosign: <UserCheck size={15} aria-hidden />,
  escalated: <AlertTriangle size={15} aria-hidden />,
};

export function MyNotesQueue({ title = 'My documentation' }: { title?: string }) {
  const [counts, setCounts] = useState<NotesQueueCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiJson<{ counts: NotesQueueCounts }>('/api/notes/worklist?tab=drafts&pageSize=5')
      .then((r) => {
        if (!cancelled) setCounts(r.counts);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your notes queue');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-label={title} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        <Link href="/dashboard/ehr/notes" className="text-xs font-semibold text-purple-600 hover:underline">
          Open notes
        </Link>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-rose-700">
          {error}. Open Notes to see your queue.
        </p>
      ) : !counts ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 size={13} className="animate-spin" aria-hidden /> Loading your queue…
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {notesQueueTiles(counts).map((t) => (
            <Link
              key={t.tab}
              href={t.href}
              title={t.hint}
              className={`flex min-h-[64px] flex-col justify-between rounded-xl border px-3 py-2 transition hover:shadow-sm ${
                t.attention ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
              }`}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                {ICONS[t.tab]}
                {t.label}
              </span>
              <span className={`text-xl font-extrabold tabular-nums ${t.attention ? 'text-amber-800' : 'text-slate-800'}`}>{t.count}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
