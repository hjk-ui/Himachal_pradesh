'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, CalendarPlus, CheckCircle2, FileText, Loader2, Play, Save, UserMinus, UserPlus } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { ConfirmDialog, FormField } from '@/components/ui';
import { useClients } from '@/features/clients/hooks/useClients';
import { GROUP_KIND_META, MEMBER_LEAVE_REASONS, type GroupKind } from '@/lib/groups/types';
import type { MemberView, SessionSummary } from '@/lib/groups/store';
import { GroupForm, groupPayload, useGroupOptions, type GroupFormValues } from './GroupForm';
import { ErrorNote, KindHeader, Part2Banner, Pill, SESSION_STATUS_LABEL, SESSION_STATUS_TONE, apiBase, formatDate, formatTime, primaryBtn, secondaryBtn } from './shared';

type GroupDetailResponse = {
  timeZone: string;
  group: Record<string, unknown> & {
    id: string;
    name: string;
    kind: GroupKind;
    groupType: string;
    groupTypeLabel: string;
    facilitatorName: string | null;
    coFacilitatorName: string | null;
    locationName: string | null;
    schedule: string | null;
    billingNote: string;
    billingLocked: boolean;
    hasNotes: boolean;
    capacity: number;
    status: string;
    billingCode: string | null;
    billingMode: string;
    part2: boolean;
  };
  members: MemberView[];
  sessions: SessionSummary[];
  consentCheckAvailable: boolean;
  canManage: boolean;
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'members', label: 'Members' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'notes', label: 'Notes' },
  { id: 'report', label: 'Attendance report' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function formFromGroup(g: GroupDetailResponse['group']): GroupFormValues {
  const s = (k: string) => (typeof g[k] === 'string' ? (g[k] as string) : '');
  const n = (k: string) => (typeof g[k] === 'number' ? String(g[k]) : '');
  return {
    name: g.name,
    groupType: g.groupType,
    description: s('description'),
    program: s('program'),
    facilitatorId: s('facilitatorId'),
    coFacilitatorId: s('coFacilitatorId'),
    locationId: s('locationId'),
    room: s('room'),
    telehealth: Boolean(g.telehealth),
    capacity: Number(g.capacity),
    defaultDurationMinutes: Number(g.defaultDurationMinutes),
    billingCode: s('billingCode'),
    billingMode: g.billingMode === 'attendance_only' ? 'attendance_only' : 'per_session',
    minBillableMinutes: n('minBillableMinutes'),
    maxBillableGroupSize: n('maxBillableGroupSize'),
    enrollment: g.enrollment === 'closed' ? 'closed' : 'open',
    status: (s('status') || 'active') as GroupFormValues['status'],
    recurFrequency: (s('recurFrequency') || '') as GroupFormValues['recurFrequency'],
    recurWeekdays: Array.isArray(g.recurWeekdays) ? (g.recurWeekdays as number[]) : [],
    recurStartTime: s('recurStartTime') || '10:00',
    recurStartDate: s('recurStartDate'),
    recurEndDate: s('recurEndDate'),
  };
}

function Overview({ kind, data, reload }: { kind: GroupKind; data: GroupDetailResponse; reload: () => void }) {
  const options = useGroupOptions(kind);
  const [form, setForm] = useState<GroupFormValues>(() => formFromGroup(data.group));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setForm(formFromGroup(data.group)), [data.group]);
  const save = async () => {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      await apiJson(`${apiBase()}/${data.group.id}`, { method: 'PATCH', body: JSON.stringify(groupPayload(form)) });
      setMsg('Saved.');
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-500">{GROUP_KIND_META[kind].signerTitle}</dt>
          <dd className="text-slate-900">{data.group.facilitatorName ?? 'Not set'}</dd>
          {data.group.coFacilitatorName ? <dd className="text-xs text-slate-600">Co-facilitator: {data.group.coFacilitatorName}</dd> : null}
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-500">Schedule</dt>
          <dd className="text-slate-900">{data.group.schedule ?? 'Does not repeat'}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-500">Where</dt>
          <dd className="text-slate-900">{data.group.telehealth ? 'Telehealth' : [data.group.locationName, data.group.room].filter(Boolean).join(', ') || 'Not set'}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-500">Billing</dt>
          <dd className="text-slate-900">{data.group.billingMode === 'per_session' && data.group.billingCode ? `${data.group.billingCode} per attendee` : 'Attendance only'}</dd>
        </div>
      </dl>
      {data.canManage ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <ErrorNote message={error} />
          {msg ? <p className="mb-3 text-sm text-emerald-700">{msg}</p> : null}
          <GroupForm kind={kind} value={form} onChange={setForm} options={options} billingLocked={data.group.billingLocked} />
          <div className="mt-4 flex justify-end">
            <button type="button" className={primaryBtn} onClick={save} disabled={saving || form.name.trim().length < 2}>
              {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />}
              Save settings
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Only leadership or this group&apos;s facilitators can change its settings.</p>
      )}
    </div>
  );
}

function Members({ data, reload }: { data: GroupDetailResponse; reload: () => void }) {
  const [search, setSearch] = useState('');
  const { clients } = useClients({ page: 0, search: search.trim() || undefined, pageSize: 20, status: 'ACTIVE' });
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState<MemberView | null>(null);
  const [endStatus, setEndStatus] = useState<'completed' | 'discharged' | 'withdrawn' | 'inactive'>('completed');
  const [endReason, setEndReason] = useState('completed');
  const active = data.members.filter((m) => m.status === 'active');
  const past = data.members.filter((m) => m.status !== 'active');
  const full = active.length >= data.group.capacity;
  const add = async () => {
    if (!clientId) return;
    setBusy(true);
    setError(null);
    try {
      await apiJson(`${apiBase()}/${data.group.id}/members`, { method: 'POST', body: JSON.stringify({ clientId }) });
      setClientId('');
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add');
    } finally {
      setBusy(false);
    }
  };
  const end = async () => {
    if (!ending) return;
    setBusy(true);
    try {
      const reasonLabel = MEMBER_LEAVE_REASONS.find((r) => r.value === endReason)?.label ?? endReason;
      await apiJson(`${apiBase()}/${data.group.id}/members/${ending.memberId}`, { method: 'PATCH', body: JSON.stringify({ status: endStatus, reason: reasonLabel }) });
      setEnding(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not end membership');
    } finally {
      setBusy(false);
    }
  };
  const existing = new Set(data.members.filter((m) => m.status === 'active').map((m) => m.clientId));
  return (
    <div className="space-y-4">
      {ending ? (
        <ConfirmDialog title={`End ${ending.displayName}'s membership?`} tone="danger" confirmLabel="End membership" busy={busy} onCancel={() => setEnding(null)} onConfirm={end}>
          <p className="mb-3">Attendance and notes are kept. Future group visits for this member are cancelled.</p>
          <div className="grid gap-3">
            <FormField label="Outcome">
              <select className="clinic-input" value={endStatus} onChange={(e) => setEndStatus(e.target.value as typeof endStatus)}>
                <option value="completed">Completed</option>
                <option value="discharged">Discharged</option>
                <option value="withdrawn">Withdrew</option>
                <option value="inactive">Inactive</option>
              </select>
            </FormField>
            <FormField label="Reason">
              <select className="clinic-input" value={endReason} onChange={(e) => setEndReason(e.target.value)}>
                {MEMBER_LEAVE_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </ConfirmDialog>
      ) : null}
      {data.canManage ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Add a member</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input aria-label="Search clients" className="clinic-input" placeholder="Search clients by name or MRN" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select aria-label="Client" className="clinic-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Choose a client</option>
              {clients.filter((c) => !existing.has(c.id)).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="button" className={primaryBtn} onClick={add} disabled={!clientId || busy || full}>
              <UserPlus size={16} aria-hidden /> Add
            </button>
          </div>
          {full ? <p className="mt-2 text-sm text-amber-800">The group is full ({data.group.capacity}). Raise the capacity in Overview to add more.</p> : null}
          <ErrorNote message={error} />
        </div>
      ) : null}
      {!data.consentCheckAvailable ? (
        <p className="text-xs text-slate-500">The consent check is not available right now; confirm group confidentiality agreements in the chart.</p>
      ) : null}
      <div className="clinic-scroll-x">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <caption className="sr-only">Active members</caption>
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th scope="col" className="py-2">Member</th>
            <th scope="col" className="py-2">Joined</th>
            <th scope="col" className="py-2">Confidentiality agreement</th>
            <th scope="col" className="py-2 text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {active.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-6 text-center text-slate-500">
                No active members.
              </td>
            </tr>
          ) : null}
          {active.map((m) => (
            <tr key={m.memberId}>
              <td className="py-2.5">
                {m.visible && m.clientId ? (
                  <Link className="font-medium text-blue-600 hover:underline" href={`/dashboard/clients/${m.clientId}`}>
                    {m.displayName}
                  </Link>
                ) : (
                  <span className="italic text-slate-500">{m.displayName}</span>
                )}
              </td>
              <td className="py-2.5 text-slate-600">{formatDate(m.joinedOn)}</td>
              <td className="py-2.5">
                {m.confidentialityOnFile === true ? (
                  <Pill tone="green">
                    <CheckCircle2 size={12} aria-hidden /> On file
                  </Pill>
                ) : m.confidentialityOnFile === false ? (
                  <Pill tone="amber">
                    <AlertTriangle size={12} aria-hidden /> Confidentiality agreement not on file
                  </Pill>
                ) : (
                  <span className="text-xs text-slate-500">Not checked</span>
                )}
              </td>
              <td className="py-2.5 text-right">
                {data.canManage ? (
                  <button type="button" className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 md:min-h-8" onClick={() => setEnding(m)} aria-label={`End membership for ${m.displayName}`}>
                    <UserMinus size={14} aria-hidden /> End
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {past.length ? (
        <details className="rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Past members ({past.length})</summary>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {past.map((m) => (
              <li key={m.memberId}>
                {m.displayName}: {m.status}
                {m.leftOn ? ` ${formatDate(m.leftOn)}` : ''}
                {m.leftReason ? ` (${m.leftReason})` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Sessions({ kind, data, reload, notesView }: { kind: GroupKind; data: GroupDetailResponse; reload: () => void; notesView?: boolean }) {
  const [count, setCount] = useState(8);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = GROUP_KIND_META[kind].href;
  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await apiJson<{ created: unknown[] }>(`${apiBase()}/${data.group.id}/sessions`, { method: 'POST', body: JSON.stringify(body) });
      setMsg(`${r.created.length} session${r.created.length === 1 ? '' : 's'} added to the calendar.`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not schedule');
    } finally {
      setBusy(false);
    }
  };
  const list = notesView ? data.sessions.filter((s) => s.attended > 0 || s.marked > 0) : data.sessions;
  return (
    <div className="space-y-4">
      {!notesView && data.canManage ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">From the repeat schedule</h3>
            <p className="text-xs text-slate-500">{data.group.schedule ?? 'Set a repeat schedule in Overview first.'}</p>
            <div className="mt-2 flex items-end gap-2">
              <FormField label="Next">
                <input type="number" min={1} max={26} className="clinic-input w-24" value={count} onChange={(e) => setCount(Number(e.target.value))} />
              </FormField>
              <button type="button" className={primaryBtn} disabled={busy || !data.group.schedule} onClick={() => post({ mode: 'generate', count })}>
                <CalendarPlus size={16} aria-hidden /> Schedule sessions
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">One session (make-up or ad hoc)</h3>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <FormField label="Date">
                <input type="date" className="clinic-input" value={date} onChange={(e) => setDate(e.target.value)} />
              </FormField>
              <FormField label="Start">
                <input type="time" className="clinic-input" value={time} onChange={(e) => setTime(e.target.value)} />
              </FormField>
              <button type="button" className={secondaryBtn} disabled={busy || !date || !time} onClick={() => post({ mode: 'single', date, startTime: time })}>
                Add session
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
      <ErrorNote message={error} />
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {list.length === 0 ? <li className="p-6 text-center text-sm text-slate-500">{notesView ? 'No documented sessions yet.' : 'No sessions scheduled.'}</li> : null}
        {list.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900">
                {formatDate(s.date)} at {formatTime(s.startTime)}
              </p>
              <p className="text-xs text-slate-500">
                {s.topic ? `${s.topic} · ` : ''}
                {s.marked ? `${s.attended} attended` : 'Attendance not taken'}
                {s.attended ? ` · ${s.notesSigned}/${s.attended} notes signed` : ''}
              </p>
            </div>
            <Pill tone={SESSION_STATUS_TONE[s.status] ?? 'slate'}>{SESSION_STATUS_LABEL[s.status] ?? s.status}</Pill>
            {s.attended > s.notesSigned ? <Pill tone="amber">{s.attended - s.notesSigned} unsigned</Pill> : null}
            {s.status !== 'cancelled' ? (
              <Link href={`${base}/sessions/${s.id}`} className={`${secondaryBtn} py-1.5`}>
                {notesView ? <FileText size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                {notesView ? 'Open notes' : 'Open'}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

type ReportResponse = {
  summary: { sessionsHeld: number; sessionsCancelled: number; marked: number; attended: number; absent: number; excused: number; attendanceRate: number | null; averageGroupSize: number | null; notesUnsigned: number; claimsGenerated: number } | null;
  members: { clientId: string | null; displayName: string; marked: number; attended: number; absent: number; excused: number; attendanceRate: number | null }[];
};

function Report({ data }: { data: GroupDetailResponse }) {
  const [r, setR] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiJson<ReportResponse>(`${apiBase()}/${data.group.id}/report`)
      .then(setR)
      .catch((e: Error) => setError(e.message));
  }, [data.group.id]);
  if (error) return <ErrorNote message={error} />;
  if (!r) return <p className="text-sm text-slate-500">Loading report</p>;
  const s = r.summary;
  const tiles: [string, string | number][] = [
    ['Sessions held', s?.sessionsHeld ?? 0],
    ['Cancelled', s?.sessionsCancelled ?? 0],
    ['Attendance rate', s?.attendanceRate != null ? `${s.attendanceRate}%` : 'n/a'],
    ['Average group size', s?.averageGroupSize ?? 'n/a'],
    ['Notes unsigned', s?.notesUnsigned ?? 0],
    ['Claims generated', s?.claimsGenerated ?? 0],
  ];
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">Last 90 days. The report library has the full Group attendance and Group utilization reports.</p>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-slate-200 bg-white p-3">
            <dt className="text-xs font-semibold uppercase text-slate-500">{k}</dt>
            <dd className="mt-1 text-xl font-semibold text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="clinic-scroll-x">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <caption className="sr-only">Attendance by member</caption>
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th scope="col" className="py-2">Member</th>
            <th scope="col" className="py-2">Attended</th>
            <th scope="col" className="py-2">Absent</th>
            <th scope="col" className="py-2">Excused</th>
            <th scope="col" className="py-2">Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {r.members.map((m, i) => (
            <tr key={m.clientId ?? `hidden-${i}`}>
              <td className="py-2">{m.displayName}</td>
              <td className="py-2">{m.attended}</td>
              <td className="py-2">{m.absent}</td>
              <td className="py-2">{m.excused}</td>
              <td className="py-2">{m.attendanceRate != null ? `${m.attendanceRate}%` : 'n/a'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export function GroupDetail({ kind }: { kind: GroupKind }) {
  const params = useParams<{ groupId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const groupId = params.groupId;
  const initial = (search.get('tab') as TabId) || 'overview';
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.id === initial) ? initial : 'overview');
  const [data, setData] = useState<GroupDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiJson<GroupDetailResponse>(`${apiBase()}/${groupId}`)
      .then((r) => {
        if (r.group.kind !== kind) {
          router.replace(`${GROUP_KIND_META[r.group.kind].href}/${groupId}`);
          return;
        }
        setData(r);
      })
      .catch((e: Error) => setError(e.message));
  }, [groupId, kind, router]);
  useEffect(load, [load]);
  const selectTab = (t: TabId) => {
    setTab(t);
    router.replace(`${GROUP_KIND_META[kind].href}/${groupId}?tab=${t}`, { scroll: false });
  };
  const base = GROUP_KIND_META[kind].href;
  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <KindHeader
        kind={kind}
        title={data?.group.name ?? 'Group'}
        subtitle={data ? `${data.group.groupTypeLabel}${data.group.facilitatorName ? ` · ${data.group.facilitatorName}` : ''}${data.group.schedule ? ` · ${data.group.schedule}` : ''}` : undefined}
        back={
          <Link href={base} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline">
            <ArrowLeft size={14} aria-hidden /> All {GROUP_KIND_META[kind].shortLabel}s
          </Link>
        }
      />
      <Part2Banner kind={kind} />
      <ErrorNote message={error} />
      {data ? (
        <>
          <div role="tablist" aria-label="Group sections" className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={tab === t.id}
                onClick={() => selectTab(t.id)}
                className={`min-h-11 shrink-0 whitespace-nowrap rounded-lg px-4 text-sm font-semibold ${tab === t.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {t.label}
                {t.id === 'members' ? ` (${data.members.filter((m) => m.status === 'active').length})` : ''}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
            {tab === 'overview' ? <Overview kind={kind} data={data} reload={load} /> : null}
            {tab === 'members' ? <Members data={data} reload={load} /> : null}
            {tab === 'sessions' ? <Sessions kind={kind} data={data} reload={load} /> : null}
            {tab === 'notes' ? <Sessions kind={kind} data={data} reload={load} notesView /> : null}
            {tab === 'report' ? <Report data={data} /> : null}
          </div>
        </>
      ) : !error ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Loading group
        </p>
      ) : null}
    </div>
  );
}
