'use client';

/**
 * Report library: every report this role may run (Operational, Clinical, Billing & RCM, Programs,
 * Compliance & System) plus links to the richer report pages. Favorites and "recently run" are
 * kept in this browser only (report ids and times; no parameters or results).
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  BarChart3,
  Clock,
  FileText,
  Lock,
  Search,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { readFavorites, readRecent, toggleFavorite, useReportLibrary, type RecentRun } from '@/features/reports/libraryClient';
import type { LibraryLink, ReportCategory, ReportMeta } from '@/lib/reports/library/types';
import { SavedReports } from '@/features/reports/SavedReports';
import { Alert, EmptyState, FOCUS_RING, LoadingState, Page, PageHeader, StatusBadge, Tabs, cardClasses, cx, inputClasses } from '@/components/ui';

type Tab = 'all' | 'favorites' | 'recent' | 'saved' | ReportCategory;

function matches(q: string, ...parts: (string | undefined)[]): boolean {
  if (!q) return true;
  const hay = parts.filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function ReportCard({ r, fav, onFav, recent, categoryLabel }: { r: ReportMeta; fav: boolean; onFav: () => void; recent?: RecentRun; categoryLabel: string }) {
  return (
    <div className={cx(cardClasses, 'group relative flex flex-col p-4 transition hover:border-slate-300 hover:shadow-sm')}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/dashboard/reports/run/${r.id}`} className={cx('min-w-0 flex-1 rounded-md', FOCUS_RING)}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{categoryLabel}</p>
          <h3 className="mt-0.5 font-semibold text-slate-900 group-hover:text-blue-700">{r.title}</h3>
        </Link>
        <button
          type="button"
          onClick={onFav}
          aria-pressed={fav}
          aria-label={fav ? `Remove ${r.title} from favorites` : `Add ${r.title} to favorites`}
          className={cx('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 md:h-8 md:w-8 hover:bg-slate-100 hover:text-amber-500', FOCUS_RING)}
        >
          <Star size={16} aria-hidden className={fav ? 'fill-amber-500 text-amber-500' : 'fill-none'} />
        </button>
      </div>
      <Link href={`/dashboard/reports/run/${r.id}`} className={cx('mt-1 flex-1 rounded-md text-sm text-slate-600', FOCUS_RING)}>
        {r.description}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        {r.output === 'patient' ? (
          <StatusBadge size="sm" tone="warning" icon={<Lock />}>Patient-level (PHI)</StatusBadge>
        ) : (
          <StatusBadge size="sm" tone="neutral" icon={<BarChart3 />}>Aggregate</StatusBadge>
        )}
        {r.suppressSmallCells ? (
          <span title="Counts under 10 are hidden from non-clinical roles">
            <StatusBadge size="sm" tone="neutral" icon={<ShieldCheck />}>Small cells suppressed</StatusBadge>
          </span>
        ) : null}
        {recent ? (
          <span className="inline-flex items-center gap-1 text-slate-500">
            <Clock size={12} aria-hidden /> Run {timeAgo(recent.at)}
          </span>
        ) : null}
        {r.link ? (
          <Link href={r.link.href} className="ml-auto inline-flex items-center gap-0.5 text-xs font-semibold text-blue-700 hover:underline">
            {r.link.label} <ArrowUpRight size={12} aria-hidden />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function LinkCard({ l, categoryLabel }: { l: LibraryLink; categoryLabel: string }) {
  return (
    <Link href={l.href} className={cx('group flex flex-col rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 transition hover:border-slate-400 hover:bg-white', FOCUS_RING)}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{categoryLabel} · Report page</p>
      <h3 className="mt-0.5 flex items-center gap-1 font-semibold text-slate-900 group-hover:text-blue-700">
        {l.title} <ArrowUpRight size={14} aria-hidden />
      </h3>
      <p className="mt-1 text-sm text-slate-600">{l.description}</p>
    </Link>
  );
}

export default function ReportLibraryPage() {
  const { data, error } = useReportLibrary();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [favs, setFavs] = useState<string[]>([]);
  const [recent, setRecent] = useState<RecentRun[]>([]);

  useEffect(() => {
    setFavs(readFavorites());
    setRecent(readRecent());
  }, []);

  const categories = useMemo(() => (data?.categories ?? []) as readonly { id: ReportCategory; label: string }[], [data]);
  const catLabel = useMemo(() => new Map<string, string>(categories.map((c) => [c.id, c.label] as [string, string])), [categories]);
  const recentBy = useMemo(() => new Map(recent.map((r) => [r.id, r])), [recent]);

  const reports = useMemo(() => {
    const list = (data?.reports ?? []).filter((r) => matches(q, r.title, r.description, r.keywords, catLabel.get(r.category)));
    if (tab === 'favorites') return list.filter((r) => favs.includes(r.id));
    if (tab === 'recent') return recent.map((x) => list.find((r) => r.id === x.id)).filter((r): r is ReportMeta => Boolean(r));
    if (tab === 'all') return list;
    return list.filter((r) => r.category === tab);
  }, [data, q, tab, favs, recent, catLabel]);

  const links = useMemo(() => {
    if (tab === 'favorites' || tab === 'recent' || tab === 'saved') return [];
    return (data?.links ?? []).filter((l) => (tab === 'all' || l.category === tab) && matches(q, l.title, l.description, l.keywords));
  }, [data, q, tab]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.reports ?? []) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, [data]);

  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: 'all', label: 'All', n: data?.reports.length },
    { id: 'favorites', label: 'Favorites', n: favs.filter((f) => data?.reports.some((r) => r.id === f)).length },
    { id: 'recent', label: 'Recently run', n: recent.filter((x) => data?.reports.some((r) => r.id === x.id)).length },
    { id: 'saved', label: 'Saved & scheduled' },
    ...categories.filter((c) => counts.get(c.id)).map((c) => ({ id: c.id as Tab, label: c.label, n: counts.get(c.id) })),
  ];

  return (
    <Page>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <FileText size={22} aria-hidden className="text-blue-600" /> Report library
          </span>
        }
        description="Operational, clinical, billing, program and compliance reports from live Altrixs records and imported Valant data. Every run and export is audit-logged."
        actions={
          <label className="relative w-full sm:w-80">
            <span className="sr-only">Search reports</span>
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search reports (e.g. no-show, aging, PHQ-9)"
              className={cx(inputClasses, 'pl-9')}
            />
          </label>
        }
      />

      <Tabs
        label="Report categories"
        controlsPanels={false}
        value={tab}
        onChange={setTab}
        items={tabs.map((t) => ({ key: t.id, label: t.label, count: t.n }))}
      />

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !data ? (
        <LoadingState label="Loading reports" />
      ) : tab === 'saved' ? (
        <SavedReports query={q} />
      ) : reports.length === 0 && links.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white">
          <EmptyState
            title={tab === 'favorites' ? 'No favorites yet. Use the star on a report to pin it here.' : tab === 'recent' ? 'No reports run in this browser yet.' : 'No reports match your search.'}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {reports.map((r) => (
            <ReportCard key={r.id} r={r} fav={favs.includes(r.id)} onFav={() => setFavs(toggleFavorite(r.id))} recent={recentBy.get(r.id)} categoryLabel={catLabel.get(r.category) ?? r.category} />
          ))}
          {links.map((l) => (
            <LinkCard key={l.id} l={l} categoryLabel={catLabel.get(l.category) ?? l.category} />
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Favorites and recently run reports are remembered in this browser only (report names and times, no report data).
      </p>
    </Page>
  );
}
