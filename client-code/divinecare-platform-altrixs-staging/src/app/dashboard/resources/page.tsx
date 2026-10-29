'use client';

/**
 * Resource Library: patient education and community resources staff send to a client's portal.
 * Relational and audited (src/lib/resources; migration 20261020_resource_library.sql). Content is
 * the practice's own reviewed handouts plus verified links to public sources (seedCatalog.ts);
 * nothing is copied from copyrighted publishers. Staff resources live at /dashboard/resources/staff.
 */
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BookOpen,
  Download,
  ExternalLink,
  FileText,
  LayoutGrid,
  LifeBuoy,
  Link2,
  List,
  MapPin,
  Pencil,
  Plus,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Star,
  Users,
  Video,
  X,
} from 'lucide-react';
import { Alert, Button, EmptyState, ErrorState, IconButton, LoadingState, Page, PageHeader, StatusBadge, Tabs, buttonClasses, cx, FOCUS_RING, type Tone } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { CrisisLinesButton } from '@/features/resources/CrisisLinesButton';
import { AssignResourceDialog, type AssignTarget } from '@/features/resources/AssignResourceDialog';
import { ItemEditor } from '@/features/resources/ItemEditor';
import {
  downloadItemFile,
  fetchAssignments,
  fetchLibrary,
  markUsed,
  seedStarter,
  setFavorite,
  withdrawAssignment,
  type LibraryResponse,
} from '@/features/resources/api';
import { matchesQuery } from '@/lib/resources/rules';
import {
  ASSIGNMENT_STATUS_LABEL,
  AUDIENCES,
  AUDIENCE_LABEL,
  LANGUAGES,
  RESOURCE_KINDS,
  RESOURCE_KIND_LABEL,
  TOPICS,
  TOPIC_LABEL,
  languageLabel,
  type AssignmentDto,
  type ResourceItemDto,
  type Topic,
} from '@/lib/resources/types';

const topicLabel = (t: string) => TOPIC_LABEL[t as Topic] ?? t;
const PRIMARY_CHIPS: Topic[] = ['crisis', 'anxiety', 'depression', 'trauma', 'sud_recovery', 'sleep', 'coping_skills', 'parenting', 'grief', 'medication_info', 'diabetes', 'hypertension', 'community_services'];
const VIEW_KEY = 'resources:view';
const SELECT_CLS = 'h-10 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';
const CHIP = (on: boolean) => cx('rounded-full px-3 py-1.5 text-xs font-semibold transition', FOCUS_RING, on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200');

function KindIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  if (kind === 'handout') return <FileText size={size} aria-hidden />;
  if (kind === 'video') return <Video size={size} aria-hidden />;
  if (kind === 'crisis') return <LifeBuoy size={size} aria-hidden />;
  if (kind === 'community') return <MapPin size={size} aria-hidden />;
  if (kind === 'article') return <BookOpen size={size} aria-hidden />;
  return <Link2 size={size} aria-hidden />;
}

function StatusPill({ status }: { status: string }) {
  const tone: Tone =
    status === 'completed' ? 'success' :
    status === 'viewed' ? 'info' :
    status === 'withdrawn' ? 'neutral' :
    status === 'draft' ? 'warning' :
    status === 'retired' ? 'neutral' :
    'brand';
  const label = (ASSIGNMENT_STATUS_LABEL as Record<string, string>)[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
  return <StatusBadge tone={tone} size="sm">{label}</StatusBadge>;
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

export default function ResourceLibraryPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading the library…" />}>
      <ResourceLibrary />
    </Suspense>
  );
}

function ResourceLibrary() {
  const params = useSearchParams();
  const presetClientId = params.get('clientId');
  const ctxParam = params.get('context');
  const context = (['chart', 'note', 'scribe', 'sdoh'] as const).find((c) => c === ctxParam) ?? 'library';
  const contextId = params.get('contextId');
  const sudContext = params.get('sud') === '1';

  const [data, setData] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'library' | 'sent'>('library');
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState<string>('');
  const [kind, setKind] = useState('');
  const [audience, setAudience] = useState('');
  const [language, setLanguage] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<ResourceItemDto | null>(null);
  const [editing, setEditing] = useState<ResourceItemDto | 'new' | null>(null);
  const [toast, setToast] = useState('');
  const [presetClient, setPresetClient] = useState<AssignTarget | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(() => {
    setError('');
    fetchLibrary('patient').then(setData).catch((e: Error) => setError(e.message || 'Could not load the library'));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === 'grid' || v === 'list') setView(v);
    } catch { /* storage unavailable */ }
  }, []);
  const changeView = (v: 'grid' | 'list') => {
    setView(v);
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ }
  };

  useEffect(() => {
    if (!presetClientId) { setPresetClient(null); return; }
    apiJson<{ client: { id: string; name: string } }>(`/api/clients/${encodeURIComponent(presetClientId)}`)
      .then((r) => setPresetClient({ id: r.client.id, name: r.client.name }))
      .catch(() => setPresetClient(null));
  }, [presetClientId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          (statusFilter === 'all' || i.status === 'active') &&
          (!topic || i.topics.includes(topic)) &&
          (!kind || i.kind === kind) &&
          (!audience || i.audiences.includes(audience)) &&
          (!language || i.language === language) &&
          (!favoritesOnly || i.favorite) &&
          matchesQuery(i, q, topicLabel),
      ),
    [items, statusFilter, topic, kind, audience, language, favoritesOnly, q],
  );
  const recent = useMemo(() => (data?.recent ?? []).map((id) => items.find((i) => i.id === id)).filter((i): i is ResourceItemDto => Boolean(i && i.status === 'active')), [data, items]);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const filtersOn = Boolean(q || topic || kind || audience || language || favoritesOnly);

  function replaceItem(next: ResourceItemDto) {
    setData((d) => (d ? { ...d, items: d.items.some((i) => i.id === next.id) ? d.items.map((i) => (i.id === next.id ? { ...next, favorite: i.favorite, lastUsedAt: i.lastUsedAt } : i)) : [next, ...d.items] } : d));
  }

  async function toggleFavorite(item: ResourceItemDto) {
    const next = !item.favorite;
    setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, favorite: next } : i)) } : d));
    try {
      await setFavorite(item.id, next);
    } catch {
      setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, favorite: !next } : i)) } : d));
    }
  }

  async function addStarter() {
    setSeeding(true);
    try {
      const r = await seedStarter();
      setToast(
        `Added ${r.items} verified resources and ${r.community} statewide directory entr${r.community === 1 ? 'y' : 'ies'}` +
          (r.aotDrafts ? `, plus ${r.aotDrafts} MDH AOT resource draft${r.aotDrafts === 1 ? '' : 's'} (add a link before activating)` : ''),
      );
      load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not add the starter content');
    } finally {
      setSeeding(false);
    }
  }

  const startAssign = (item: ResourceItemDto) => setAssigning(item);

  return (
    <Page>
      <PageHeader
        title="Resource Library"
        description={<>Patient education, crisis lines and community resources you can send to a client&apos;s portal.</>}
        actions={
          <>
            <CrisisLinesButton />
            <Link href="/dashboard/resources/staff" className={buttonClasses({ variant: 'secondary' })}>
              <Users size={16} aria-hidden /> Staff resources
            </Link>
            {data?.canManage && (
              <Button onClick={() => setEditing('new')} icon={<Plus />}>
                Add resource
              </Button>
            )}
          </>
        }
      />

      {presetClient && (
        <Alert
          tone="brand"
          actions={<Link href={`/dashboard/clients/${encodeURIComponent(presetClient.id)}`} className="font-semibold text-blue-700 hover:underline">Back to chart</Link>}
        >
          Choosing a resource for <span className="font-semibold">{presetClient.name}</span>. Click <span className="font-semibold">Send</span> on any resource.
        </Alert>
      )}

      <div className="flex min-w-0 items-center gap-2 border-b border-slate-200">
        <Tabs
          label="Library views"
          controlsPanels={false}
          className="min-w-0 flex-1 border-b-0"
          value={tab}
          onChange={setTab}
          items={[
            { key: 'library', label: 'Library' },
            { key: 'sent', label: 'Sent to clients' },
          ]}
        />
        <Link href="/dashboard/sdoh" className={cx('shrink-0 rounded px-2 text-sm font-semibold text-blue-700 hover:underline', FOCUS_RING)}>
          Community directory
        </Link>
      </div>

      {error && (
        <Alert tone="danger" actions={<Button variant="secondary" size="sm" onClick={load}>Try again</Button>}>
          {error}
        </Alert>
      )}

      {tab === 'sent' ? (
        <SentTab />
      ) : (
        <>
          <section aria-label="Search and filters" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  type="search"
                  autoFocus
                  aria-label="Search the library"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by topic, title or publisher (e.g. sleep, NIMH, diabetes)"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 shadow-xs outline-none placeholder:text-slate-500 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                />
              </div>
              <div className="flex items-center gap-2" role="group" aria-label="Layout">
                <IconButton label="Card view" aria-pressed={view === 'grid'} onClick={() => changeView('grid')} icon={<LayoutGrid size={16} />} className={`h-11 w-11 ${view === 'grid' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} />
                <IconButton label="List view" aria-pressed={view === 'list'} onClick={() => changeView('list')} icon={<List size={16} />} className={`h-11 w-11 ${view === 'list' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Topics">
              <button type="button" aria-pressed={!topic} onClick={() => setTopic('')} className={CHIP(!topic)}>All topics</button>
              {PRIMARY_CHIPS.map((t) => (
                <button key={t} type="button" aria-pressed={topic === t} onClick={() => setTopic(topic === t ? '' : t)} className={CHIP(topic === t)}>
                  {TOPIC_LABEL[t]}
                </button>
              ))}
              <select aria-label="More topics" value={PRIMARY_CHIPS.includes(topic as Topic) ? '' : topic} onChange={(e) => setTopic(e.target.value)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20">
                <option value="">More topics…</option>
                {TOPICS.filter((t) => !PRIMARY_CHIPS.includes(t)).map((t) => <option key={t} value={t}>{TOPIC_LABEL[t]}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)} className={SELECT_CLS}>
                <option value="">All types</option>
                {RESOURCE_KINDS.map((k) => <option key={k} value={k}>{RESOURCE_KIND_LABEL[k]}</option>)}
              </select>
              <select aria-label="Audience" value={audience} onChange={(e) => setAudience(e.target.value)} className={SELECT_CLS}>
                <option value="">All audiences</option>
                {AUDIENCES.map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
              </select>
              <select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} className={SELECT_CLS}>
                <option value="">All languages</option>
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
              {data?.canManage && (
                <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'active' | 'all')} className={SELECT_CLS}>
                  <option value="active">Active only</option>
                  <option value="all">Include drafts and retired</option>
                </select>
              )}
              <button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((v) => !v)} className={cx('inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium', FOCUS_RING, favoritesOnly ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>
                <Star size={14} aria-hidden /> Favorites
              </button>
              {filtersOn && (
                <button type="button" onClick={() => { setQ(''); setTopic(''); setKind(''); setAudience(''); setLanguage(''); setFavoritesOnly(false); }} className={cx('rounded text-sm font-semibold text-blue-700 hover:underline', FOCUS_RING)}>
                  Clear filters
                </button>
              )}
            </div>
          </section>

          {!data && !error && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
              <LoadingState label="Loading the library…" rows={4} />
            </div>
          )}

          {data && items.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
              <EmptyState
                icon={<BookOpen />}
                title="The library is empty"
                description={<>Add your practice&apos;s own handouts, or add the verified starter set: links to public pages from SAMHSA, 988, NIMH, the VA National Center for PTSD, CDC, MedlinePlus, the Maryland Department of Health, 211 Maryland and Crisis Text Line.</>}
                action={
                  data.canManage ? (
                    <Button onClick={addStarter} disabled={seeding} loading={seeding} icon={<Sparkles />}>
                      Add verified starter content
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}

          {recent.length > 0 && !filtersOn && (
            <section aria-label="Recently used">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Recently used</h2>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {recent.map((i) => (
                  <button key={i.id} type="button" onClick={() => setSelectedId(i.id)} className={cx('flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm shadow-xs hover:border-slate-300', FOCUS_RING)}>
                    <span className="text-slate-500"><KindIcon kind={i.kind} size={14} /></span>
                    <span className="max-w-[14rem] truncate font-medium text-slate-800">{i.title}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {data && items.length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <section aria-label="Resources" aria-live="polite" className="min-w-0">
                <p className="mb-2 text-xs text-slate-500">{filtered.length} of {items.length} resources</p>
                {filtered.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
                    <EmptyState compact icon={<Search />} title="No resources match." description="Try fewer filters." />
                  </div>
                ) : view === 'grid' ? (
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((i) => (
                      <li key={i.id}>
                        <ItemCard item={i} selected={i.id === selectedId} canAssign={Boolean(data.canAssign)} onSelect={() => setSelectedId(i.id)} onAssign={() => startAssign(i)} onFavorite={() => toggleFavorite(i)} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                    {filtered.map((i) => (
                      <li key={i.id} className={`flex items-center gap-3 px-4 py-3 ${i.id === selectedId ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                        <span className="text-slate-500"><KindIcon kind={i.kind} /></span>
                        <button type="button" onClick={() => setSelectedId(i.id)} className={cx('min-w-0 flex-1 rounded text-left', FOCUS_RING)}>
                          <span className="block truncate text-sm font-medium text-slate-900">{i.title}</span>
                          <span className="block truncate text-xs text-slate-500">{RESOURCE_KIND_LABEL[i.kind]} · {i.publisher ?? 'Practice'} · {languageLabel(i.language)}</span>
                        </button>
                        {i.status !== 'active' && <StatusPill status={i.status} />}
                        <IconButton label={i.favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => toggleFavorite(i)} icon={<Star size={16} className={i.favorite ? 'fill-amber-400 text-amber-500' : ''} />} className="h-9 w-9 text-slate-500 hover:bg-slate-100" />
                        {data.canAssign && i.status === 'active' && (
                          <Button variant="secondary" size="sm" onClick={() => startAssign(i)} icon={<Send />}>
                            Send
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {selected && (
                <PreviewPane
                  item={selected}
                  canAssign={Boolean(data.canAssign)}
                  canManage={Boolean(data.canManage)}
                  onClose={() => setSelectedId(null)}
                  onAssign={() => startAssign(selected)}
                  onEdit={() => setEditing(selected)}
                  onFavorite={() => toggleFavorite(selected)}
                  onError={setToast}
                />
              )}
            </div>
          )}

          {data && data.canManage && items.length > 0 && data.seededCount > 0 && (data.aotSeedMissing ?? 0) > 0 && (
            <p className="text-xs text-slate-500">
              {data.aotSeedMissing} MDH AOT resources (from the MDH AOT Resource Center) have not been added. They are added as drafts:
              staff add and verify each link before activating.{' '}
              <button type="button" onClick={addStarter} disabled={seeding} className={cx('rounded font-semibold text-blue-700 hover:underline', FOCUS_RING)}>Add them</button>
            </p>
          )}
          {data && data.canManage && items.length > 0 && data.seededCount === 0 && (
            <p className="text-xs text-slate-500">
              Verified starter links have not been added.{' '}
              <button type="button" onClick={addStarter} disabled={seeding} className={cx('rounded font-semibold text-blue-700 hover:underline', FOCUS_RING)}>Add them</button>
            </p>
          )}
        </>
      )}

      {assigning && (
        <AssignResourceDialog
          item={assigning}
          presetClient={presetClient}
          context={presetClient ? context : 'library'}
          contextId={presetClient ? contextId : null}
          sudContext={sudContext}
          onClose={() => setAssigning(null)}
          onAssigned={(m) => { setAssigning(null); setToast(m); }}
        />
      )}
      {editing && (
        <ItemEditor
          item={editing === 'new' ? null : editing}
          audience="patient"
          canReview={Boolean(data?.canReview)}
          onClose={() => setEditing(null)}
          onSaved={(it) => { replaceItem(it); setSelectedId(it.id); }}
        />
      )}
      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </Page>
  );
}

function ItemCard({ item, selected, canAssign, onSelect, onAssign, onFavorite }: { item: ResourceItemDto; selected: boolean; canAssign: boolean; onSelect: () => void; onAssign: () => void; onFavorite: () => void }) {
  return (
    <article className={`flex h-full flex-col rounded-xl border bg-white p-4 shadow-xs transition ${selected ? 'border-blue-600 ring-2 ring-blue-600/20' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <StatusBadge tone={item.kind === 'crisis' ? 'danger' : 'neutral'} size="sm" icon={<KindIcon kind={item.kind} size={12} />}>
          {RESOURCE_KIND_LABEL[item.kind]}
        </StatusBadge>
        <IconButton label={item.favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={onFavorite} icon={<Star size={16} className={item.favorite ? 'fill-amber-400 text-amber-500' : ''} />} className="h-10 w-10 shrink-0 md:h-8 md:w-8 text-slate-500 hover:bg-slate-100" />
      </div>
      <button type="button" onClick={onSelect} className={cx('rounded text-left', FOCUS_RING)}>
        <h3 className="text-sm font-semibold leading-snug text-slate-900">{item.title}</h3>
        {item.summary && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{item.summary}</p>}
      </button>
      <p className="mt-2 text-xs text-slate-500">{item.publisher ?? 'Practice'}{item.language !== 'en' ? ` · ${languageLabel(item.language)}` : ''}</p>
      <div className="mt-auto flex items-center justify-between pt-3">
        <span className="flex flex-wrap gap-1">
          {item.status !== 'active' && <StatusPill status={item.status} />}
          {item.sudRelated && <StatusBadge tone="warning" size="sm">Part 2</StatusBadge>}
        </span>
        {canAssign && item.status === 'active' && (
          <Button size="sm" onClick={onAssign} icon={<Send />}>
            Send
          </Button>
        )}
      </div>
    </article>
  );
}

function PreviewPane({ item, canAssign, canManage, onClose, onAssign, onEdit, onFavorite, onError }: {
  item: ResourceItemDto; canAssign: boolean; canManage: boolean; onClose: () => void; onAssign: () => void; onEdit: () => void; onFavorite: () => void; onError: (m: string) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  useEffect(() => { markUsed(item.id); }, [item.id]);
  async function download() {
    setDownloading(true);
    try { await downloadItemFile(item); } catch (e) { onError(e instanceof Error ? e.message : 'Download failed'); } finally { setDownloading(false); }
  }
  return (
    <aside aria-label="Resource preview" className="fixed inset-x-0 bottom-0 z-40 max-h-[80vh] overflow-y-auto rounded-t-xl border border-slate-200 bg-white p-5 shadow-xl lg:static lg:z-auto lg:h-fit lg:max-h-none lg:rounded-xl lg:shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500"><KindIcon kind={item.kind} size={14} /> {RESOURCE_KIND_LABEL[item.kind]}</span>
        <IconButton label="Close preview" onClick={onClose} icon={<X size={16} />} className="h-10 w-10 shrink-0 md:h-8 md:w-8 text-slate-500 hover:bg-slate-100" />
      </div>
      <h2 className="mt-1 text-base font-semibold leading-snug text-slate-900">{item.title}</h2>
      {item.summary && <p className="mt-2 text-sm text-slate-700">{item.summary}</p>}
      {(item.contactPhone || item.contactText) && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900">{[item.contactText, item.contactPhone && !item.contactText?.includes(item.contactPhone) ? `Call ${item.contactPhone}` : null].filter(Boolean).join(' · ')}</p>
      )}
      {item.kind === 'article' && item.body && <div className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{item.body}</div>}
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <dt className="text-slate-500">Publisher</dt><dd className="text-slate-800">{item.publisher ?? 'Practice'}</dd>
        <dt className="text-slate-500">Language</dt><dd className="text-slate-800">{languageLabel(item.language)}</dd>
        <dt className="text-slate-500">Audience</dt><dd className="text-slate-800">{item.audiences.length ? item.audiences.map((a) => AUDIENCE_LABEL[a as keyof typeof AUDIENCE_LABEL] ?? a).join(', ') : '—'}</dd>
        <dt className="text-slate-500">Reading level</dt><dd className="text-slate-800">{item.readingLevel ?? 'Not assessed'}</dd>
        <dt className="text-slate-500">Topics</dt><dd className="text-slate-800">{item.topics.map(topicLabel).join(', ') || '—'}</dd>
        <dt className="text-slate-500">Link checked</dt><dd className="text-slate-800">{fmtDate(item.linkCheckedAt)}</dd>
        <dt className="text-slate-500">Clinical review</dt><dd className="text-slate-800">{item.lastReviewedAt ? `${fmtDate(item.lastReviewedAt)}${item.reviewerName ? `, ${item.reviewerName}` : ''}` : 'Not yet reviewed by the practice'}</dd>
        <dt className="text-slate-500">Status</dt><dd><StatusPill status={item.status} /></dd>
      </dl>
      {item.licenseNote && <p className="mt-3 text-xs text-slate-500">{item.licenseNote}</p>}
      {item.sudRelated && (
        <Alert tone="warning" icon={<ShieldAlert />} className="mt-3 text-xs">
          Substance use content: sending it creates a 42 CFR Part 2 record.
        </Alert>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {canAssign && item.status === 'active' && (
          <Button onClick={onAssign} icon={<Send />}>
            Send to client
          </Button>
        )}
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => markUsed(item.id)} className={buttonClasses({ variant: 'secondary' })}>
            <ExternalLink size={15} aria-hidden /> Open link
          </a>
        )}
        {item.hasFile && (
          <Button variant="secondary" onClick={download} disabled={downloading} loading={downloading} icon={<Download />}>
            Download
          </Button>
        )}
        <Button variant="secondary" onClick={onFavorite} icon={<Star className={item.favorite ? 'fill-amber-400 text-amber-500' : ''} />}>
          {item.favorite ? 'Favorited' : 'Favorite'}
        </Button>
        {canManage && (
          <Button variant="secondary" onClick={onEdit} icon={<Pencil />}>
            Edit
          </Button>
        )}
      </div>
    </aside>
  );
}

function SentTab() {
  const [mine, setMine] = useState(true);
  const [rows, setRows] = useState<AssignmentDto[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(() => {
    setRows(null);
    setError('');
    fetchAssignments({ mine })
      .then((r) => { setRows(r.assignments); setHidden(r.hiddenProtected ?? 0); })
      .catch((e: Error) => setError(e.message || 'Could not load'));
  }, [mine]);
  useEffect(load, [load]);
  async function withdraw(id: string) {
    setBusyId(id);
    try {
      const r = await withdrawAssignment(id);
      setRows((rs) => rs?.map((x) => (x.id === id ? r.assignment : x)) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not withdraw');
    } finally {
      setBusyId(null);
    }
  }
  return (
    <section aria-label="Resources sent to clients" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Whose assignments">
        <button type="button" aria-pressed={mine} onClick={() => setMine(true)} className={CHIP(mine)}>Sent by me</button>
        <button type="button" aria-pressed={!mine} onClick={() => setMine(false)} className={CHIP(!mine)}>All in my caseload</button>
        <Link href="/dashboard/reports" className="ml-auto text-sm font-semibold text-blue-700 hover:underline">Reports</Link>
      </div>
      {error && !rows && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
          <ErrorState title="Could not load sent resources" description={error} onRetry={load} />
        </div>
      )}
      {error && rows && <Alert tone="danger">{error}</Alert>}
      {!rows && !error && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
          <LoadingState label="Loading…" rows={4} />
        </div>
      )}
      {rows && rows.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
          <EmptyState compact icon={<Send />} title="Nothing sent yet." description="Resources you send to a client's portal appear here with their status. Open the Library tab and choose Send on a resource." />
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="clinic-scroll-x overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600">
                <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-4 py-3">Client</th>
                <th scope="col" className="px-4 py-3">Resource</th>
                <th scope="col" className="px-4 py-3">Sent</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => (
                <tr key={a.id} className="group hover:bg-slate-50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-3 group-hover:bg-slate-50"><Link href={`/dashboard/clients/${encodeURIComponent(a.clientId)}`} className="font-medium text-slate-900 hover:underline">{a.clientName}</Link></td>
                  <td className="px-4 py-2.5 text-slate-700">{a.itemTitle}{a.part2 && <StatusBadge tone="warning" size="sm" className="ml-2">Part 2</StatusBadge>}</td>
                  <td className="px-4 py-2.5 text-slate-600">{fmtDate(a.sentAt ?? a.createdAt)}</td>
                  <td className="px-4 py-3"><StatusPill status={a.status} /></td>
                  <td className="px-4 py-2.5 text-right">
                    {(a.status === 'sent' || a.status === 'viewed') && (
                      <button type="button" disabled={busyId === a.id} onClick={() => withdraw(a.id)} className={cx('inline-flex min-h-10 items-center rounded px-2 text-xs font-semibold text-slate-600 hover:text-rose-700 disabled:opacity-50 md:min-h-8', FOCUS_RING)}>Withdraw</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hidden > 0 && <p className="text-xs text-slate-500">{hidden} protected record{hidden === 1 ? '' : 's'} you cannot open {hidden === 1 ? 'is' : 'are'} not shown.</p>}
    </section>
  );
}
