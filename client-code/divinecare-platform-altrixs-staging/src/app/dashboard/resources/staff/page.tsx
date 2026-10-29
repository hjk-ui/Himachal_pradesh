'use client';

/**
 * Staff resources: practice policies, forms and training links. Separate from patient-facing
 * content and never sent to clients. Every clinic role opens the page; each item is narrowed by
 * its visibleRoles (src/lib/resources/access.ts). Leadership, office manager and HR manage them.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Download, ExternalLink, Pencil, Plus, Search, Star } from 'lucide-react';
import { Alert, Button, EmptyState, IconButton, LoadingState, Page, PageHeader, StatusBadge, buttonClasses, cx, FOCUS_RING } from '@/components/ui';
import { ItemEditor } from '@/features/resources/ItemEditor';
import { downloadItemFile, fetchLibrary, markUsed, setFavorite, type LibraryResponse } from '@/features/resources/api';
import { STAFF_CATEGORIES, STAFF_CATEGORY_LABEL, type ResourceItemDto, type StaffCategory } from '@/lib/resources/types';

const chip = (on: boolean) =>
  cx('rounded-full px-3 py-1.5 text-xs font-semibold transition', FOCUS_RING, on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200');

export default function StaffResourcesPage() {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('');
  const [editing, setEditing] = useState<ResourceItemDto | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    fetchLibrary('staff').then(setData).catch((e: Error) => setError(e.message || 'Could not load staff resources'));
  }, []);
  useEffect(load, [load]);

  const items = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (data?.items ?? []).filter(
      (i) => (!cat || i.staffCategory === cat) && words.every((w) => `${i.title} ${i.summary ?? ''} ${i.publisher ?? ''}`.toLowerCase().includes(w)),
    );
  }, [data, q, cat]);

  async function download(item: ResourceItemDto) {
    setBusyId(item.id);
    try { await downloadItemFile(item); } catch (e) { setError(e instanceof Error ? e.message : 'Download failed'); } finally { setBusyId(null); }
  }

  async function fav(item: ResourceItemDto) {
    const next = !item.favorite;
    setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, favorite: next } : i)) } : d));
    await setFavorite(item.id, next).catch(() => load());
  }

  return (
    <Page>
      <Link href="/dashboard" className={cx('inline-flex items-center gap-1 rounded text-sm font-semibold text-slate-600 hover:text-slate-900', FOCUS_RING)}>
        <ArrowLeft size={14} aria-hidden /> Dashboard
      </Link>
      <PageHeader
        title="Staff resources"
        description="Policies, forms and training for the team. Not visible to clients."
        actions={
          data?.canManage && (
            <Button onClick={() => setEditing('new')} icon={<Plus />}>
              Add staff resource
            </Button>
          )
        }
      />

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full min-w-0 sm:w-auto sm:min-w-[16rem] sm:flex-[1_1_20rem]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input type="search" autoFocus aria-label="Search staff resources" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search policies, forms, training" className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 shadow-xs outline-none placeholder:text-slate-500 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20" />
        </div>
        <div className="flex min-w-0 flex-wrap gap-1.5" role="group" aria-label="Category">
          <button type="button" aria-pressed={!cat} onClick={() => setCat('')} className={chip(!cat)}>All</button>
          {STAFF_CATEGORIES.map((c) => (
            <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(cat === c ? '' : c)} className={chip(cat === c)}>
              {STAFF_CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      {error && <Alert tone="danger" actions={<Button variant="secondary" size="sm" onClick={load}>Try again</Button>}>{error}</Alert>}
      {!data && !error && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
          <LoadingState label="Loading…" rows={4} />
        </div>
      )}
      {data && data.items.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
          <EmptyState
            icon={<BookOpen />}
            title="No staff resources yet."
            description={data.canManage ? 'Add your policies, forms and training links.' : 'Policies, forms and training links the practice shares with you will appear here.'}
          />
        </div>
      )}
      {data && data.items.length > 0 && items.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
          <EmptyState compact icon={<Search />} title="No staff resources match." description="Try a different search or category." />
        </div>
      )}
      {data && data.items.length > 0 && items.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          {items.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">
                  {i.title}
                  {i.status !== 'active' && <StatusBadge tone="warning" size="sm" className="ml-2 capitalize">{i.status}</StatusBadge>}
                </p>
                <p className="text-xs text-slate-500">
                  {i.staffCategory ? STAFF_CATEGORY_LABEL[i.staffCategory as StaffCategory] : 'Other'}
                  {i.visibleRoles.length ? ` · Visible to ${i.visibleRoles.length} role${i.visibleRoles.length === 1 ? '' : 's'}` : ' · All staff'}
                  {i.summary ? ` · ${i.summary}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <IconButton label={i.favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => fav(i)} icon={<Star size={16} className={i.favorite ? 'fill-amber-400 text-amber-500' : ''} />} className="h-9 w-9 text-slate-500 hover:bg-slate-100" />
                {i.url && (
                  <a href={i.url} target="_blank" rel="noopener noreferrer" onClick={() => markUsed(i.id)} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                    <ExternalLink size={14} aria-hidden /> Open
                  </a>
                )}
                {i.hasFile && (
                  <Button variant="secondary" size="sm" onClick={() => download(i)} disabled={busyId === i.id} loading={busyId === i.id} icon={<Download />}>
                    Download
                  </Button>
                )}
                {data.canManage && (
                  <IconButton label={`Edit ${i.title}`} onClick={() => setEditing(i)} icon={<Pencil size={15} />} className="h-9 w-9 text-slate-500 hover:bg-slate-100" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ItemEditor
          item={editing === 'new' ? null : editing}
          audience="staff"
          canReview={false}
          onClose={() => setEditing(null)}
          onSaved={() => load()}
        />
      )}
    </Page>
  );
}
