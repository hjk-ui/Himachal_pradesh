'use client';

/** The signed-in user's saved reports (parameters + optional email schedule), from /api/reports/library/saved. */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BellOff, Bookmark, Mail, Trash2 } from 'lucide-react';
import { Alert, Button, Card, EmptyState, IconButton, LoadingState, buttonClasses } from '@/components/ui';
import { apiJson } from '@/lib/api-client';

type SavedView = {
  id: string;
  reportId: string;
  reportTitle: string;
  name: string;
  schedule: string;
  scheduleText: string;
  nextRunAt: string | null;
  lastSentAt: string | null;
  lastError: string | null;
  href: string;
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

export function SavedReports({ query }: { query: string }) {
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    apiJson<{ success: boolean; views: SavedView[]; available: boolean }>('/api/reports/library/saved')
      .then((r) => {
        setViews(r.views);
        setAvailable(r.available);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load saved reports'));
  }, []);
  useEffect(load, [load]);

  const act = async (id: string, method: 'PATCH' | 'DELETE') => {
    setBusy(id);
    try {
      await apiJson(`/api/reports/library/saved/${encodeURIComponent(id)}`, method === 'PATCH' ? { method, body: JSON.stringify({ schedule: 'none' }) } : { method });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!views) return <LoadingState label="Loading saved reports" />;
  if (!available) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white">
        <EmptyState title="Saved reports need database migration 20261019_report_library.sql." />
      </div>
    );
  }
  const q = query.toLowerCase();
  const list = views.filter((v) => !q || `${v.name} ${v.reportTitle}`.toLowerCase().includes(q));
  if (!list.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white">
        <EmptyState
          title="No saved reports yet."
          description={<>Open a report, set its parameters and use <strong>Save / schedule</strong>.</>}
        />
      </div>
    );
  }
  return (
    <Card className="divide-y divide-slate-100 overflow-hidden">
      {list.map((v) => (
        <div key={v.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Link href={v.href} className="flex items-center gap-1.5 font-semibold text-slate-900 hover:text-blue-700">
              <Bookmark size={14} aria-hidden className="text-blue-600" /> {v.name}
            </Link>
            <p className="text-xs text-slate-500">{v.reportTitle}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1"><Mail size={12} aria-hidden /> {v.scheduleText}</span>
              {v.nextRunAt ? <span>Next: {fmt(v.nextRunAt)}</span> : null}
              {v.lastSentAt ? <span>Last sent: {fmt(v.lastSentAt)}</span> : null}
              {v.lastError ? <span className="inline-flex items-center gap-1 text-amber-800"><AlertTriangle size={12} aria-hidden /> {v.lastError}</span> : null}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link href={v.href} className={buttonClasses({ size: 'sm' })}>Open</Link>
            {v.schedule !== 'none' ? (
              <Button variant="secondary" size="sm" icon={<BellOff />} disabled={busy === v.id} onClick={() => act(v.id, 'PATCH')}>
                Stop emails
              </Button>
            ) : null}
            <IconButton
              label={`Delete saved report ${v.name}`}
              icon={<Trash2 size={16} />}
              disabled={busy === v.id}
              onClick={() => act(v.id, 'DELETE')}
              className="h-10 w-10 border border-slate-300 bg-white text-slate-500 hover:bg-rose-50 hover:text-rose-700 md:h-8 md:w-8"
            />
          </div>
        </div>
      ))}
    </Card>
  );
}
