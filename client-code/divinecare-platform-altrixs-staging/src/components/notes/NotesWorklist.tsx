'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock,
  FilePlus,
  Filter,
  Lock,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Undo2,
  Video,
  X,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { NOTE_LABELS, NOTE_TYPES, noteTypeBadge } from '@/lib/ehr/noteTemplates';
import { ClientAvatar } from '@/components/clinic/ClientAvatar';
import { Button, buttonClasses, EmptyState, ErrorState, IconButton, LoadingState, Tabs } from '@/components/ui';
import { DismissNoteDialog } from '@/components/notes/DismissNoteDialog';
import { InlineSignNote } from '@/components/notes/InlineSignNote';

export type WorklistTabKey = 'missing' | 'drafts' | 'ready' | 'cosign' | 'returned' | 'signed' | 'all' | 'escalated';
export const WORKLIST_TAB_KEYS: readonly WorklistTabKey[] = ['missing', 'drafts', 'ready', 'cosign', 'returned', 'signed', 'all', 'escalated'];

/** Row shape of GET /api/notes/worklist (src/lib/notes/worklist.ts) */
export type WorklistRow = {
  kind: 'note' | 'missing';
  noteId: string | null;
  appointmentId: string | null;
  clientId: string;
  clientName: string;
  clientImage: string | null;
  dateOfService: string | null;
  noteType: string | null;
  cptCode: string | null;
  durationMinutes: number | null;
  status: 'Draft' | 'Signed' | 'Locked' | 'Missing';
  clinicianId: string | null;
  clinicianName: string | null;
  locationName: string | null;
  daysSinceService: number | null;
  timeliness: 'no_dos' | 'due' | 'due_soon' | 'overdue' | 'signed_on_time' | 'late_entry';
  dueAt: string | null;
  lateEntryLabel: string | null;
  billingStatus: string | null;
  claimId: string | null;
  part2: boolean;
  aiDrafted: boolean;
  telehealth: boolean;
  nextStep: string | null;
  /** My unsigned note with nothing blocking signature: inline Sign */
  readyToSign?: boolean;
  stale: boolean;
  cosignRequired: boolean;
  cosignedAt: string | null;
  cosignRole: 'reviewer' | 'author' | null;
  returnedComment: string | null;
  returnedBy: string | null;
  returnedAt: string | null;
  appointmentStartsAt: string | null;
  /** Dismissed unsigned note (All notes + Include dismissed): read-only */
  dismissedAt: string | null;
  dismissedByName: string | null;
  dismissReason: string | null;
  canUndoDismiss: boolean;
};

type WorklistResponse = {
  success: true;
  tab: WorklistTabKey;
  rows: WorklistRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<WorklistTabKey, number>;
  overdue: number;
  dueSoon: number;
  escalation: { visible: boolean; overdueDays: number };
  policy: { deadlineHours: number; dueSoonHours: number; staleDraftDays: number; cloneWarnPercent: number; requireDiagnosisToSign: boolean; timeZone: string };
  facets: { clinicians: { id: string; name: string }[]; locations: { id: string; name: string }[]; programs: string[] };
  canReviewCosign: boolean;
};

const TABS: { key: WorklistTabKey; label: string; hint: string }[] = [
  { key: 'missing', label: 'To write', hint: 'Your past visits (30 days) with no note yet' },
  { key: 'drafts', label: 'Drafts', hint: 'Your unsigned notes with something left to complete' },
  { key: 'ready', label: 'Awaiting my signature', hint: 'Your drafts with nothing blocking signature' },
  { key: 'cosign', label: 'Awaiting co-sign', hint: 'Notes waiting for your co-signature, and yours waiting for a supervisor' },
  { key: 'returned', label: 'Returned', hint: 'Your notes a supervisor returned for correction' },
  { key: 'signed', label: 'Signed', hint: 'Your signed and locked notes' },
  { key: 'all', label: 'All notes', hint: 'Every note you can see (organization and caseload rules apply)' },
  {
    key: 'escalated',
    label: 'Overdue > 7 days',
    hint: 'Supervisor view: unsigned notes more than 7 days past due by clinicians you supervise (directors: clinicians with no assigned supervisor)',
  },
];

const PROGRAM_LABELS: Record<string, string> = { therapy: 'Therapy', psychiatry: 'Psychiatry', sud: 'SUD (Part 2)', group: 'Group', crisis: 'Crisis', prp: 'PRP', peer_support: 'Peer Support' };
const BILLING_LABELS: Record<string, string> = { none: 'No claim yet', DRAFT: 'Claim draft', READY: 'Claim ready', SUBMITTED: 'Submitted', ACCEPTED: 'Accepted', DENIED: 'Denied', PAID: 'Paid' };

const STATUS_STYLES: Record<WorklistRow['status'], string> = {
  Draft: 'bg-amber-100 text-amber-700 border-amber-200',
  Signed: 'bg-blue-100 text-blue-700 border-blue-200',
  Locked: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Missing: 'bg-slate-100 text-slate-700 border-slate-200',
};

type Filters = {
  search: string;
  clientId: string;
  from: string;
  to: string;
  noteType: string;
  clinicianId: string;
  locationId: string;
  program: string;
  status: string;
  billing: string;
  part2: string;
  /** 'include' = All notes also lists dismissed notes */
  dismissed: string;
  sort: string;
};

const EMPTY_FILTERS: Filters = { search: '', clientId: '', from: '', to: '', noteType: '', clinicianId: '', locationId: '', program: '', status: '', billing: '', part2: '', dismissed: '', sort: 'dos_desc' };

function dueText(row: WorklistRow): string | null {
  if (row.dismissedAt) return null;
  if (row.status === 'Missing' || row.status === 'Draft') {
    if (!row.dueAt) return null;
    const ms = new Date(row.dueAt).getTime() - Date.now();
    const h = Math.round(Math.abs(ms) / 3_600_000);
    const span = h >= 48 ? `${Math.round(h / 24)} d` : `${h} h`;
    if (ms < 0) return `Overdue ${span}`;
    return row.timeliness === 'due_soon' ? `Due soon: ${span}` : `Due in ${span}`;
  }
  return null;
}

export function NotesWorklist({
  clients,
  initialClientId,
  initialTab,
  refreshKey,
  onOpenNote,
  onStartVisit,
  onNotesChanged,
}: {
  clients: { id: string; name: string }[];
  initialClientId?: string;
  initialTab?: WorklistTabKey;
  refreshKey: number;
  /** mode 'edit' = continue the draft in the editor; 'view' = open the note (review / sign / addendum) */
  onOpenNote: (row: WorklistRow, mode: 'edit' | 'view') => void;
  onStartVisit: (row: WorklistRow) => void;
  /** A note was dismissed / restored here: the page refreshes its note feed */
  onNotesChanged?: () => void;
}) {
  const [tab, setTab] = useState<WorklistTabKey>(initialTab ?? (initialClientId ? 'all' : 'drafts'));
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, clientId: initialClientId || '' });
  const [searchDraft, setSearchDraft] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<WorklistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(Boolean(initialClientId));
  const autoTabbed = useRef(Boolean(initialTab || initialClientId));
  const reqId = useRef(0);
  /** Row whose "Dismiss note" dialog is open */
  const [dismissRow, setDismissRow] = useState<WorklistRow | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // Debounced search box
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchDraft.trim() ? f : { ...f, search: searchDraft.trim() }));
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchDraft]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ tab, page: String(page), pageSize: '25' });
    for (const [k, v] of Object.entries(filters)) if (v && (k !== 'dismissed' || tab === 'all')) qs.set(k, v);
    try {
      const res = await apiJson<WorklistResponse>(`/api/notes/worklist?${qs.toString()}`);
      if (id !== reqId.current) return;
      setData(res);
      // First visit with an empty personal queue (e.g. directors): show all notes instead
      if (!autoTabbed.current) {
        autoTabbed.current = true;
        const mine = res.counts.missing + res.counts.drafts + res.counts.ready + res.counts.cosign + res.counts.returned;
        if (tab === 'drafts' && res.counts.drafts === 0) {
          if (res.counts.ready > 0) setTab('ready');
          else if (res.counts.missing > 0) setTab('missing');
          else if (mine === 0 && res.counts.signed === 0 && res.counts.all > 0) setTab('all');
        }
      }
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof Error ? e.message : 'Could not load notes');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [tab, page, filters]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const undoDismiss = async (row: WorklistRow) => {
    if (!row.noteId) return;
    setRowError(null);
    try {
      await apiJson(`/api/notes/${encodeURIComponent(row.noteId)}/dismiss`, { method: 'DELETE' });
      onNotesChanged?.();
      void load();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Could not undo the dismissal');
    }
  };

  const setFilter = (k: keyof Filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  const activeFilterCount = useMemo(
    () => Object.entries(filters).filter(([k, v]) => v && k !== 'sort' && k !== 'search' && k !== 'dismissed').length,
    [filters]
  );
  const counts = data?.counts;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const select =
    'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';
  const clientName = filters.clientId ? clients.find((c) => c.id === filters.clientId)?.name : null;

  return (
    <section aria-label="Notes worklist" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
      <Tabs
          label="Note queues"
          controlsPanels={false}
          value={tab}
          onChange={(key) => {
            setTab(key);
            setPage(1);
          }}
          items={TABS.filter((t) => t.key !== 'escalated' || data?.escalation.visible || tab === 'escalated').map((t) => {
            const n = counts?.[t.key];
            const urgent = (t.key === 'returned' || t.key === 'cosign' || t.key === 'escalated') && (n ?? 0) > 0;
            return { key: t.key, label: t.label, hint: t.hint, count: n ?? undefined, countTone: urgent ? 'attention' : 'neutral' };
          })}
          className="px-3 pt-2"
        />

      {/* Policy + search + filters */}
      <div className="space-y-3 border-b border-slate-100 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
            <input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search client, MRN or clinician…"
              aria-label="Search notes"
              className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm text-slate-900 shadow-xs placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
          </label>
          <Button variant="secondary" icon={<Filter />} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </Button>
          <select aria-label="Sort" value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)} className={select}>
            <option value="dos_desc">Newest service date</option>
            <option value="dos_asc">Oldest service date</option>
            <option value="client">Client A–Z</option>
          </select>
          {tab === 'all' ? (
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600" title="Dismissed unsigned notes, read-only (leadership: all; others: your own)">
              <input
                type="checkbox"
                checked={filters.dismissed === 'include'}
                onChange={(e) => setFilter('dismissed', e.target.checked ? 'include' : '')}
                className="accent-blue-600"
              />
              Include dismissed
            </label>
          ) : null}
          <IconButton
            label="Refresh"
            onClick={() => void load()}
            disabled={loading}
            className="h-9 w-9 border border-slate-300 bg-white text-slate-600 shadow-xs hover:bg-slate-50"
            icon={<RefreshCw size={16} className={loading ? 'animate-spin' : ''} />}
          />
        </div>
        {clientName ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">Client: {clientName}</span>
            <button type="button" onClick={() => setFilter('clientId', '')} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">
              <X size={12} /> Show all clients
            </button>
          </div>
        ) : null}
        {showFilters ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select aria-label="Client" value={filters.clientId} onChange={(e) => setFilter('clientId', e.target.value)} className={select}>
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-500">
              From
              <input type="date" aria-label="Service date from" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} className={`${select} flex-1`} />
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-500">
              To
              <input type="date" aria-label="Service date to" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} className={`${select} flex-1`} />
            </label>
            <select aria-label="Note type" value={filters.noteType} onChange={(e) => setFilter('noteType', e.target.value)} className={select}>
              <option value="">All note types</option>
              {NOTE_TYPES.map((t) => (
                <option key={t} value={t}>{NOTE_LABELS[t] || t}</option>
              ))}
            </select>
            <select aria-label="Clinician" value={filters.clinicianId} onChange={(e) => setFilter('clinicianId', e.target.value)} className={select}>
              <option value="">All clinicians</option>
              {(data?.facets.clinicians || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select aria-label="Location" value={filters.locationId} onChange={(e) => setFilter('locationId', e.target.value)} className={select}>
              <option value="">All locations</option>
              {(data?.facets.locations || []).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <select aria-label="Program" value={filters.program} onChange={(e) => setFilter('program', e.target.value)} className={select}>
              <option value="">All programs</option>
              {(data?.facets.programs || Object.keys(PROGRAM_LABELS)).map((p) => (
                <option key={p} value={p}>{PROGRAM_LABELS[p] || p}</option>
              ))}
            </select>
            <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={select}>
              <option value="">Any status</option>
              <option value="Draft">Draft</option>
              <option value="Signed">Signed</option>
              <option value="Locked">Locked</option>
            </select>
            <select aria-label="Billing status" value={filters.billing} onChange={(e) => setFilter('billing', e.target.value)} className={select}>
              <option value="">Any billing status</option>
              {Object.entries(BILLING_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select aria-label="42 CFR Part 2" value={filters.part2} onChange={(e) => setFilter('part2', e.target.value)} className={select}>
              <option value="">Part 2 and non-Part 2</option>
              <option value="yes">Part 2 (SUD) only</option>
              <option value="no">Exclude Part 2</option>
            </select>
            <button
              type="button"
              onClick={() => {
                setFilters({ ...EMPTY_FILTERS });
                setSearchDraft('');
                setPage(1);
              }}
              className={buttonClasses({ variant: 'secondary' })}
            >
              <RotateCcw size={13} aria-hidden /> Clear filters
            </button>
          </div>
        ) : null}
        {data ? (
          <p className="text-xs text-slate-500">
            Practice policy: notes are due {data.policy.deadlineHours} hours after the service ends (&quot;due soon&quot; in the last {data.policy.dueSoonHours} hours).
            Signed later = labeled a late entry, with the reason. Unsigned more than {data.escalation.overdueDays} days past due = escalated to the supervisor.
            {data.overdue ? <strong className="ml-1 text-rose-700">{data.overdue} of your unsigned notes are overdue.</strong> : null}
            {data.dueSoon ? <strong className="ml-1 text-amber-700">{data.dueSoon} due soon.</strong> : null}
          </p>
        ) : null}
      </div>

      {rowError ? <p role="alert" className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700">{rowError}</p> : null}
      {/* Rows */}
      {error ? (
        <ErrorState title="Could not load notes" description={error} onRetry={() => void load()} />
      ) : loading && !data ? (
        <LoadingState label="Loading notes…" rows={5} />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState
          compact
          title={
            tab === 'missing'
              ? 'Every visit in the last 30 days has a note.'
              : tab === 'returned'
                ? 'No notes returned for correction.'
                : tab === 'escalated'
                  ? 'No notes more than 7 days past due are escalated to you.'
                  : 'No notes here.'
          }
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.rows.map((row) => {
            const due = dueText(row);
            const key = row.noteId || `appt-${row.appointmentId}`;
            const dismissed = Boolean(row.dismissedAt);
            const isDraft = row.status === 'Draft' && !dismissed;
            return (
              <li key={key} className="grid gap-2 px-4 py-3 hover:bg-slate-50 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_auto] md:items-center">
                {/* Client + badges */}
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-2 text-left"
                  onClick={() => (row.kind === 'missing' ? onStartVisit(row) : onOpenNote(row, isDraft && row.cosignRole == null && tab !== 'escalated' ? 'edit' : 'view'))}
                >
                  <ClientAvatar name={row.clientName} image={row.clientImage} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">{row.clientName}</span>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {row.part2 ? <span className="rounded border border-amber-200 bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-800">Part 2</span> : null}
                      {row.aiDrafted ? (
                        <span className="inline-flex items-center gap-0.5 rounded border border-blue-200 bg-blue-50 px-1.5 text-[11px] font-semibold text-blue-700">
                          <Bot size={10} aria-hidden /> AI draft
                        </span>
                      ) : null}
                      {row.telehealth ? (
                        <span className="inline-flex items-center gap-0.5 rounded border border-slate-200 px-1.5 text-[11px] text-slate-600">
                          <Video size={10} aria-hidden /> Telehealth
                        </span>
                      ) : null}
                      {row.lateEntryLabel ? (
                        <span title={row.lateEntryLabel} className="inline-flex items-center gap-0.5 rounded border border-amber-200 bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-800">
                          <Clock size={10} aria-hidden /> Late entry
                        </span>
                      ) : null}
                      {row.stale ? <span className="rounded border border-slate-300 bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-700">Stale draft</span> : null}
                      {row.cosignRequired && !row.cosignedAt && row.status !== 'Draft' ? (
                        <span className="inline-flex items-center gap-0.5 rounded border border-blue-200 bg-blue-50 px-1.5 text-[11px] font-semibold text-blue-600">
                          <ShieldCheck size={10} aria-hidden /> Co-sign pending
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>

                {/* Service */}
                <div className="text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">
                    {row.dateOfService ? `DOS ${row.dateOfService}` : 'No DOS'}
                    {row.daysSinceService != null && row.daysSinceService > 0 ? <span className="font-normal text-slate-500"> · {row.daysSinceService} d ago</span> : null}
                  </p>
                  <p className="truncate">
                    {row.noteType ? noteTypeBadge(row.noteType) : '—'}
                    {row.cptCode ? ` · ${row.cptCode}` : ''}
                    {row.durationMinutes ? ` · ${row.durationMinutes} min` : ''}
                  </p>
                  {row.clinicianName ? <p className="truncate text-slate-500">{row.clinicianName}</p> : null}
                </div>

                {/* Status */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className={`rounded-full border px-2 py-0.5 font-semibold ${STATUS_STYLES[row.status]}`}>
                    {row.status === 'Locked' ? <Lock size={10} className="mr-0.5 inline" aria-hidden /> : null}
                    {row.status === 'Missing' ? 'No note' : dismissed ? 'Dismissed' : row.status}
                  </span>
                  {dismissed ? (
                    <p className="w-full text-[11px] text-slate-500" title={row.dismissReason || ''}>
                      Dismissed {row.dismissedAt?.slice(0, 10)}{row.dismissedByName ? ` by ${row.dismissedByName}` : ''}{row.dismissReason ? `: ${row.dismissReason}` : ''}
                    </p>
                  ) : null}
                  {due ? (
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        due.startsWith('Overdue') ? 'bg-rose-50 text-rose-700' : due.startsWith('Due soon') ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {due.startsWith('Overdue') ? <AlertTriangle size={10} className="mr-0.5 inline" aria-hidden /> : null}
                      {due}
                    </span>
                  ) : null}
                  {row.kind === 'note' && row.status !== 'Draft' ? (
                    <span className="rounded-full bg-slate-50 px-2 py-0.5 text-slate-600">{BILLING_LABELS[row.billingStatus || 'none'] || row.billingStatus}</span>
                  ) : null}
                  {row.nextStep && isDraft ? <p className="w-full truncate text-[11px] text-amber-700" title={row.nextStep}>Next: {row.nextStep}</p> : null}
                  {row.returnedComment || row.returnedBy ? (
                    <p className="w-full text-[11px] text-rose-700" title={row.returnedComment || ''}>
                      Returned by {row.returnedBy || 'supervisor'}{row.returnedComment ? `: ${row.returnedComment}` : ''}
                    </p>
                  ) : null}
                  {row.cosignRole === 'author' ? <p className="w-full text-[11px] text-slate-500">Waiting for your supervisor</p> : null}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap justify-end gap-1.5">
                  {row.kind === 'missing' ? (
                    <button type="button" onClick={() => onStartVisit(row)} className={buttonClasses({ size: 'sm' })}>
                      <FilePlus size={13} aria-hidden /> Start note
                    </button>
                  ) : row.cosignRole === 'reviewer' ? (
                    <Link href={`/dashboard/ehr/supervisor-review?noteId=${encodeURIComponent(row.noteId as string)}`} className={buttonClasses({ size: 'sm' })}>
                      Review &amp; co-sign
                    </Link>
                  ) : dismissed ? (
                    <>
                      <button type="button" onClick={() => onOpenNote(row, 'view')} className={buttonClasses({ size: 'sm', variant: 'secondary' })}>
                        Open
                      </button>
                      {row.canUndoDismiss ? (
                        <button type="button" onClick={() => void undoDismiss(row)} className={buttonClasses({ size: 'sm', variant: 'secondary' })}>
                          <Undo2 size={13} aria-hidden /> Undo dismiss
                        </button>
                      ) : null}
                    </>
                  ) : isDraft && tab !== 'escalated' && row.readyToSign && row.noteId ? (
                    <>
                      {/* Nothing blocking signature: sign here without opening the note */}
                      <InlineSignNote
                        noteId={row.noteId}
                        clientName={row.clientName}
                        ready
                        lateEntryRequired={row.timeliness === 'overdue'}
                        openHref={`/dashboard/ehr/notes?openNote=${encodeURIComponent(row.noteId)}&filterClient=${encodeURIComponent(row.clientId)}`}
                        onSigned={() => {
                          onNotesChanged?.();
                          void load();
                        }}
                      />
                      <button type="button" onClick={() => onOpenNote(row, 'view')} className={buttonClasses({ size: 'sm', variant: 'secondary' })}>
                        Review
                      </button>
                      <IconButton
                        label="Dismiss note"
                        onClick={() => setDismissRow(row)}
                        className="h-8 w-8 border border-slate-300 bg-white text-slate-600 shadow-xs hover:bg-rose-50 hover:text-rose-700"
                        icon={<Trash2 size={14} />}
                      />
                    </>
                  ) : isDraft && tab !== 'escalated' ? (
                    <>
                      <button type="button" onClick={() => onOpenNote(row, 'edit')} className={buttonClasses({ size: 'sm' })}>
                        Continue
                      </button>
                      <button type="button" onClick={() => onOpenNote(row, 'view')} className={buttonClasses({ size: 'sm', variant: 'secondary' })}>
                        Review &amp; sign
                      </button>
                      <IconButton
                        label="Dismiss note"
                        onClick={() => setDismissRow(row)}
                        className="h-8 w-8 border border-slate-300 bg-white text-slate-600 shadow-xs hover:bg-rose-50 hover:text-rose-700"
                        icon={<Trash2 size={14} />}
                      />
                    </>
                  ) : (
                    <button type="button" onClick={() => onOpenNote(row, 'view')} className={buttonClasses({ size: 'sm', variant: 'secondary' })}>
                      {row.status === 'Signed' && tab === 'returned' ? 'Open and correct' : 'Open'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dismissRow?.noteId ? (
        <DismissNoteDialog
          noteId={dismissRow.noteId}
          clientName={dismissRow.clientName}
          onCancel={() => setDismissRow(null)}
          onDismissed={() => {
            setDismissRow(null);
            onNotesChanged?.();
            void load();
          }}
        />
      ) : null}

      {/* Pagination */}
      {data && data.total > data.pageSize ? (
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
          <span>
            {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </span>
          <span className="flex gap-1">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous page">
              <ChevronLeft size={14} />
            </button>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next page">
              <ChevronRight size={14} />
            </button>
          </span>
        </div>
      ) : data ? (
        <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">{data.total} {data.total === 1 ? 'item' : 'items'}</div>
      ) : null}
    </section>
  );
}
