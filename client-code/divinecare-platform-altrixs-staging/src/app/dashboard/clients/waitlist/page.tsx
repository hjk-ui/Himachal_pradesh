'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarPlus, Clock, Copy, Plus, Search, Send, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/features/auth';
import { Alert, Button, cx, inputClasses, Page, PageHeader, StatCard, StatGrid } from '@/components/ui';
import {
  bulkSendIntake,
  fetchWaitlist,
  type WaitlistClinician,
  type WaitlistEntry,
  type WaitlistStage,
} from '@/features/waitlist/api';
import { canEditWaitlistEntry, followUpDue, OPEN_STAGES, sortByPriority, STAGE_LABEL, WAITLIST_SERVICES } from '@/lib/waitlist/standard';
import { CrisisGuidance, StageBadge, UrgencyBadge, formatDate } from '@/features/waitlist/components/shared';
import { EntryFormDrawer } from '@/features/waitlist/components/EntryFormDrawer';
import { EntryDetailDrawer } from '@/features/waitlist/components/EntryDetailDrawer';
import { ScheduleDrawer } from '@/features/waitlist/components/ScheduleDrawer';

type SortKey = 'priority' | 'longest' | 'newest' | 'name' | 'followup';
type StageFilter = 'open' | 'all' | WaitlistStage;

const PIPELINE: WaitlistStage[] = ['NEW', 'CONTACTED', 'INTAKE_SENT', 'READY', 'SCHEDULED', 'CONVERTED', 'CLOSED'];
const WAIT_BUCKETS = [
  ['0', 'Any wait'],
  ['7', '7+ days'],
  ['14', '14+ days'],
  ['30', '30+ days'],
  ['60', '60+ days'],
] as const;

function dueLabel(iso: string | null) {
  if (!iso) return '';
  return followUpDue(iso) ? `Due ${formatDate(iso, undefined, 'UTC')}` : formatDate(iso, undefined, 'UTC');
}

export default function WaitlistPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [clinicians, setClinicians] = useState<WaitlistClinician[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [payers, setPayers] = useState<{ id: string; name: string }[]>([]);
  const [perm, setPerm] = useState({ canManage: false, canAdd: false, eligibility: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<StageFilter>('open');
  const [service, setService] = useState('');
  const [location, setLocation] = useState('');
  const [urgency, setUrgency] = useState('');
  const [payer, setPayer] = useState('');
  const [clinician, setClinician] = useState('');
  const [minWait, setMinWait] = useState('0');
  const [sort, setSort] = useState<SortKey>('priority');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Panels
  const [formEntry, setFormEntry] = useState<WaitlistEntry | null | 'new'>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<{ entry: WaitlistEntry; mode: 'schedule' | 'convert' } | null>(null);
  const [crisisFor, setCrisisFor] = useState<WaitlistEntry | null>(null);
  const [bulkLinks, setBulkLinks] = useState<{ name: string; url: string | null; error?: string }[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWaitlist();
      setEntries(data.entries);
      setClinicians(data.clinicians);
      setLocations(data.locations ?? []);
      setPayers(data.payers ?? []);
      setPerm(data.permissions ?? { canManage: false, canAdd: false, eligibility: false });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load waitlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // To-Do deep link: ?entry=<id> opens that entry
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('entry');
    if (id && /^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      setDetailId(id);
      params.delete('entry');
      const qs = params.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }
  }, []);

  const upsert = (e: WaitlistEntry) =>
    setEntries((prev) => sortByPriority(prev.some((x) => x.id === e.id) ? prev.map((x) => (x.id === e.id ? e : x)) : [e, ...prev]));

  const open = useMemo(() => entries.filter((e) => (OPEN_STAGES as string[]).includes(e.stage)), [entries]);
  const stats = useMemo(() => {
    const byStage: Record<string, number> = {};
    for (const e of entries) byStage[e.stage] = (byStage[e.stage] ?? 0) + 1;
    const byService: Record<string, number> = {};
    for (const e of open) byService[e.service] = (byService[e.service] ?? 0) + 1;
    return {
      byStage,
      byService,
      urgent: open.filter((e) => e.urgency !== 'routine' || e.safetyScreen === 'yes').length,
      safety: open.filter((e) => e.safetyScreen === 'yes'),
      avgWait: open.length ? Math.round(open.reduce((s, e) => s + e.daysWaiting, 0) / open.length) : 0,
      due: open.filter((e) => followUpDue(e.nextFollowUpAt)).length,
    };
  }, [entries, open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const min = Number(minWait);
    const rows = entries.filter((e) => {
      if (stage === 'open' && !(OPEN_STAGES as string[]).includes(e.stage)) return false;
      if (stage !== 'open' && stage !== 'all' && e.stage !== stage) return false;
      if (service && e.service !== service) return false;
      if (location && !e.preferredLocationIds.includes(location)) return false;
      if (urgency && e.urgency !== urgency) return false;
      if (payer && (e.insurancePayer ?? '') !== payer) return false;
      if (clinician && e.clinicianId !== clinician && e.preferredClinician !== clinicians.find((c) => c.id === clinician)?.name) return false;
      if (min && e.daysWaiting < min) return false;
      if (needle && !`${e.name} ${e.phone ?? ''} ${e.email ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    if (sort === 'priority') return sortByPriority(rows);
    const copy = [...rows];
    if (sort === 'longest') copy.sort((a, b) => b.daysWaiting - a.daysWaiting);
    if (sort === 'newest') copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (sort === 'name') copy.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
    if (sort === 'followup') copy.sort((a, b) => (a.nextFollowUpAt ?? '9').localeCompare(b.nextFollowUpAt ?? '9'));
    return copy;
  }, [entries, q, stage, service, location, urgency, payer, clinician, clinicians, minWait, sort]);

  const payerOptions = useMemo(() => [...new Set(entries.map((e) => e.insurancePayer).filter(Boolean) as string[])].sort(), [entries]);
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? '';

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const sendBulk = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const r = await bulkSendIntake(ids);
      const origin = window.location.origin;
      setBulkLinks(
        r.results.map((x) => ({
          name: entries.find((e) => e.id === x.id)?.name ?? 'Entry',
          url: x.ok && x.token ? `${origin}/intake/${x.token}` : null,
          error: x.error,
        }))
      );
      setSelected(new Set());
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send intake');
    } finally {
      setBulkBusy(false);
    }
  };

  const canEdit = (e: WaitlistEntry) => Boolean(user?.id) && canEditWaitlistEntry(user?.role, user!.id, e);

  const rowActions = (e: WaitlistEntry, compact = false) => {
    const isOpen = (OPEN_STAGES as string[]).includes(e.stage);
    return (
      <div className={cx('flex flex-wrap items-center gap-2', compact ? '' : 'justify-end')}>
        {perm.canManage && isOpen ? (
          <Button size="sm" icon={<CalendarPlus size={14} />} onClick={() => setScheduleFor({ entry: e, mode: 'schedule' })}>
            Schedule
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => setDetailId(e.id)}>
          {perm.canManage && isOpen ? 'Contact' : 'View'}
        </Button>
      </div>
    );
  };

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">Loading waitlist...</div>;
  }

  return (
    <Page width="full">
      <PageHeader
        title="Waitlist"
        description="Everyone waiting for care, in priority order: urgent first, then longest waiting."
        actions={
          <div className="flex flex-wrap gap-2">
            {perm.canManage && selected.size ? (
              <Button variant="secondary" icon={<Send size={16} />} loading={bulkBusy} onClick={sendBulk}>
                Send intake ({selected.size})
              </Button>
            ) : null}
            {perm.canAdd ? (
              <Button icon={<Plus size={16} />} onClick={() => setFormEntry('new')}>
                Add to waitlist
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? (
        <Alert tone="danger" actions={<Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>}>
          {error}
        </Alert>
      ) : null}

      {stats.safety.length ? (
        <Alert tone="danger" title={`${stats.safety.length} open ${stats.safety.length === 1 ? 'entry has' : 'entries have'} a positive safety screen`} icon={<AlertTriangle size={18} />}>
          Same-day triage: {stats.safety.slice(0, 5).map((e) => e.name).join(', ')}
          {stats.safety.length > 5 ? '...' : ''}. Call or text 988 with the person when in crisis.
        </Alert>
      ) : null}

      <StatGrid columns={4}>
        <StatCard label="Open" value={open.length} icon={<Users size={18} />} />
        <StatCard label="Urgent / safety" value={stats.urgent} tone={stats.urgent ? 'warning' : 'neutral'} icon={<AlertTriangle size={18} />} />
        <StatCard label="Average wait (open)" value={`${stats.avgWait} days`} icon={<Clock size={18} />} />
        <StatCard label="Follow-ups due today" value={stats.due} tone={stats.due ? 'info' : 'neutral'} icon={<CalendarPlus size={18} />} />
      </StatGrid>

      {/* Pipeline counts (click to filter) */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by stage">
        {(['open', 'all'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setStage(k)} className={cx('min-h-10 rounded-full border px-3 text-sm', stage === k ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700')}>
            {k === 'open' ? `Open (${open.length})` : `All (${entries.length})`}
          </button>
        ))}
        {PIPELINE.map((s) => (
          <button key={s} type="button" onClick={() => setStage(s)} className={cx('min-h-10 rounded-full border px-3 text-sm', stage === s ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700')}>
            {STAGE_LABEL[s]} ({stats.byStage[s] ?? 0})
          </button>
        ))}
      </div>
      {Object.keys(stats.byService).length ? (
        <p className="text-sm text-slate-600">
          Open by service:{' '}
          {Object.entries(stats.byService)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')}
        </p>
      ) : null}

      {/* Filters */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <label className="relative sm:col-span-2 lg:col-span-1 xl:col-span-2">
          <span className="sr-only">Search</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={cx(inputClasses, 'pl-9')} placeholder="Name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select className={inputClasses} aria-label="Service" value={service} onChange={(e) => setService(e.target.value)}>
          <option value="">All services</option>
          {WAITLIST_SERVICES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className={inputClasses} aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select className={inputClasses} aria-label="Urgency" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
          <option value="">All urgency</option>
          <option value="crisis">Crisis</option>
          <option value="urgent">Urgent</option>
          <option value="routine">Routine</option>
        </select>
        <select className={inputClasses} aria-label="Payer" value={payer} onChange={(e) => setPayer(e.target.value)}>
          <option value="">All payers</option>
          {payerOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select className={inputClasses} aria-label="Clinician" value={clinician} onChange={(e) => setClinician(e.target.value)}>
          <option value="">Any clinician</option>
          {clinicians.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className={inputClasses} aria-label="Days waiting" value={minWait} onChange={(e) => setMinWait(e.target.value)}>
          {WAIT_BUCKETS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select className={inputClasses} aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="priority">Priority</option>
          <option value="longest">Longest waiting</option>
          <option value="newest">Newest</option>
          <option value="followup">Next follow-up</option>
          <option value="name">Last name</option>
        </select>
      </div>

      {!filtered.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No one matches these filters.</div>
      ) : (
        <>
          {/* Desktop table: fixed layout, truncation, no horizontal scroll */}
          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <tr>
                  {perm.canManage ? (
                    <th className="w-10 px-3 py-2">
                      <span className="sr-only">Select</span>
                    </th>
                  ) : null}
                  <th className="px-3 py-2">Person</th>
                  <th className="w-[14%] px-3 py-2">Service</th>
                  <th className="w-[13%] px-3 py-2">Urgency</th>
                  <th className="w-[12%] px-3 py-2">Stage</th>
                  <th className="w-[8%] px-3 py-2">Waiting</th>
                  <th className="hidden w-[13%] px-3 py-2 lg:table-cell">Payer / site</th>
                  <th className="hidden w-[10%] px-3 py-2 xl:table-cell">Follow-up</th>
                  <th className="w-[18%] px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((e) => (
                  <tr key={e.id} className={cx('align-top', e.safetyScreen === 'yes' && (OPEN_STAGES as string[]).includes(e.stage) ? 'bg-rose-50/60' : '')}>
                    {perm.canManage ? (
                      <td className="px-3 py-2">
                        {(OPEN_STAGES as string[]).includes(e.stage) ? (
                          <input type="checkbox" aria-label={`Select ${e.name}`} className="h-4 w-4" checked={selected.has(e.id)} onChange={() => toggleSel(e.id)} />
                        ) : null}
                      </td>
                    ) : null}
                    <td className="min-w-0 px-3 py-2">
                      <button type="button" onClick={() => setDetailId(e.id)} className="block max-w-full truncate text-left font-semibold text-slate-900 hover:text-blue-700">
                        {e.name}
                      </button>
                      <span className="block truncate text-xs text-slate-500">{[e.phone, e.email].filter(Boolean).join(' · ') || 'No contact on file'}</span>
                      {e.promptNoResponseClose ? <span className="mt-0.5 block text-xs font-medium text-amber-700">{e.noResponseCount} attempts, no response</span> : null}
                    </td>
                    <td className="truncate px-3 py-2 text-slate-700" title={e.specialty}>
                      {e.specialty}
                    </td>
                    <td className="px-3 py-2">
                      <UrgencyBadge urgency={e.urgency} safety={e.safetyScreen} />
                    </td>
                    <td className="px-3 py-2">
                      <StageBadge stage={e.stage} closeReason={e.closeReason} />
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-800">{e.daysWaiting}d</td>
                    <td className="hidden truncate px-3 py-2 text-slate-600 lg:table-cell">
                      <span className="block truncate">{e.insurancePayer || 'No payer'}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {e.preferredLocationIds.map(locName).filter(Boolean).join(', ') || (e.telehealthOk ? 'Telehealth' : '')}
                      </span>
                    </td>
                    <td className={cx('hidden px-3 py-2 text-xs xl:table-cell', followUpDue(e.nextFollowUpAt) ? 'font-semibold text-blue-700' : 'text-slate-600')}>{dueLabel(e.nextFollowUpAt)}</td>
                    <td className="px-3 py-2">{rowActions(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone cards */}
          <ul className="space-y-3 md:hidden">
            {filtered.map((e) => (
              <li key={e.id} className={cx('rounded-xl border bg-white p-3', e.safetyScreen === 'yes' && (OPEN_STAGES as string[]).includes(e.stage) ? 'border-rose-300' : 'border-slate-200')}>
                <div className="flex items-start gap-3">
                  {perm.canManage && (OPEN_STAGES as string[]).includes(e.stage) ? (
                    <input type="checkbox" aria-label={`Select ${e.name}`} className="mt-1 h-5 w-5 shrink-0" checked={selected.has(e.id)} onChange={() => toggleSel(e.id)} />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => setDetailId(e.id)} className="block max-w-full truncate text-left font-semibold text-slate-900">
                      {e.name}
                    </button>
                    <p className="truncate text-xs text-slate-500">
                      {e.specialty} · {e.daysWaiting} days waiting
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <UrgencyBadge urgency={e.urgency} safety={e.safetyScreen} />
                      <StageBadge stage={e.stage} closeReason={e.closeReason} />
                    </div>
                    {e.nextFollowUpAt ? <p className={cx('mt-1 text-xs', followUpDue(e.nextFollowUpAt) ? 'font-semibold text-blue-700' : 'text-slate-500')}>Follow-up: {dueLabel(e.nextFollowUpAt)}</p> : null}
                    <div className="mt-3">{rowActions(e, true)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {formEntry ? (
        <EntryFormDrawer
          entry={formEntry === 'new' ? null : formEntry}
          locations={locations}
          payers={payers}
          clinicians={clinicians}
          onClose={() => setFormEntry(null)}
          onSaved={(e, crisis) => {
            upsert(e);
            setFormEntry(null);
            toast.success(formEntry === 'new' ? 'Added to the waitlist' : 'Saved');
            if (crisis) setCrisisFor(e);
          }}
        />
      ) : null}

      {detailId ? (
        <EntryDetailDrawer
          key={detailId}
          entryId={detailId}
          locations={locations}
          canManage={perm.canManage}
          canEdit={(() => {
            const e = entries.find((x) => x.id === detailId);
            return e ? canEdit(e) : perm.canManage;
          })()}
          onClose={() => setDetailId(null)}
          onChanged={upsert}
          onEdit={(e) => {
            setDetailId(null);
            setFormEntry(e);
          }}
          onSchedule={(e) => {
            setDetailId(null);
            setScheduleFor({ entry: e, mode: 'schedule' });
          }}
          onConvertOnly={(e) => {
            setDetailId(null);
            setScheduleFor({ entry: e, mode: 'convert' });
          }}
        />
      ) : null}

      {scheduleFor ? (
        <ScheduleDrawer
          key={`${scheduleFor.entry.id}-${scheduleFor.mode}`}
          entry={scheduleFor.entry}
          mode={scheduleFor.mode}
          locations={locations}
          onClose={() => setScheduleFor(null)}
          onDone={(e) => {
            if (e) upsert(e);
            else void load();
          }}
        />
      ) : null}

      {crisisFor ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" role="alertdialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-base font-bold text-slate-900">{crisisFor.name}: positive safety screen</h2>
            <CrisisGuidance className="mt-3" />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              {perm.canManage ? (
                <Button
                  onClick={() => {
                    const e = crisisFor;
                    setCrisisFor(null);
                    setScheduleFor({ entry: e, mode: 'schedule' });
                  }}
                >
                  Book same-day triage
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setCrisisFor(null)}>
                I have started same-day triage
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {bulkLinks ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-3 sm:items-center" role="dialog" aria-modal="true">
          <div className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-base font-bold text-slate-900">Intake links</h2>
            <p className="mt-1 text-xs text-slate-500">Links are not emailed automatically yet. Copy each into your email to the person.</p>
            <ul className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
              {bulkLinks.map((l, i) => (
                <li key={i} className="rounded-lg border border-slate-200 p-2 text-sm">
                  <p className="font-semibold text-slate-800">{l.name}</p>
                  {l.url ? (
                    <div className="mt-1 flex min-w-0 items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 text-xs">{l.url}</code>
                      <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={() => void navigator.clipboard?.writeText(l.url!).then(() => toast.success('Copied'))}>
                        Copy
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-rose-700">{l.error}</p>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end">
              <Button onClick={() => setBulkLinks(null)}>Done</Button>
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
