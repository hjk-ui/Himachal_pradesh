'use client';
import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Filter, Users, BarChart2, CheckCircle2, AlertTriangle, XCircle, CalendarDays } from 'lucide-react';
import { fetchAppointmentsWithZone, type Appointment } from '@/features/appointments';
import { DEFAULT_PRACTICE_TIME_ZONE, practiceZoneLabel } from '@/lib/time/practiceTime';
import { useStaff } from '@/features/staff';
import {
  appointmentsInWeek,
  formatWeekRange,
  weekDaysForOffset,
  type WeekDay,
} from '@/features/analytics/scheduleWeek';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  FOCUS_RING,
  IconButton,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  cx,
  type Tone,
} from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────
type VisitStatus = 'completed' | 'in-session' | 'checked-in' | 'scheduled' | 'no-show' | 'cancelled' | 'late-cancel';
type Entity = 'mbh' | 'ch' | 'hb';
type ApptType = 'Individual Therapy' | 'Group Therapy' | 'Medication Review' | 'Initial Assessment' | 'Crisis Follow-up' | 'PRP Visit';

interface Appt {
  name: string;
  time: string;
  type: ApptType;
  status: VisitStatus;
  virtual: boolean;
  noteStatus: 'signed' | 'ai-draft' | 'not-started';
}

interface DayData {
  appts: Appt[];
}

interface Provider {
  id: string;
  name: string;
  title: string;
  initials: string;
  entity: Entity;
  role: string;
  days: Record<string, DayData>;
}

// ─── Config ───────────────────────────────────────────────────────────────────
// Appointments carry no entity / location in this feed, so no "MBH / CH / HB" badge is invented.
const PROVIDER_STYLE = { label: '', avatar: 'bg-blue-600' } as const;
const ENTITY_CFG: Record<Entity, typeof PROVIDER_STYLE> = { mbh: PROVIDER_STYLE, ch: PROVIDER_STYLE, hb: PROVIDER_STYLE };

// dot = status-bar / legend colour (Tailwind class); tone = badge tone (semantic)
const STATUS_CFG: Record<VisitStatus, { dot: string; tone: Tone; label: string }> = {
  'completed':   { dot: 'bg-emerald-500', tone: 'success', label: 'Seen' },
  'in-session':  { dot: 'bg-sky-600',     tone: 'info',    label: 'In Session' },
  'checked-in':  { dot: 'bg-sky-300',     tone: 'info',    label: 'Checked In' },
  'scheduled':   { dot: 'bg-slate-300',   tone: 'neutral', label: 'Scheduled' },
  'no-show':     { dot: 'bg-rose-500',    tone: 'danger',  label: 'No-Show' },
  'cancelled':   { dot: 'bg-slate-500',   tone: 'neutral', label: 'Cancelled' },
  'late-cancel': { dot: 'bg-amber-500',   tone: 'warning', label: 'Late Cancel' },
};

const NOTE_CFG: Record<Appt['noteStatus'], { tone: Tone; label: string }> = {
  'signed': { tone: 'success', label: 'Signed' },
  'ai-draft': { tone: 'brand', label: 'AI Draft' },
  'not-started': { tone: 'warning', label: 'Note Due' },
};

// Provider column + 5 day columns; the minimum widths make the grid scroll sideways on phones.
const GRID_COLS = 'grid grid-cols-[minmax(160px,220px)_repeat(5,minmax(96px,1fr))]';
const TH = 'whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-600';

const ALL_TYPES: ApptType[] = ['Individual Therapy', 'Group Therapy', 'Medication Review', 'Initial Assessment', 'Crisis Follow-up', 'PRP Visit'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function countByStatus(appts: Appt[]): Partial<Record<VisitStatus, number>> {
  const out: Partial<Record<VisitStatus, number>> = {};
  for (const ap of appts) out[ap.status] = (out[ap.status] ?? 0) + 1;
  return out;
}

function notesDueCount(appts: Appt[]): number {
  return appts.filter(ap =>
    (ap.status === 'completed' || ap.status === 'in-session') && ap.noteStatus === 'not-started'
  ).length;
}

function asApptType(type: string): ApptType {
  if ((ALL_TYPES as string[]).includes(type)) return type as ApptType;
  const lower = type.toLowerCase();
  if (lower.includes('group')) return 'Group Therapy';
  if (lower.includes('med')) return 'Medication Review';
  if (lower.includes('crisis')) return 'Crisis Follow-up';
  if (lower.includes('prp')) return 'PRP Visit';
  if (lower.includes('assess') || lower.includes('eval') || lower.includes('intake')) return 'Initial Assessment';
  return 'Individual Therapy';
}

function asVisitStatus(status: string): VisitStatus {
  if (status in STATUS_CFG) return status as VisitStatus;
  return 'scheduled';
}

function formatClock(time: string) {
  if (!time) return '';
  if (time.includes('AM') || time.includes('PM')) return time;
  const [hRaw, mRaw] = time.split(':');
  const h = Number(hRaw);
  if (!Number.isFinite(h)) return time;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = ((h + 11) % 12) + 1;
  return `${hour}:${(mRaw || '00').slice(0, 2)} ${suffix}`;
}

function buildLiveProviders(
  appts: Appointment[],
  weekDays: WeekDay[],
  roleById: Map<string, string>
): Provider[] {
  const weekAppts = appointmentsInWeek(appts, weekDays);
  const grouped = new Map<string, Appointment[]>();
  for (const row of weekAppts) {
    const key = row.clinicianId || row.clinicianName || 'unassigned';
    const list = grouped.get(key) || [];
    list.push(row);
    grouped.set(key, list);
  }
  return [...grouped.entries()].map(([id, rows]) => {
    const name = rows[0]?.clinicianName || 'Unassigned';
    const days: Record<string, DayData> = {};
    for (const day of weekDays) {
      days[day.key] = {
        appts: rows
          .filter((row) => row.date === day.iso)
          .map((row) => ({
            name: row.clientName,
            time: formatClock(row.startTime),
            type: asApptType(row.type),
            status: asVisitStatus(row.status),
            virtual: row.isVirtual,
            noteStatus:
              row.noteStatus === 'signed'
                ? 'signed'
                : row.noteStatus === 'ai-draft'
                  ? 'ai-draft'
                  : 'not-started',
          })),
      };
    }
    return {
      id,
      name,
      // Real staff role from the directory; not a hard-coded "Clinician".
      title: (rows[0]?.clinicianId && roleById.get(rows[0].clinicianId)) || 'Role not recorded',
      initials:
        name
          .split(' ')
          .filter(Boolean)
          .map((part) => part[0])
          .join('')
          .slice(0, 2)
          .toUpperCase() || '?',
      entity: 'mbh',
      role: 'therapist',
      days,
    };
  });
}

function heatColor(count: number, max: number): string {
  if (count === 0) return 'bg-slate-50';
  const ratio = count / max;
  if (ratio >= 0.85) return 'bg-blue-100';
  if (ratio >= 0.65) return 'bg-blue-50';
  if (ratio >= 0.4)  return 'bg-blue-50/50';
  return 'bg-white';
}

function StatusBar({ appts }: { appts: Appt[] }) {
  if (appts.length === 0) return null;
  const byStatus = countByStatus(appts);
  const order: VisitStatus[] = ['completed', 'in-session', 'checked-in', 'no-show', 'cancelled', 'late-cancel', 'scheduled'];
  const segments = order.filter(s => (byStatus[s] ?? 0) > 0).map(s => ({
    status: s, count: byStatus[s]!, pct: ((byStatus[s]! / appts.length) * 100).toFixed(1),
  }));
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden w-full mt-2 gap-px">
      {segments.map(seg => (
        <div key={seg.status} title={`${STATUS_CFG[seg.status].label}: ${seg.count}`}
          className={STATUS_CFG[seg.status].dot}
          style={{ width: `${seg.pct}%` }} />
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ScheduleAnalyticsPage() {
  const [selectedEntities, setSelectedEntities] = useState<Entity[]>([]);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<ApptType[]>([]);
  const [providerOpen, setProviderOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ providerId: string; dayKey: string } | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [rawAppts, setRawAppts] = useState<Appointment[]>([]);
  const [timeZone, setTimeZone] = useState(DEFAULT_PRACTICE_TIME_ZONE);
  const [liveLoading, setLiveLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { users: staffUsers } = useStaff();
  const roleById = useMemo(
    () => new Map(staffUsers.map((u) => [u.id, String(u.role).replace(/_/g, ' ')])),
    [staffUsers]
  );

  // Week and "today" on the practice clock, matching the API's practice-clock appointment dates
  const weekDays = useMemo(() => weekDaysForOffset(weekOffset, new Date(), timeZone), [weekOffset, timeZone]);
  const liveProviders = useMemo(
    () => buildLiveProviders(rawAppts, weekDays, roleById),
    [rawAppts, weekDays, roleById]
  );

  // Load only the visible week (practice-calendar days); refetch when the user moves weeks.
  const rangeFrom = weekDays[0]?.iso;
  const rangeTo = weekDays[weekDays.length - 1]?.iso;
  useEffect(() => {
    let cancelled = false;
    setLiveLoading(true);
    fetchAppointmentsWithZone(rangeFrom && rangeTo ? { from: rangeFrom, to: rangeTo } : undefined)
      .then(({ appointments, timeZone: tz }) => {
        if (cancelled) return;
        setRawAppts(appointments);
        setTimeZone(tz);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRawAppts([]);
        setLoadError(err instanceof Error ? err.message : 'Could not load appointments');
      })
      .finally(() => {
        if (!cancelled) setLiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rangeFrom, rangeTo]);

  useEffect(() => {
    setSelectedCell(null);
  }, [weekOffset]);

  const toggleEntity = (e: Entity) =>
    setSelectedEntities(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]);
  const toggleProvider = (id: string) =>
    setSelectedProviders(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleType = (t: ApptType) =>
    setSelectedTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const filteredProviders = useMemo(() => {
    let ps = liveProviders;
    if (selectedEntities.length) ps = ps.filter(p => selectedEntities.includes(p.entity));
    if (selectedProviders.length) ps = ps.filter(p => selectedProviders.includes(p.id));
    return ps;
  }, [liveProviders, selectedEntities, selectedProviders]);

  const filteredAppts = (appts: Appt[]): Appt[] =>
    selectedTypes.length ? appts.filter(ap => selectedTypes.includes(ap.type)) : appts;

  const weekTotals = useMemo(() => {
    let total = 0, completed = 0, noShows = 0, notesDue = 0;
    for (const p of filteredProviders) {
      for (const day of weekDays) {
        const appts = filteredAppts(p.days[day.key]?.appts ?? []);
        total += appts.length;
        completed += appts.filter(a => a.status === 'completed' || a.status === 'in-session').length;
        noShows += appts.filter(a => a.status === 'no-show').length;
        notesDue += notesDueCount(appts);
      }
    }
    const utilRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const noShowRate = total > 0 ? Math.round((noShows / total) * 100) : 0;
    return { total, utilRate, noShowRate, notesDue };
  }, [filteredProviders, selectedTypes, weekDays]);

  const maxDayCount = useMemo(() => {
    let max = 1;
    for (const p of filteredProviders) {
      for (const day of weekDays) {
        const c = filteredAppts(p.days[day.key]?.appts ?? []).length;
        if (c > max) max = c;
      }
    }
    return max;
  }, [filteredProviders, selectedTypes, weekDays]);

  const selectedDetail = useMemo(() => {
    if (!selectedCell) return null;
    const prov = liveProviders.find(p => p.id === selectedCell.providerId);
    if (!prov) return null;
    const day = weekDays.find(d => d.key === selectedCell.dayKey);
    const appts = filteredAppts(prov.days[selectedCell.dayKey]?.appts ?? []);
    return { prov, day, appts };
  }, [selectedCell, selectedTypes, liveProviders, weekDays]);

  const clearFilters = () => {
    setSelectedEntities([]); setSelectedProviders([]); setSelectedTypes([]);
  };
  const hasFilters = selectedEntities.length || selectedProviders.length || selectedTypes.length;

  const dropdownButton = (open: boolean) =>
    cx(
      'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
      FOCUS_RING,
      open ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    );

  return (
    <Page width="full" className="pb-10">

      {/* Header */}
      <PageHeader
        title="Schedule Analytics"
        description="Provider load and patient volume — live appointments for the selected week"
        actions={
          <>
            {weekOffset !== 0 ? (
              <Button variant="secondary" size="sm" onClick={() => setWeekOffset(0)}>
                This week
              </Button>
            ) : null}
            <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-1.5 py-1 shadow-xs">
              <IconButton
                label="Previous week"
                icon={<ChevronLeft size={16} />}
                onClick={() => setWeekOffset((o) => o - 1)}
                className="h-7 w-7 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              />
              <span className="mx-2 text-sm font-semibold tabular-nums text-slate-700">
                {formatWeekRange(weekDays)}
              </span>
              <IconButton
                label="Next week"
                icon={<ChevronRight size={16} />}
                onClick={() => setWeekOffset((o) => o + 1)}
                className="h-7 w-7 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              />
            </div>
          </>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <Filter size={14} aria-hidden className="text-slate-400" /> Filters
        </span>

        {/* Provider multi-select */}
        <div className="relative">
          <button type="button" aria-expanded={providerOpen} onClick={() => { setProviderOpen(v => !v); setTypeOpen(false); }}
            className={dropdownButton(providerOpen || selectedProviders.length > 0)}>
            <Users size={14} aria-hidden />
            Provider {selectedProviders.length ? `(${selectedProviders.length})` : ''}
          </button>
          {providerOpen && (
            <div className="absolute left-0 top-full z-20 mt-1.5 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              {liveProviders.map(p => (
                <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                  <input type="checkbox" checked={selectedProviders.includes(p.id)}
                    onChange={() => toggleProvider(p.id)} className="h-4 w-4 accent-blue-600" />
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-xs font-semibold text-slate-700">{p.name}</span>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Type multi-select */}
        <div className="relative">
          <button type="button" aria-expanded={typeOpen} onClick={() => { setTypeOpen(v => !v); setProviderOpen(false); }}
            className={dropdownButton(typeOpen || selectedTypes.length > 0)}>
            <BarChart2 size={14} aria-hidden />
            Visit Type {selectedTypes.length ? `(${selectedTypes.length})` : ''}
          </button>
          {typeOpen && (
            <div className="absolute left-0 top-full z-20 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              {ALL_TYPES.map(t => (
                <label key={t} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                  <input type="checkbox" checked={selectedTypes.includes(t)}
                    onChange={() => toggleType(t)} className="h-4 w-4 accent-blue-600" />
                  <span className="text-xs font-semibold text-slate-700">{t}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear all
          </Button>
        ) : null}
      </div>

      {/* KPI cards */}
      <StatGrid columns={4}>
        <StatCard label="Total Scheduled" value={weekTotals.total} icon={<CalendarDays />} tone="brand" />
        <StatCard label="Utilization Rate" value={`${weekTotals.utilRate}%`} icon={<CheckCircle2 />} tone="brand" />
        <StatCard label="No-Show Rate" value={`${weekTotals.noShowRate}%`} icon={<XCircle />} tone={weekTotals.noShowRate > 10 ? 'danger' : 'warning'} />
        <StatCard label="Notes Due" value={weekTotals.notesDue} icon={<AlertTriangle />} tone={weekTotals.notesDue > 0 ? 'danger' : 'brand'} />
      </StatGrid>

      {/* Provider Grid */}
      <Card className="overflow-hidden"
        onClick={(e) => { if ((e.target as HTMLElement).closest('[data-cell]') === null) setSelectedCell(null); }}>
        <div className="clinic-scroll-x">

          {/* Grid header */}
          <div className={cx(GRID_COLS, 'border-b border-slate-200')}>
            <div className="border-r border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
              Provider
            </div>
            {weekDays.map(day => (
              <div key={day.key} className={`border-r border-slate-200 px-3 py-3 text-center last:border-r-0 ${day.isToday ? 'bg-blue-50' : 'bg-slate-50'}`}>
                <p className={`text-xs font-semibold ${day.isToday ? 'text-blue-700' : 'text-slate-600'}`}>{day.key}</p>
                <p className={`mt-0.5 text-xs ${day.isToday ? 'font-semibold text-blue-700' : 'text-slate-500'}`}>{day.date}{day.isToday ? ' · Today' : ''}</p>
              </div>
            ))}
          </div>

          {filteredProviders.length === 0 && (
            liveLoading ? (
              <LoadingState label="Loading live appointments…" />
            ) : loadError ? (
              <ErrorState title={`Appointments could not load: ${loadError}`} />
            ) : (
              <EmptyState
                icon={<Users />}
                title={liveProviders.length === 0 ? 'No appointments this week' : 'No providers match the selected filters'}
              />
            )
          )}

          {filteredProviders.map((prov, pIdx) => {
            const ec = ENTITY_CFG[prov.entity];
            return (
              <div key={prov.id} className={cx(GRID_COLS, 'border-b border-slate-100 last:border-b-0', pIdx % 2 === 1 ? 'bg-slate-50/30' : '')}>

                {/* Provider info */}
                <div className="flex min-w-0 items-center gap-3 border-r border-slate-200 px-4 py-3">
                  <div aria-hidden className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white', ec.avatar)}>
                    {prov.initials}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-900">{prov.name}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="truncate text-xs text-slate-500">{prov.title}</span>
                    </div>
                  </div>
                </div>

                {/* Day cells */}
                {weekDays.map(day => {
                  const rawAppts = prov.days[day.key]?.appts ?? [];
                  const appts = filteredAppts(rawAppts);
                  const total = appts.length;
                  const active = selectedCell?.providerId === prov.id && selectedCell?.dayKey === day.key;
                  const nd = notesDueCount(appts);
                  const inSess = appts.filter(a => a.status === 'in-session').length;
                  const checkedIn = appts.filter(a => a.status === 'checked-in').length;
                  const cellClass = cx(
                    'border-r border-slate-100 px-3 py-3 text-left transition last:border-r-0',
                    active ? 'bg-blue-50 ring-2 ring-inset ring-blue-400' : heatColor(total, maxDayCount),
                  );

                  if (total === 0) {
                    return (
                      <div key={day.key} data-cell="1" onClick={() => setSelectedCell(null)} className={cx(cellClass, 'cursor-default')}>
                        <p className="pt-1 text-center text-xs text-slate-500">—</p>
                      </div>
                    );
                  }
                  return (
                    <button key={day.key} type="button" data-cell="1"
                      aria-pressed={active}
                      aria-label={`${prov.name}, ${day.key} ${day.date}: ${total} appointment${total !== 1 ? 's' : ''}`}
                      onClick={() => setSelectedCell(active ? null : { providerId: prov.id, dayKey: day.key })}
                      className={cx(cellClass, 'cursor-pointer hover:brightness-95', FOCUS_RING)}>
                      <div className="flex items-baseline justify-between gap-1.5">
                        <span className="text-xl font-semibold tabular-nums text-slate-900">{total}</span>
                        <div className="flex flex-col items-end gap-0.5">
                          {inSess > 0 && (
                            <span className="flex items-center gap-0.5 text-xs font-semibold text-sky-800">
                              <span className={cx('inline-block h-1.5 w-1.5 rounded-full', STATUS_CFG['in-session'].dot)} />{inSess}
                            </span>
                          )}
                          {checkedIn > 0 && (
                            <span className="flex items-center gap-0.5 text-xs font-semibold text-sky-800">
                              <span className={cx('inline-block h-1.5 w-1.5 rounded-full', STATUS_CFG['checked-in'].dot)} />{checkedIn}
                            </span>
                          )}
                        </div>
                      </div>
                      <StatusBar appts={appts} />
                      {nd > 0 && (
                        <p className="mt-1.5 flex items-center gap-0.5 text-xs font-semibold text-amber-800">
                          <AlertTriangle size={12} aria-hidden />{nd} note{nd > 1 ? 's' : ''} due
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <span className="mr-1 text-xs font-semibold text-slate-600">Legend</span>
          {(['completed','in-session','checked-in','scheduled','no-show','cancelled','late-cancel'] as VisitStatus[]).map(s => (
            <span key={s} className="flex items-center gap-1 text-xs text-slate-600">
              <span aria-hidden className={cx('inline-block h-2 w-2 rounded-full', STATUS_CFG[s].dot)} />
              {STATUS_CFG[s].label}
            </span>
          ))}
          <span className="ml-auto text-xs text-slate-500">Click any cell to see appointments</span>
        </div>
      </Card>

      {/* Detail drawer */}
      {selectedDetail && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div aria-hidden className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white', ENTITY_CFG[selectedDetail.prov.entity].avatar)}>
                {selectedDetail.prov.initials}
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900">{selectedDetail.prov.name}</h2>
                <p className="text-xs text-slate-500">
                  {selectedDetail.day?.key} {selectedDetail.day?.date} · {selectedDetail.appts.length} appointment{selectedDetail.appts.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setSelectedCell(null)}>
              Close
            </Button>
          </div>

          <div className="divide-y divide-slate-100">
            {selectedDetail.appts.length === 0 && (
              <EmptyState compact title="No appointments match current filters" />
            )}
            {selectedDetail.appts.map((ap, idx) => {
              const sc = STATUS_CFG[ap.status];
              const noteCfg = NOTE_CFG[ap.noteStatus];
              return (
                <div key={idx} className="flex flex-wrap items-center gap-4 px-5 py-3.5 transition-colors hover:bg-slate-50">
                  <div className="w-24 shrink-0">
                    <p className="text-sm font-semibold text-slate-900">{ap.time} <span className="text-[11px] font-medium text-slate-500">{practiceZoneLabel(timeZone)}</span></p>
                    {ap.virtual && <p className="text-xs font-semibold text-blue-700">Virtual</p>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{ap.name}</p>
                    <p className="text-xs text-slate-500">{ap.type}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge tone={sc.tone} dot>{sc.label}</StatusBadge>
                    {(ap.status === 'completed' || ap.status === 'in-session') && (
                      <StatusBadge tone={noteCfg.tone}>{noteCfg.label}</StatusBadge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Day summary footer */}
          <div className="flex flex-wrap gap-4 border-t border-slate-200 bg-slate-50 px-5 py-3">
            {(['completed','in-session','checked-in','scheduled','no-show','cancelled','late-cancel'] as VisitStatus[]).map(s => {
              const c = selectedDetail.appts.filter(a => a.status === s).length;
              if (c === 0) return null;
              return (
                <span key={s} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span aria-hidden className={cx('h-2 w-2 rounded-full', STATUS_CFG[s].dot)} />
                  <span className="font-semibold">{c}</span> {STATUS_CFG[s].label}
                </span>
              );
            })}
            {notesDueCount(selectedDetail.appts) > 0 && (
              <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-amber-800">
                <AlertTriangle size={12} aria-hidden />{notesDueCount(selectedDetail.appts)} note{notesDueCount(selectedDetail.appts) > 1 ? 's' : ''} due
              </span>
            )}
          </div>
        </Card>
      )}

      {/* Weekly summary table */}
      <Card className="overflow-hidden">
        <CardHeader title="Weekly Summary by Provider" />
        <div className="clinic-scroll-x">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th scope="col" className={cx(TH, 'sticky left-0 z-10 bg-slate-50 text-left')}>Provider</th>
                <th scope="col" className={cx(TH, 'text-center')}>Total</th>
                <th scope="col" className={cx(TH, 'text-center')}>Seen</th>
                <th scope="col" className={cx(TH, 'text-center')}>No-Show</th>
                <th scope="col" className={cx(TH, 'text-center')}>Cancellations</th>
                <th scope="col" className={cx(TH, 'text-center')}>Utilization</th>
                <th scope="col" className={cx(TH, 'text-center')}>Notes Due</th>
                <th scope="col" className={cx(TH, 'text-center')}>Avg/Day</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProviders.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState compact title={liveLoading ? 'Loading live appointments…' : 'No providers to summarise for this week'} />
                  </td>
                </tr>
              ) : null}
              {filteredProviders.map((prov) => {
                const ec = ENTITY_CFG[prov.entity];
                let total = 0, seen = 0, noShow = 0, cancel = 0, notesDue = 0;
                for (const day of weekDays) {
                  const appts = filteredAppts(prov.days[day.key]?.appts ?? []);
                  total += appts.length;
                  seen += appts.filter(a => a.status === 'completed' || a.status === 'in-session').length;
                  noShow += appts.filter(a => a.status === 'no-show').length;
                  cancel += appts.filter(a => a.status === 'cancelled' || a.status === 'late-cancel').length;
                  notesDue += notesDueCount(appts);
                }
                const util = total > 0 ? Math.round((seen / total) * 100) : 0;
                const avgDay = (total / 5).toFixed(1);
                return (
                  <tr key={prov.id} className="group hover:bg-slate-50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-3 group-hover:bg-slate-50">
                      <div className="flex items-center gap-2.5">
                        <div aria-hidden className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white', ec.avatar)}>
                          {prov.initials}
                        </div>
                        <div className="min-w-0">
                          <p className="whitespace-nowrap text-xs font-semibold text-slate-900">{prov.name}</p>
                          <p className="whitespace-nowrap text-xs text-slate-500">{prov.title}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center font-semibold tabular-nums text-slate-900">{total}</td>
                    <td className="px-4 py-3 text-center font-semibold tabular-nums text-blue-700">{seen}</td>
                    <td className={cx('px-4 py-3 text-center font-semibold tabular-nums', noShow > 0 ? 'text-amber-800' : 'text-slate-500')}>{noShow}</td>
                    <td className={cx('px-4 py-3 text-center font-semibold tabular-nums', cancel > 0 ? 'text-rose-700' : 'text-slate-500')}>{cancel}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                          <div className={cx('h-full rounded-full', util >= 60 ? 'bg-blue-600' : 'bg-amber-500')} style={{ width: `${util}%` }} />
                        </div>
                        <span className={cx('text-xs font-semibold tabular-nums', util >= 60 ? 'text-blue-700' : 'text-amber-800')}>{util}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {notesDue > 0
                        ? <span className="flex items-center justify-center gap-0.5 text-xs font-semibold text-amber-800"><AlertTriangle size={12} aria-hidden />{notesDue}</span>
                        : <span className="flex items-center justify-center text-emerald-700"><CheckCircle2 size={14} aria-label="No notes due" /></span>}
                    </td>
                    <td className="px-4 py-3 text-center font-semibold tabular-nums text-slate-600">{avgDay}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

    </Page>
  );
}
