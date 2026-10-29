'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronRight, Loader2, MapPin, Play, Plus, Search, Users, Video } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { ClinicalModal } from '@/components/clinic/ClinicalModal';
import type { GroupListItem } from '@/lib/groups/store';
import { GROUP_KIND_META, GROUP_TYPES, type GroupKind } from '@/lib/groups/types';
import { GroupForm, emptyGroupForm, groupPayload, useGroupOptions, type GroupFormValues } from './GroupForm';
import {
  ErrorNote,
  KindHeader,
  Part2Banner,
  Pill,
  SESSION_STATUS_LABEL,
  SESSION_STATUS_TONE,
  WEEKDAYS,
  apiBase,
  formatDate,
  formatTime,
  primaryBtn,
  secondaryBtn,
} from './shared';

type TodaySession = {
  id: string;
  groupId: string;
  groupName: string;
  groupTypeLabel: string;
  startTime: string;
  startsAt: string;
  durationMinutes: number;
  status: string;
  telehealth: boolean;
  room: string | null;
  facilitatorName: string | null;
  activeMembers: number;
  marked: number;
  attended: number;
  notesSigned: number;
  mine: boolean;
};

function TodayPanel({ kind }: { kind: GroupKind }) {
  const [mine, setMine] = useState(true);
  const [data, setData] = useState<{ date: string; sessions: TodaySession[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    apiJson<{ date: string; sessions: TodaySession[] }>(`${apiBase()}/today?kind=${kind}${mine ? '&mine=1' : ''}`)
      .then((r) => live && setData(r))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [kind, mine]);
  const base = GROUP_KIND_META[kind].href;
  return (
    <section aria-labelledby="today-groups" className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="today-groups" className="text-base font-semibold text-slate-900">
            Today&apos;s groups
          </h2>
          <p className="text-sm text-slate-500">{data ? formatDate(data.date) : 'Loading'}: open a session, take attendance, then document.</p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 p-1" role="group" aria-label="Whose sessions">
          {[
            { v: true, l: 'My groups' },
            { v: false, l: 'All groups' },
          ].map((o) => (
            <button
              key={o.l}
              type="button"
              aria-pressed={mine === o.v}
              onClick={() => setMine(o.v)}
              className={`min-h-10 rounded-md px-3 py-1.5 text-sm font-semibold md:min-h-0 ${mine === o.v ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>
      <ErrorNote message={error} />
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data && data.sessions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">
            No {mine ? 'groups of yours' : 'groups'} scheduled today.
          </p>
        ) : null}
        {data?.sessions.map((s) => (
          <article key={s.id} className="flex min-w-0 flex-col justify-between rounded-xl border border-slate-200 p-4">
            <div>
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 break-words font-semibold text-slate-900">{s.groupName}</h3>
                <Pill tone={SESSION_STATUS_TONE[s.status] ?? 'slate'}>{SESSION_STATUS_LABEL[s.status] ?? s.status}</Pill>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                <CalendarClock size={14} aria-hidden />
                {formatTime(s.startTime)}, {s.durationMinutes} min
                {s.telehealth ? (
                  <>
                    <Video size={14} aria-hidden className="ml-2" /> Telehealth
                  </>
                ) : s.room ? (
                  <>
                    <MapPin size={14} aria-hidden className="ml-2" /> {s.room}
                  </>
                ) : null}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {s.activeMembers} members · {s.marked ? `${s.attended} attended` : 'attendance not taken'}
                {s.attended ? ` · ${s.notesSigned}/${s.attended} notes signed` : ''}
              </p>
              {!mine && s.facilitatorName ? <p className="text-xs text-slate-500">Facilitator: {s.facilitatorName}</p> : null}
            </div>
            <Link href={`${base}/sessions/${s.id}`} className={`${primaryBtn} mt-4 min-h-12 w-full text-base`}>
              <Play size={18} aria-hidden />
              {s.marked ? 'Continue session' : 'Start session'}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function GroupsList({ kind, refreshKey }: { kind: GroupKind; refreshKey: number }) {
  const [groups, setGroups] = useState<GroupListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [program, setProgram] = useState('all');
  const [facilitator, setFacilitator] = useState('all');
  const [location, setLocation] = useState('all');
  const [day, setDay] = useState('all');
  const [status, setStatus] = useState('active');
  useEffect(() => {
    let live = true;
    apiJson<{ groups: GroupListItem[] }>(`${apiBase()}?kind=${kind}`)
      .then((r) => live && setGroups(r.groups))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [kind, refreshKey]);
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort();
  const programs = useMemo(() => uniq((groups ?? []).map((g) => g.program)), [groups]);
  const facilitators = useMemo(() => uniq((groups ?? []).map((g) => g.facilitatorName)), [groups]);
  const locations = useMemo(() => uniq((groups ?? []).map((g) => g.locationName ?? (g.telehealth ? 'Telehealth' : g.room))), [groups]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (groups ?? []).filter((g) => {
      if (status !== 'all' && g.status !== status) return false;
      if (type !== 'all' && g.groupType !== type) return false;
      if (program !== 'all' && g.program !== program) return false;
      if (facilitator !== 'all' && g.facilitatorName !== facilitator) return false;
      if (location !== 'all' && (g.locationName ?? (g.telehealth ? 'Telehealth' : g.room)) !== location) return false;
      if (day !== 'all' && !g.weekdays.includes(Number(day))) return false;
      if (needle && ![g.name, g.facilitatorName, g.program, g.room, g.locationName].some((x) => x?.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [groups, q, type, program, facilitator, location, day, status]);
  const base = GROUP_KIND_META[kind].href;
  const sel = 'clinic-input py-2';
  return (
    <section aria-labelledby="all-groups" className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
      <h2 id="all-groups" className="text-base font-semibold text-slate-900">
        Groups
      </h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <label className="relative sm:col-span-2 lg:col-span-1 xl:col-span-2">
          <span className="sr-only">Search groups</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
          <input className="clinic-input py-2 pl-9" placeholder="Search name, facilitator, room" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select aria-label="Type" className={sel} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          {GROUP_TYPES[kind].map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select aria-label="Program" className={sel} value={program} onChange={(e) => setProgram(e.target.value)}>
          <option value="all">All programs</option>
          {programs.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select aria-label="Facilitator" className={sel} value={facilitator} onChange={(e) => setFacilitator(e.target.value)}>
          <option value="all">All facilitators</option>
          {facilitators.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select aria-label="Location" className={sel} value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="all">All locations</option>
          {locations.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select aria-label="Day" className={sel} value={day} onChange={(e) => setDay(e.target.value)}>
          <option value="all">Any day</option>
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <label htmlFor="group-status" className="text-slate-600">
          Status
        </label>
        <select id="group-status" className="min-h-10 rounded-lg border border-slate-200 px-2 py-1 text-sm md:min-h-0" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <span className="text-slate-500">{filtered.length} shown</span>
      </div>
      <ErrorNote message={error} />
      {!groups && !error ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Loading groups
        </p>
      ) : null}
      {groups && filtered.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
          {groups.length === 0 ? 'No groups yet. Create one with New group.' : 'No groups match these filters.'}
        </p>
      ) : null}
      <ul className="mt-4 divide-y divide-slate-100">
        {filtered.map((g) => (
          <li key={g.id}>
            <Link href={`${base}/${g.id}`} className="flex items-center gap-4 rounded-xl px-2 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <Users size={18} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{g.name}</span>
                  <Pill>{g.groupTypeLabel}</Pill>
                  {g.status !== 'active' ? <Pill tone="amber">{g.status}</Pill> : null}
                  {g.billingMode === 'per_session' && g.billingCode ? <Pill tone="blue">{g.billingCode}</Pill> : <Pill>Attendance only</Pill>}
                  {g.part2 ? <Pill tone="teal">Part 2</Pill> : null}
                </span>
                <span className="mt-0.5 block text-sm text-slate-600">
                  {[g.facilitatorName, g.schedule, g.telehealth ? 'Telehealth' : g.locationName ?? g.room].filter(Boolean).join(' · ')}
                </span>
                <span className="block text-xs text-slate-500">
                  Next: {g.nextSession ? new Date(g.nextSession.startsAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'none scheduled'}
                </span>
              </span>
              <span className="shrink-0 text-right text-sm">
                <span className="block font-semibold text-slate-900">
                  {g.activeMembers}/{g.capacity}
                </span>
                <span className="text-xs text-slate-500">members</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-slate-500" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GroupsWorkspace({ kind }: { kind: GroupKind }) {
  const router = useRouter();
  const options = useGroupOptions(kind);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<GroupFormValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState<'today' | 'groups'>('today');
  const open = useCallback(() => {
    setForm(emptyGroupForm(kind, options?.me ?? ''));
    setError(null);
    setCreating(true);
  }, [kind, options]);
  const create = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const r = await apiJson<{ group: { id: string } }>(apiBase(), { method: 'POST', body: JSON.stringify({ kind, ...groupPayload(form) }) });
      setCreating(false);
      setRefreshKey((k) => k + 1);
      router.push(`${GROUP_KIND_META[kind].href}/${r.group.id}?tab=members`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the group');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <KindHeader
        kind={kind}
        subtitle={GROUP_KIND_META[kind].description}
        actions={
          <button type="button" className={primaryBtn} onClick={open}>
            <Plus size={16} aria-hidden /> New group
          </button>
        }
      />
      <Part2Banner kind={kind} />
      <div role="tablist" aria-label="Group views" className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {[
          { id: 'today' as const, label: "Today's groups" },
          { id: 'groups' as const, label: 'All groups' },
        ].map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${tab === t.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'today' ? <TodayPanel kind={kind} /> : <GroupsList kind={kind} refreshKey={refreshKey} />}
      {creating && form ? (
        <ClinicalModal
          title={`New ${GROUP_KIND_META[kind].shortLabel}`}
          size="lg"
          onClose={() => setCreating(false)}
          dismissible={!saving}
          footer={
            <>
              <button type="button" className={secondaryBtn} onClick={() => setCreating(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className={primaryBtn} onClick={create} disabled={saving || form.name.trim().length < 2 || !form.facilitatorId}>
                {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
                Create group
              </button>
            </>
          }
        >
          <ErrorNote message={error} />
          <GroupForm kind={kind} value={form} onChange={setForm} options={options} />
        </ClinicalModal>
      ) : null}
    </div>
  );
}
