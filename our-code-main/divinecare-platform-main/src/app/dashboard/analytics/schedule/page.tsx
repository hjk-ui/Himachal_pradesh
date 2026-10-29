'use client';
import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Filter, Users, BarChart2, CheckCircle2, AlertTriangle, XCircle, CalendarDays } from 'lucide-react';
import { fetchAppointments, type Appointment } from '@/features/appointments';
import {
  appointmentsInWeek,
  formatWeekRange,
  weekDaysForOffset,
  type WeekDay,
} from '@/features/analytics/scheduleWeek';

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
const ENTITY_CFG = {
  mbh: { label: 'MBH', color: '#6868D0', bg: '#EEF2FF', border: '#C7D2FE' },
  ch:  { label: 'CH',  color: '#6868D0', bg: '#EEF0FE', border: '#C5C7F8' },
  hb:  { label: 'HB',  color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
} as const;

const STATUS_CFG: Record<VisitStatus, { dot: string; bg: string; label: string }> = {
  'completed':   { dot: '#6868D0', bg: '#F5F3FF', label: 'Seen' },
  'in-session':  { dot: '#7878E0', bg: '#EEF0FE', label: 'In Session' },
  'checked-in':  { dot: '#3B82F6', bg: '#EEF0FE', label: 'Checked In' },
  'scheduled':   { dot: '#94A3B8', bg: '#F8FAFC', label: 'Scheduled' },
  'no-show':     { dot: '#F59E0B', bg: '#FFFBEB', label: 'No-Show' },
  'cancelled':   { dot: '#EF4444', bg: '#FEF2F2', label: 'Cancelled' },
  'late-cancel': { dot: '#F97316', bg: '#FFF7ED', label: 'Late Cancel' },
};

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

function buildLiveProviders(appts: Appointment[], weekDays: WeekDay[]): Provider[] {
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
      title: 'Clinician',
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
  if (count === 0) return '#F8FAFC';
  const ratio = count / max;
  if (ratio >= 0.85) return '#EDE9FE';
  if (ratio >= 0.65) return '#F5F3FF';
  if (ratio >= 0.4)  return '#FAF9FF';
  return '#FDFCFF';
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
          style={{ width: `${seg.pct}%`, backgroundColor: STATUS_CFG[seg.status].dot }} />
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
  const [liveLoading, setLiveLoading] = useState(true);

  const weekDays = useMemo(() => weekDaysForOffset(weekOffset), [weekOffset]);
  const liveProviders = useMemo(
    () => buildLiveProviders(rawAppts, weekDays),
    [rawAppts, weekDays]
  );

  useEffect(() => {
    let cancelled = false;
    fetchAppointments()
      .then((appts) => {
        if (!cancelled) setRawAppts(appts);
      })
      .catch(() => {
        if (!cancelled) setRawAppts([]);
      })
      .finally(() => {
        if (!cancelled) setLiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <div className="space-y-5 pb-10">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Schedule Analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Provider load and patient volume — live appointments for the selected week
          </p>
        </div>
        <div className="flex items-center gap-2">
          {weekOffset !== 0 ? (
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              This week
            </button>
          ) : null}
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-3 py-2">
            <button
              type="button"
              aria-label="Previous week"
              onClick={() => setWeekOffset((o) => o - 1)}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-slate-700 mx-2 tabular-nums">
              {formatWeekRange(weekDays)}
            </span>
            <button
              type="button"
              aria-label="Next week"
              onClick={() => setWeekOffset((o) => o + 1)}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mr-1">
          <Filter size={13} /> Filters
        </span>

        {/* Entity chips */}
        {(['mbh','ch','hb'] as Entity[]).map(e => {
          const cfg = ENTITY_CFG[e];
          const active = selectedEntities.includes(e);
          return (
            <button key={e} onClick={() => toggleEntity(e)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all"
              style={active
                ? { backgroundColor: cfg.bg, color: cfg.color, borderColor: cfg.border }
                : { backgroundColor: '#F8FAFC', color: '#64748B', borderColor: '#E2E8F0' }}>
              {cfg.label}
            </button>
          );
        })}

        <div className="w-px h-5 bg-slate-200 mx-1" />

        {/* Provider multi-select */}
        <div className="relative">
          <button onClick={() => { setProviderOpen(v => !v); setTypeOpen(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${providerOpen || selectedProviders.length ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'}`}>
            <Users size={13} />
            Provider {selectedProviders.length ? `(${selectedProviders.length})` : ''}
          </button>
          {providerOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1">
              {liveProviders.map(p => {
                const ec = ENTITY_CFG[p.entity];
                return (
                  <label key={p.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={selectedProviders.includes(p.id)}
                      onChange={() => toggleProvider(p.id)} className="w-3.5 h-3.5 accent-blue-600" />
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: ec.bg, color: ec.color }}>{ec.label}</span>
                      <span className="text-xs font-semibold text-slate-700 truncate">{p.name}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Type multi-select */}
        <div className="relative">
          <button onClick={() => { setTypeOpen(v => !v); setProviderOpen(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${typeOpen || selectedTypes.length ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'}`}>
            <BarChart2 size={13} />
            Visit Type {selectedTypes.length ? `(${selectedTypes.length})` : ''}
          </button>
          {typeOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1">
              {ALL_TYPES.map(t => (
                <label key={t} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={selectedTypes.includes(t)}
                    onChange={() => toggleType(t)} className="w-3.5 h-3.5 accent-blue-600" />
                  <span className="text-xs font-semibold text-slate-700">{t}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {hasFilters ? (
          <button onClick={clearFilters} className="px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 bg-red-50 ring-1 ring-inset ring-red-100 hover:bg-red-100 transition-all">
            Clear all
          </button>
        ) : null}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Scheduled', value: weekTotals.total, icon: CalendarDays, color: '#6868D0', bg: '#EEF2FF' },
          { label: 'Utilization Rate', value: `${weekTotals.utilRate}%`, icon: CheckCircle2, color: '#6868D0', bg: '#EEF0FE' },
          { label: 'No-Show Rate', value: `${weekTotals.noShowRate}%`, icon: XCircle, color: weekTotals.noShowRate > 10 ? '#DC2626' : '#D97706', bg: weekTotals.noShowRate > 10 ? '#FEF2F2' : '#FFFBEB' },
          { label: 'Notes Due', value: weekTotals.notesDue, icon: AlertTriangle, color: weekTotals.notesDue > 0 ? '#DC2626' : '#6868D0', bg: weekTotals.notesDue > 0 ? '#FEF2F2' : '#EEF0FE' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-xl border p-4" style={{ backgroundColor: bg, borderColor: color + '25' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500">{label}</span>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + '20' }}>
                <Icon size={14} style={{ color }} />
              </div>
            </div>
            <p className="text-2xl font-semibold" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Provider Grid */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden"
        onClick={(e) => { if ((e.target as HTMLElement).closest('[data-cell]') === null) setSelectedCell(null); }}>

        {/* Grid header */}
        <div className="grid border-b border-slate-200/80" style={{ gridTemplateColumns: '220px repeat(5, 1fr)' }}>
          <div className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-50 border-r border-slate-200/80">
            Provider
          </div>
          {weekDays.map(day => (
            <div key={day.key} className={`px-3 py-3 text-center border-r border-slate-200/80 last:border-r-0 ${day.isToday ? 'bg-blue-50' : 'bg-slate-50'}`}>
              <p className={`text-xs font-semibold uppercase tracking-wider ${day.isToday ? 'text-blue-600' : 'text-slate-500'}`}>{day.key}</p>
              <p className={`text-xs mt-0.5 ${day.isToday ? 'text-blue-500 font-semibold' : 'text-slate-400'}`}>{day.date}{day.isToday ? ' · Today' : ''}</p>
            </div>
          ))}
        </div>

        {filteredProviders.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Users size={32} className="mx-auto mb-3 opacity-30" />
            <p className="font-semibold">
              {liveLoading
                ? 'Loading live appointments…'
                : liveProviders.length === 0
                  ? 'No appointments this week'
                  : 'No providers match the selected filters'}
            </p>
          </div>
        )}

        {filteredProviders.map((prov, pIdx) => {
          const ec = ENTITY_CFG[prov.entity];
          return (
            <div key={prov.id} className={`grid border-b border-slate-50 last:border-b-0 ${pIdx % 2 === 1 ? 'bg-slate-50/30' : ''}`}
              style={{ gridTemplateColumns: '220px repeat(5, 1fr)' }}>

              {/* Provider info */}
              <div className="px-4 py-3 border-r border-slate-200/80 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                  style={{ backgroundColor: ec.color }}>
                  {prov.initials}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 truncate">{prov.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs px-1.5 py-px rounded font-bold" style={{ backgroundColor: ec.bg, color: ec.color }}>{ec.label}</span>
                    <span className="text-xs text-slate-400 truncate">{prov.title}</span>
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

                return (
                  <div key={day.key} data-cell="1"
                    onClick={() => setSelectedCell(total > 0 ? (active ? null : { providerId: prov.id, dayKey: day.key }) : null)}
                    className={`px-3 py-3 border-r border-slate-50 last:border-r-0 transition-all ${total > 0 ? 'cursor-pointer' : 'cursor-default'} ${active ? 'ring-2 ring-blue-400 ring-inset' : ''} ${day.isToday ? 'bg-blue-50/40' : ''}`}
                    style={{ backgroundColor: active ? '#EEF2FF' : heatColor(total, maxDayCount) }}>
                    {total === 0 ? (
                      <p className="text-xs text-slate-300 text-center pt-1">—</p>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-1.5 justify-between">
                          <span className="text-xl font-semibold text-slate-900">{total}</span>
                          <div className="flex flex-col items-end gap-0.5">
                            {inSess > 0 && (
                              <span className="text-xs font-bold text-blue-600 flex items-center gap-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />{inSess}
                              </span>
                            )}
                            {checkedIn > 0 && (
                              <span className="text-xs font-bold text-blue-600 flex items-center gap-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />{checkedIn}
                              </span>
                            )}
                          </div>
                        </div>
                        <StatusBar appts={appts} />
                        {nd > 0 && (
                          <p className="text-xs text-amber-600 font-semibold mt-1.5 flex items-center gap-0.5">
                            <AlertTriangle size={10} />{nd} note{nd > 1 ? 's' : ''} due
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Legend */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200/80 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-1">Legend</span>
          {(['completed','in-session','checked-in','scheduled','no-show','cancelled','late-cancel'] as VisitStatus[]).map(s => (
            <span key={s} className="flex items-center gap-1 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: STATUS_CFG[s].dot }} />
              {STATUS_CFG[s].label}
            </span>
          ))}
          <span className="ml-auto text-xs text-slate-400">Click any cell to see appointments</span>
        </div>
      </div>

      {/* Detail drawer */}
      {selectedDetail && (
        <div className="bg-white rounded-xl ring-1 ring-inset ring-blue-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between"
            style={{ background: 'linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 100%)' }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                style={{ backgroundColor: ENTITY_CFG[selectedDetail.prov.entity].color }}>
                {selectedDetail.prov.initials}
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-sm">{selectedDetail.prov.name}</p>
                <p className="text-xs text-slate-500">
                  {selectedDetail.day?.key} {selectedDetail.day?.date} · {selectedDetail.appts.length} appointment{selectedDetail.appts.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <button onClick={() => setSelectedCell(null)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg bg-white/70 hover:bg-white border border-slate-200 transition-all">
              Close
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {selectedDetail.appts.length === 0 && (
              <p className="text-center py-8 text-slate-400 text-sm">No appointments match current filters</p>
            )}
            {selectedDetail.appts.map((ap, idx) => {
              const sc = STATUS_CFG[ap.status];
              const noteColors = {
                'signed': { color: '#6868D0', bg: '#EEF0FE', label: 'Signed' },
                'ai-draft': { color: '#6868D0', bg: '#F5F3FF', label: 'AI Draft' },
                'not-started': { color: '#D97706', bg: '#FFFBEB', label: 'Note Due' },
              }[ap.noteStatus];
              return (
                <div key={idx} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/50 transition-colors">
                  <div className="w-20 shrink-0">
                    <p className="text-sm font-semibold text-slate-900">{ap.time}</p>
                    {ap.virtual && <p className="text-xs text-blue-600 font-semibold">Virtual</p>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{ap.name}</p>
                    <p className="text-xs text-slate-500">{ap.type}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border"
                      style={{ backgroundColor: sc.bg, color: sc.dot, borderColor: sc.dot + '40' }}>
                      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: sc.dot }} />
                      {sc.label}
                    </span>
                    {(ap.status === 'completed' || ap.status === 'in-session') && (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border"
                        style={{ backgroundColor: noteColors.bg, color: noteColors.color, borderColor: noteColors.color + '40' }}>
                        {noteColors.label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Day summary footer */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-200/80 flex flex-wrap gap-4">
            {(['completed','in-session','checked-in','scheduled','no-show','cancelled','late-cancel'] as VisitStatus[]).map(s => {
              const c = selectedDetail.appts.filter(a => a.status === s).length;
              if (c === 0) return null;
              return (
                <span key={s} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_CFG[s].dot }} />
                  <span className="font-semibold">{c}</span> {STATUS_CFG[s].label}
                </span>
              );
            })}
            {notesDueCount(selectedDetail.appts) > 0 && (
              <span className="ml-auto text-xs font-bold text-amber-600 flex items-center gap-1">
                <AlertTriangle size={12} />{notesDueCount(selectedDetail.appts)} note{notesDueCount(selectedDetail.appts) > 1 ? 's' : ''} due
              </span>
            )}
          </div>
        </div>
      )}

      {/* Weekly summary table */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200/80">
          <h2 className="font-semibold text-slate-900 text-sm">Weekly Summary by Provider</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80">
                <th className="text-left px-4 py-2.5 font-bold text-slate-500 uppercase tracking-wider">Provider</th>
                <th className="text-center px-3 py-2.5 font-bold text-slate-500 uppercase tracking-wider">Total</th>
                <th className="text-center px-3 py-2.5 font-bold text-slate-500 uppercase tracking-wider">Seen</th>
                <th className="text-center px-3 py-2.5 font-bold text-slate-500 uppercase tracking-wider">No-Show</th>
                <th className="text-center px-3 py-2.5 font-bold text-slate-500 uppercase tracking-wider">Cancellations</th>
                <th className="text-center px-3 py-2.5 font-bold text-slate-500 uppercase tracking-wider">Utilization</th>
                <th className="text-center px-3 py-2.5 font-bold text-slate-500 uppercase tracking-wider">Notes Due</th>
                <th className="text-center px-3 py-2.5 font-bold text-slate-500 uppercase tracking-wider">Avg/Day</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProviders.map((prov, idx) => {
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
                  <tr key={prov.id} className={idx % 2 === 1 ? 'bg-slate-50/40' : ''}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                          style={{ backgroundColor: ec.color }}>
                          {prov.initials}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900">{prov.name}</p>
                          <p className="text-slate-400">{prov.title}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center font-semibold text-slate-900 text-sm">{total}</td>
                    <td className="px-3 py-3 text-center font-semibold text-blue-700">{seen}</td>
                    <td className="px-3 py-3 text-center font-semibold" style={{ color: noShow > 0 ? '#D97706' : '#94A3B8' }}>{noShow}</td>
                    <td className="px-3 py-3 text-center font-semibold" style={{ color: cancel > 0 ? '#EF4444' : '#94A3B8' }}>{cancel}</td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${util}%`, backgroundColor: util >= 80 ? '#6868D0' : util >= 60 ? '#6868D0' : '#D97706' }} />
                        </div>
                        <span className="font-bold" style={{ color: util >= 80 ? '#6868D0' : util >= 60 ? '#6868D0' : '#D97706' }}>{util}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      {notesDue > 0
                        ? <span className="font-bold text-amber-600 flex items-center justify-center gap-0.5"><AlertTriangle size={11} />{notesDue}</span>
                        : <span className="text-blue-600 font-bold flex items-center justify-center"><CheckCircle2 size={13} /></span>}
                    </td>
                    <td className="px-3 py-3 text-center font-semibold text-slate-600">{avgDay}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
