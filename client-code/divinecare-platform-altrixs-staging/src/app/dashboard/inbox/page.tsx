'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FileSignature,
  FileText,
  FlaskConical,
  Inbox,
  Info,
  ListTodo,
  Lock,
  Trash2,
  MessageSquare,
  Pill,
  RefreshCw,
  ShieldAlert,
  CalendarClock,
  Radar,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { buttonClasses } from '@/components/ui';
import { useInboxCounts } from '@/features/inbox';
import { InlineSignNote } from '@/components/notes/InlineSignNote';
import { DismissNoteDialog } from '@/components/notes/DismissNoteDialog';
import type { InboxGroupKey, InboxItem, InboxPriority, InboxSectionKey } from '@/lib/inbox/types';

type Filter = 'all' | InboxSectionKey;

type ItemsResponse = {
  success: true;
  items: InboxItem[];
  total: number;
  page: number;
  pageSize: number;
  notice: string | null;
  failedSections: string[];
  /** Collapsed secondary groups of the section (not counted in the badge) */
  groups?: { key: InboxGroupKey; label: string; total: number; items: InboxItem[] }[];
};

const PAGE_SIZE = 25;
/** "All documents" toggle, remembered on this device */
const ALL_DOCS_KEY = 'altrixs.inbox.allDocuments.v1';

const SECTION_ICON: Record<InboxSectionKey, LucideIcon> = {
  alerts: ShieldAlert,
  rx_requests: Pill,
  lab_results: FlaskConical,
  messages: MessageSquare,
  unsigned_notes: FileSignature,
  group_notes: Users,
  cosign: ClipboardCheck,
  plans_needed: ClipboardList,
  session_frequency: CalendarClock,
  sud_radar: Radar,
  measures: ClipboardCheck,
  documents: FileText,
  authorizations: AlertTriangle,
  timely_filing: CalendarClock,
  waitlist_offer: CalendarClock,
  identity_verify: ShieldAlert,
  medicaid_attestations: FileSignature,
  consents_needed: FileSignature,
  tasks: ListTodo,
};

const PRIORITY_STYLE: Record<InboxPriority, { label: string; className: string }> = {
  urgent: { label: 'Urgent', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  high: { label: 'High', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
  normal: { label: 'Normal', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
  low: { label: 'Low', className: 'bg-slate-50 text-slate-500 ring-slate-200' },
};

function ageLabel(since: string | null, now: number): string | null {
  if (!since) return null;
  const t = Date.parse(since);
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function QuickAction({ item, onDone }: { item: InboxItem; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const action = item.action;
  if (!action) return null;

  // Unsigned note: sign in place when nothing blocks it (else "Open to finish"), or dismiss it
  if (action.kind === 'unsigned_note') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <InlineSignNote noteId={action.noteId} clientName={item.clientDisplay} openHref={item.href} onSigned={onDone} />
        <button type="button" onClick={() => setDismissing(true)} className={buttonClasses({ size: 'sm', variant: 'secondary' })}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Dismiss
        </button>
        {dismissing ? (
          <DismissNoteDialog
            noteId={action.noteId}
            clientName={item.clientDisplay}
            onCancel={() => setDismissing(false)}
            onDismissed={() => {
              setDismissing(false);
              onDone();
            }}
          />
        ) : null}
      </div>
    );
  }

  // Accepted AI Scribe follow-up: one click to mark it done
  if (action.kind === 'complete_follow_up') {
    const markDone = async () => {
      setSaving(true);
      setError(null);
      try {
        await apiJson('/api/scribe/follow-ups', { method: 'PATCH', body: JSON.stringify({ id: action.followUpId, status: 'DONE' }) });
        onDone();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Could not complete the To-Do');
      } finally {
        setSaving(false);
      }
    };
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={saving} onClick={() => void markDone()} className={buttonClasses({ size: 'sm', variant: 'secondary' })}>
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {saving ? 'Saving…' : 'Mark done'}
        </button>
        {error && <p className="text-xs text-rose-700">{error}</p>}
      </div>
    );
  }

  const minLength = action.kind === 'ack_mbc_alert' ? 1 : action.kind === 'ack_lab_result' ? 0 : action.noteRequired ? 8 : 0;
  const label =
    action.kind === 'ack_mbc_alert' || action.kind === 'ack_lab_result'
      ? 'Acknowledge'
      : action.kind === 'verify_identity'
        ? 'Mark identity verified'
        : 'Mark reviewed';
  const placeholder =
    action.kind === 'ack_mbc_alert'
      ? 'Clinician response (required)'
      : action.kind === 'ack_lab_result'
        ? action.critical
          ? 'Sign-off note (optional; document the follow-up for a critical result)'
          : 'Sign-off note (optional)'
        : action.kind === 'verify_identity'
          ? 'How identity was verified (required, e.g. photo ID and DOB at check-in)'
          : action.noteRequired
            ? 'Documented response (required for high severity, at least 8 characters)'
            : 'Response note (optional)';

  const submit = async () => {
    if (note.trim().length < minLength) {
      setError(minLength > 1 ? `Enter at least ${minLength} characters.` : 'A response is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (action.kind === 'verify_identity') {
        await apiJson(`/api/clients/${encodeURIComponent(action.clientId)}/identity-verified`, {
          method: 'POST',
          body: JSON.stringify({ note: note.trim() }),
        });
      } else if (action.kind === 'ack_lab_result') {
        await apiJson(`/api/labs/orders/${encodeURIComponent(action.labOrderId)}/review`, {
          method: 'POST',
          body: JSON.stringify({ note: note.trim() || null }),
        });
      } else if (action.kind === 'review_risk_alert') {
        await apiJson(`/api/risk-alerts/${encodeURIComponent(action.alertId)}/review`, {
          method: 'PATCH',
          body: JSON.stringify({ note: note.trim() || null }),
        });
      } else {
        const res = await fetch('/api/clinical/mbc/alerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assessmentRecordId: action.assessmentRecordId, notes: note.trim() }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.success === false) throw new Error(body.error || 'Could not acknowledge alert');
      }
      setOpen(false);
      setNote('');
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-blue-600/30 px-2.5 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-600/5 md:min-h-8"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        {label}
      </button>
    );
  }
  return (
    <div className="mt-2 w-full space-y-2">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
      />
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void submit()}
          className="min-h-10 rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60 md:min-h-8"
        >
          {saving ? 'Saving…' : label}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="min-h-10 rounded-lg px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 md:min-h-8"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ItemRow({ item, now, showSection, sectionLabel, onChanged }: {
  item: InboxItem;
  now: number;
  showSection: boolean;
  sectionLabel: string;
  onChanged: () => void;
}) {
  const p = PRIORITY_STYLE[item.priority];
  const Icon = SECTION_ICON[item.section];
  const age = ageLabel(item.since, now);
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ring-1 ${p.className}`}>
            {p.label}
          </span>
          <span className="min-w-0 break-words text-sm font-semibold text-slate-900">{item.title}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          {item.clientDisplay && (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1 break-words font-medium text-slate-700">
              {item.protected && <Lock className="h-3 w-3" aria-label="Protected record" />}
              {item.clientDisplay}
            </span>
          )}
          {showSection && <span>{sectionLabel}</span>}
          {age && <span title={item.since ?? undefined}>{age} old</span>}
        </div>
        {item.detail && <p className="mt-1 break-words text-sm text-slate-600">{item.detail}</p>}
        <QuickAction item={item} onDone={onChanged} />
      </div>
      <Link
        href={item.href}
        className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-600/5 md:min-h-8"
      >
        {item.hrefLabel}
        <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </li>
  );
}

export default function InboxPage() {
  const counts = useInboxCounts();
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ItemsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [allDocs, setAllDocs] = useState(false);
  useEffect(() => {
    try {
      setAllDocs(localStorage.getItem(ALL_DOCS_KEY) === '1');
    } catch {
      /* storage blocked: default off */
    }
  }, []);
  const toggleAllDocs = () =>
    setAllDocs((prev) => {
      try {
        localStorage.setItem(ALL_DOCS_KEY, prev ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !prev;
    });

  // Deep link from the role home tiles: /dashboard/inbox?section=unsigned_notes
  const [linkedSection, setLinkedSection] = useState<string | null>(null);
  useEffect(() => {
    setLinkedSection(new URLSearchParams(window.location.search).get('section'));
  }, []);
  useEffect(() => {
    if (!linkedSection) return;
    if (counts.sections.some((s) => s.key === linkedSection)) {
      setFilter(linkedSection as Filter);
      setPage(1);
      setLinkedSection(null);
    }
  }, [linkedSection, counts.sections]);

  const labels = useMemo(
    () => Object.fromEntries(counts.sections.map((s) => [s.key, s.label])) as Record<string, string>,
    [counts.sections]
  );
  const current = filter === 'all' ? null : counts.sections.find((s) => s.key === filter) ?? null;
  const currentCount = filter === 'all' ? counts.summary?.total : current?.count;

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ section: filter, page: String(page), pageSize: String(PAGE_SIZE) });
      setData(await apiJson<ItemsResponse>(`/api/inbox/items?${qs}`));
      setNow(Date.now());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load inbox');
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  // When the 60s count refresh shows this list changed, reload it
  useEffect(() => {
    if (data && currentCount != null && currentCount !== data.total) void loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCount]);

  const afterAction = () => {
    void loadItems();
    void counts.refresh();
  };
  // Done in place: hide the row right away (the count and list catch up on reload)
  const [doneKeys, setDoneKeys] = useState<Set<string>>(() => new Set());
  const afterItemAction = (item: InboxItem) => {
    setDoneKeys((prev) => new Set(prev).add(item.entityKey));
    afterAction();
  };
  const notDone = (item: InboxItem) => !doneKeys.has(item.entityKey);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filterLabel = filter === 'all' ? 'All' : labels[filter] ?? 'Section';

  const filters: { key: Filter; label: string; count: number | null | undefined; urgent: number; error: boolean }[] = [
    { key: 'all', label: 'All', count: counts.summary?.total, urgent: counts.urgent, error: false },
    ...counts.sections.map((s) => ({ key: s.key as Filter, label: s.label, count: s.count, urgent: s.urgent, error: Boolean(s.error) })),
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
            <Inbox className="h-6 w-6 text-blue-600" />
            Inbox
          </h1>
          <p className="text-sm text-slate-500">Everything waiting on you today, most urgent and oldest first</p>
        </div>
        <button
          type="button"
          onClick={afterAction}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Inbox sections" className="min-w-0 rounded-xl border border-slate-200 bg-white p-2">
          {counts.loading && !counts.summary ? (
            <p className="px-2 py-3 text-sm text-slate-500">Loading sections…</p>
          ) : counts.error && !counts.summary ? (
            <p className="px-2 py-3 text-sm text-rose-600">{counts.error}</p>
          ) : (
            <ul className="space-y-0.5">
              {filters.map((f) => {
                const active = filter === f.key;
                const Icon = f.key === 'all' ? Inbox : SECTION_ICON[f.key];
                return (
                  <li key={f.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setFilter(f.key);
                        setPage(1);
                      }}
                      className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm md:min-h-0 ${
                        active ? 'bg-blue-600/10 font-semibold text-blue-600' : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate">{f.label}</span>
                      {f.error ? (
                        <span title="Could not load"><AlertTriangle className="h-3.5 w-3.5 text-amber-700" /></span>
                      ) : (
                        <span
                          className={`min-w-[1.5rem] rounded-full px-1.5 text-center text-xs font-semibold ${
                            f.urgent > 0 ? 'bg-rose-500 text-white' : f.count ? 'bg-slate-200 text-slate-700' : 'text-slate-400'
                          }`}
                        >
                          {f.count ?? '–'}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {counts.summary && (
            <p className="mt-2 px-2 text-[11px] text-slate-500">
              Counts refresh every minute · updated{' '}
              {new Date(counts.summary.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </p>
          )}
        </nav>

        <section className="min-w-0 rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-800">
              {filterLabel}
              {data ? ` · ${data.total}` : ''}
            </h2>
            {data && data.total > PAGE_SIZE && (
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex h-10 w-10 items-center justify-center rounded hover:bg-slate-100 disabled:opacity-40 md:h-8 md:w-8"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                Page {page} of {pages}
                <button
                  type="button"
                  aria-label="Next page"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  className="inline-flex h-10 w-10 items-center justify-center rounded hover:bg-slate-100 disabled:opacity-40 md:h-8 md:w-8"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          {(current?.notice || data?.notice) && (
            <p className="flex items-start gap-2 border-b border-slate-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {current?.notice || data?.notice}
            </p>
          )}
          {data && data.failedSections.length > 0 && (
            <p className="flex items-start gap-2 border-b border-slate-100 bg-rose-50 px-4 py-2 text-xs text-rose-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Could not load: {data.failedSections.map((k) => labels[k] ?? k).join(', ')}. These items are not shown.
            </p>
          )}

          {loading && !data ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">Loading…</p>
          ) : error ? (
            <p className="px-4 py-10 text-center text-sm text-rose-600">{error}</p>
          ) : data && data.items.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-sky-700" />
              <p className="mt-2 text-sm font-medium text-slate-700">
                {data.failedSections.length ? 'Nothing to show from the sections that loaded' : 'Nothing waiting here'}
              </p>
              <p className="text-xs text-slate-500">
                {filter === 'all'
                  ? 'No items in any section you have access to.'
                  : current?.label
                    ? `No items in ${current.label}.`
                    : ''}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data?.items.filter(notDone).map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  now={now}
                  showSection={filter === 'all'}
                  sectionLabel={labels[item.section] ?? ''}
                  onChanged={() => afterItemAction(item)}
                />
              ))}
            </ul>
          )}

          {filter !== 'all' && data?.groups?.map((g) =>
            g.key === 'all_documents' ? (
              <div key={g.key} className="border-t border-slate-200">
                <label className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-800">
                  <input type="checkbox" checked={allDocs} onChange={toggleAllDocs} />
                  All documents
                  <span className="text-xs font-normal text-slate-500">
                    {g.total} more not assigned to you or your patients
                  </span>
                </label>
                {allDocs && (
                  <ul className="divide-y divide-slate-100 border-t border-slate-100">
                    {g.items.filter(notDone).map((item) => (
                      <ItemRow key={item.id} item={item} now={now} showSection={false} sectionLabel="" onChanged={() => afterItemAction(item)} />
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <details key={g.key} className="border-t border-slate-200">
                <summary className="min-h-10 cursor-pointer px-4 py-2.5 text-sm font-semibold text-slate-800">
                  {g.label} ({g.total})
                  <span className="ml-1 text-xs font-normal text-slate-500">
                    {g.key === 'likely_inactive'
                      ? 'no appointment or note in 180 days; not counted as overdue'
                      : 'imported documents waiting for a patient match; not counted'}
                  </span>
                </summary>
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {g.items.filter(notDone).map((item) => (
                    <ItemRow key={item.id} item={item} now={now} showSection={false} sectionLabel="" onChanged={() => afterItemAction(item)} />
                  ))}
                </ul>
                {g.total > g.items.length && (
                  <p className="px-4 py-2 text-xs text-slate-500">Showing {g.items.length} of {g.total}.</p>
                )}
              </details>
            )
          )}
        </section>
      </div>
    </div>
  );
}
