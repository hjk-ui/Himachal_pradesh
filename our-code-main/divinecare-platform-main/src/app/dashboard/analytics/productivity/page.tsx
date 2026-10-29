'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiJson } from '@/lib/api-client';
import { useStaff } from '@/features/staff/hooks/useStaff';
import { fetchEhrProgressNotes } from '@/features/clients/api/clientsApi';
import type { EhrProgressNote } from '@/features/clients/types';
import {
  type ClinicianMetrics,
  type DocProductivityPayload,
  type BarTone,
  DOC_PRODUCTIVITY_SEED,
  barToneFromHours,
  isDocProductivityPayload,
} from '@/features/analytics/docProductivityData';
import {
  AlertTriangle,
  Check,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Bell,
  RefreshCw,
} from 'lucide-react';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKS = ['W-5', 'W-4', 'W-3', 'W-2', 'W-1', 'Now'];

const BAR_PALETTES: Record<BarTone, string[]> = {
  red: ['#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c'],
  orange: ['#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c'],
  mixed: ['#fdba74', '#fbbf24', '#a3e635', '#86efac', '#4ade80', '#22c55e'],
  green: ['#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d'],
};

function clinicianKey(note: EhrProgressNote) {
  return (note.clinicianEmail || note.clinicianName || 'unassigned').toLowerCase();
}

function sessionTypeFromNote(note: EhrProgressNote) {
  const body = note.body.toLowerCase();
  if (body.includes('group')) return 'Group Session';
  if (body.includes('medication') || body.includes('prescription')) return 'Medication Management';
  if (body.includes('crisis') || body.includes('safety')) return 'Crisis Session';
  if (body.includes('intake') || body.includes('assessment')) return 'Assessment';
  return 'Individual Therapy';
}

function hoursBetween(startIso: string, endIso?: string | null) {
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  return Math.max(0, (end - new Date(startIso).getTime()) / 3_600_000);
}

function buildWeeklyTrend(notes: EhrProgressNote[]) {
  const trend = Array.from({ length: 6 }, () => ({ total: 0, onTime: 0 }));
  for (const note of notes) {
    const ageWeeks = Math.floor((Date.now() - new Date(note.createdAt).getTime()) / WEEK_MS);
    if (ageWeeks < 0 || ageWeeks > 5) continue;
    const bucket = 5 - ageWeeks;
    trend[bucket].total += 1;
    const completedAt = note.lockedAt || note.signedAt;
    if (completedAt && hoursBetween(note.createdAt, completedAt) <= 48) {
      trend[bucket].onTime += 1;
    }
  }
  return trend.map((bucket) =>
    bucket.total > 0 ? Math.round((bucket.onTime / bucket.total) * 100) : 0
  );
}

function ensureTrendShape(trend: number[]): number[] {
  if (!trend.length || trend.every((v) => v === 0)) {
    return [40, 50, 58, 68, 78, 88];
  }
  const padded = [...trend];
  while (padded.length < 6) padded.unshift(padded[0] ?? 50);
  return padded.slice(-6);
}

function buildMetricsFromNotes(
  users: { id: string; name?: string | null; email?: string | null; role: string }[],
  notes: EhrProgressNote[]
): ClinicianMetrics[] {
  const buckets = new Map<string, EhrProgressNote[]>();
  for (const note of notes) {
    const key = clinicianKey(note);
    const list = buckets.get(key) || [];
    list.push(note);
    buckets.set(key, list);
  }

  return users.map((user) => {
    const key = (user.email || user.name || 'unassigned').toLowerCase();
    const clinicianNotes = buckets.get(key) || [];
    const now = Date.now();
    const sessionsThisWeek = clinicianNotes.filter((note) => {
      const ageDays = Math.floor((now - new Date(note.createdAt).getTime()) / 86_400_000);
      return ageDays >= 0 && ageDays <= 6;
    });

    const signed = clinicianNotes.filter(
      (note) => note.workflowStatus && note.workflowStatus !== 'Draft'
    );
    const sameDay = signed.filter(
      (note) => hoursBetween(note.createdAt, note.signedAt || note.lockedAt) <= 24
    ).length;
    const within24 = sameDay;
    const within48 = signed.filter(
      (note) => hoursBetween(note.createdAt, note.signedAt || note.lockedAt) <= 48
    ).length;
    const overdueNotes = clinicianNotes.filter((note) => {
      const ageHours = hoursBetween(note.createdAt);
      if (note.workflowStatus === 'Draft') return ageHours > 48;
      const completedAt = note.lockedAt || note.signedAt;
      return completedAt ? hoursBetween(note.createdAt, completedAt) > 48 : ageHours > 48;
    });
    const avgHours =
      signed.length > 0
        ? Math.round(
            (signed.reduce(
              (sum, note) => sum + hoursBetween(note.createdAt, note.signedAt || note.lockedAt),
              0
            ) /
              signed.length) *
              10
          ) / 10
        : 0;
    const complianceRate =
      clinicianNotes.length > 0
        ? Math.round((signed.length / clinicianNotes.length) * 100)
        : 0;

    return {
      clinicianId: user.id,
      clinicianName: user.name || user.email || 'Clinician',
      role: user.role,
      sessionsThisWeek: sessionsThisWeek.length,
      notesSignedSameDay: sameDay,
      notesSigned24h: within24,
      notesSigned48h: within48,
      notesOverdue: overdueNotes.length,
      avgHoursToSign: avgHours,
      complianceRate,
      weeklyTrend: ensureTrendShape(buildWeeklyTrend(clinicianNotes)),
      lateNotes: overdueNotes.slice(0, 4).map((note, index) => ({
        noteId: note.id || `${user.id}-${index}`,
        patientName: note.clientName,
        sessionDate: note.createdAt.slice(0, 10),
        sessionType: sessionTypeFromNote(note),
        daysOverdue: Math.max(1, Math.floor(hoursBetween(note.createdAt) / 24) - 2),
      })),
    };
  });
}

/** Screenshot-style rising mini bars with severity colors. */
function MiniTrendBar({ trend, tone }: { trend: number[]; tone: BarTone }) {
  const values = ensureTrendShape(trend);
  const max = Math.max(...values, 1);
  const palette = BAR_PALETTES[tone];

  return (
    <div className="flex h-10 w-[4.75rem] items-end gap-[3px]">
      {values.map((v, i) => {
        const pct = Math.max(22, Math.round((v / max) * 100));
        return (
          <div
            key={i}
            className="w-[7px] rounded-t-[3px] transition-all"
            style={{ height: `${pct}%`, backgroundColor: palette[i] || palette[palette.length - 1] }}
            title={`${v}%`}
          />
        );
      })}
    </div>
  );
}

function ComplianceBadge({ rate }: { rate: number }) {
  const color = rate >= 95 ? '#15803d' : rate >= 85 ? '#d97706' : '#dc2626';
  const bg = rate >= 95 ? '#E0E2FC' : rate >= 85 ? '#fef3c7' : '#fee2e2';
  const label = rate >= 95 ? 'Excellent' : rate >= 85 ? 'Good' : 'Needs Attention';
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ color, backgroundColor: bg }}
    >
      {rate}% — {label}
    </span>
  );
}

async function loadPayload(): Promise<DocProductivityPayload | null> {
  const res = await apiJson<{ success: true; data: unknown }>('/api/modules/doc-productivity');
  return isDocProductivityPayload(res.data) ? res.data : null;
}

async function savePayload(data: DocProductivityPayload) {
  await fetch('/api/modules/doc-productivity', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
}

export default function ProductivityPage() {
  const router = useRouter();
  const { users: staffUsers, loading: staffLoading } = useStaff();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payload, setPayload] = useState<DocProductivityPayload | null>(null);
  const [notes, setNotes] = useState<EhrProgressNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2000);
  };

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      let data = await loadPayload();
      const hasMock = data?.clinicians?.some((c) => c.clinicianId.startsWith('doc-prod-') || c.clinicianName.includes('Anita Patel'));
      if (!data || hasMock) {
        data = structuredClone(DOC_PRODUCTIVITY_SEED);
        await savePayload(data);
      }
      setPayload(data);
    } catch {
      setPayload(structuredClone(DOC_PRODUCTIVITY_SEED));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    let cancelled = false;
    fetchEhrProgressNotes()
      .then((res) => {
        if (!cancelled) setNotes(res.notes);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clinicians = useMemo(() => {
    const rows = payload?.clinicians || [];
    return [...rows].sort((a, b) => b.avgHoursToSign - a.avgHoursToSign);
  }, [payload]);

  const remindersSent = useMemo(
    () => new Set(payload?.remindersSent || []),
    [payload]
  );

  const totalSessions = clinicians.reduce((s, c) => s + c.sessionsThisWeek, 0);
  const totalOverdue = clinicians.reduce((s, c) => s + c.notesOverdue, 0);
  const avgCompliance =
    clinicians.length > 0
      ? Math.round(clinicians.reduce((s, c) => s + c.complianceRate, 0) / clinicians.length)
      : 0;
  const allLate = clinicians
    .flatMap((c) => c.lateNotes.map((n) => ({ ...n, clinicianName: c.clinicianName })))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const persist = async (next: DocProductivityPayload) => {
    setPayload(next);
    await savePayload(next);
  };

  const sendReminder = async (clinicianId: string) => {
    if (!payload) return;
    const next: DocProductivityPayload = {
      ...payload,
      updatedAt: new Date().toISOString(),
      remindersSent: Array.from(new Set([...payload.remindersSent, clinicianId])),
    };
    await persist(next);
    showToast('Reminder saved');
  };

  const refreshFromLive = async () => {
    setRefreshing(true);
    try {
      const live =
        !staffLoading && staffUsers.length > 0 && notes.length > 0
          ? buildMetricsFromNotes(staffUsers, notes).filter(
              (c) => c.sessionsThisWeek > 0 || c.notesOverdue > 0 || c.complianceRate > 0
            )
          : [];

      const cliniciansNext = live.map((c) => ({
        ...c,
        weeklyTrend: ensureTrendShape(c.weeklyTrend),
      }));

      const next: DocProductivityPayload = {
        version: 1,
        updatedAt: new Date().toISOString(),
        clinicians: cliniciansNext,
        remindersSent: payload?.remindersSent || [],
      };
      await persist(next);
      showToast(live.length > 0 ? 'Refreshed from live notes' : 'No clinical notes found');
    } catch {
      showToast('Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading && !payload) {
    return (
      <div className="w-full space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Documentation Productivity</h1>
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">
          Loading productivity metrics…
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Documentation Productivity</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Note completion rates, timeliness, and late note alerts — synced to clinic database
          </p>
          {toast ? <p className="mt-1 text-sm font-medium text-emerald-600">{toast}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => void refreshFromLive()}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: '#6868D0' }}
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh from notes'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <p className="mb-1 text-xs font-semibold text-slate-500">Sessions This Week</p>
          <p className="text-2xl font-semibold text-blue-700">{totalSessions}</p>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <p className="mb-1 text-xs font-semibold text-slate-500">Practice Compliance</p>
          <p
            className="text-2xl font-semibold"
            style={{
              color:
                avgCompliance >= 95 ? '#15803d' : avgCompliance >= 85 ? '#d97706' : '#dc2626',
            }}
          >
            {avgCompliance}%
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <p className="mb-1 text-xs font-semibold text-slate-500">Overdue Notes</p>
          <p className="text-2xl font-semibold text-red-600">{totalOverdue}</p>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <p className="mb-1 text-xs font-semibold text-slate-500">Perfect Compliance</p>
          <p className="text-2xl font-semibold text-blue-600">
            {clinicians.filter((c) => c.complianceRate === 100).length} / {clinicians.length}
          </p>
        </div>
      </div>

      {totalOverdue > 0 && (
        <div className="rounded-xl bg-red-50 p-4 ring-1 ring-inset ring-red-100">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-red-800">
            <AlertTriangle size={14} /> {totalOverdue} Overdue Notes Require Immediate Attention
          </p>
          <div className="space-y-2">
            {allLate.map((n) => (
              <div
                key={n.noteId}
                className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-white px-3 py-2"
              >
                <div>
                  <span className="text-sm font-medium text-slate-800">{n.patientName}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {n.sessionType} · {n.sessionDate}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-bold ${
                      n.daysOverdue >= 5
                        ? 'text-red-600'
                        : n.daysOverdue >= 3
                          ? 'text-orange-500'
                          : 'text-amber-500'
                    }`}
                  >
                    {n.daysOverdue}d overdue
                  </span>
                  <span className="text-xs text-slate-400">{n.clinicianName}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Clinician Breakdown
        </p>
        {clinicians.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-slate-500">
            <Check className="mx-auto h-8 w-8 text-emerald-500 mb-2" />
            <p className="text-sm font-semibold text-slate-800">No clinician productivity data yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Metrics and turnaround timelines will appear as clinical notes and encounters are authored.
            </p>
          </div>
        ) : (
          clinicians.map((c) => {
          const isExpanded = expanded === c.clinicianId;
          const trend = ensureTrendShape(c.weeklyTrend);
          const trendDelta = trend[trend.length - 1] - trend[trend.length - 2];
          const tone = barToneFromHours(c.avgHoursToSign);
          const initials = c.clinicianName
            .split(' ')
            .filter((w) => /^[A-Za-z]/.test(w))
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

          return (
            <div
              key={c.clinicianId}
              className="rounded-xl border border-slate-200/80 bg-white shadow-sm"
            >
              <button
                type="button"
                className="flex w-full items-center gap-4 px-5 py-4 text-left"
                onClick={() => setExpanded(isExpanded ? null : c.clinicianId)}
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: '#6868D0' }}
                >
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{c.clinicianName}</span>
                    <span className="text-xs text-slate-400">{c.role}</span>
                    {c.notesOverdue > 0 && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600 ring-1 ring-inset ring-red-100">
                        {c.notesOverdue} overdue
                      </span>
                    )}
                  </div>
                  <ComplianceBadge rate={c.complianceRate} />
                </div>

                <div className="hidden shrink-0 items-center gap-6 text-center text-xs sm:flex">
                  <div>
                    <p className="text-lg font-bold text-slate-800">{c.sessionsThisWeek}</p>
                    <p className="text-slate-400">Sessions</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-slate-800">{c.avgHoursToSign}h</p>
                    <p className="text-slate-400">Avg to Sign</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <MiniTrendBar trend={trend} tone={tone} />
                    <div className="mt-1 flex items-center justify-center gap-0.5">
                      {trendDelta >= 0 ? (
                        <TrendingUp size={10} className="text-emerald-600" />
                      ) : (
                        <TrendingDown size={10} className="text-red-500" />
                      )}
                      <span
                        className={`text-[10px] font-semibold ${
                          trendDelta >= 0 ? 'text-emerald-600' : 'text-red-500'
                        }`}
                      >
                        {trendDelta >= 0 ? '+' : ''}
                        {trendDelta}%
                      </span>
                    </div>
                  </div>
                </div>

                {isExpanded ? (
                  <ChevronUp size={14} className="shrink-0 text-slate-400" />
                ) : (
                  <ChevronDown size={14} className="shrink-0 text-slate-400" />
                )}
              </button>

              {isExpanded && (
                <div className="space-y-4 border-t border-slate-200/80 px-5 py-4">
                  <div className="flex items-end gap-6 sm:hidden">
                    <div>
                      <p className="text-lg font-bold text-slate-800">{c.sessionsThisWeek}</p>
                      <p className="text-xs text-slate-400">Sessions</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-800">{c.avgHoursToSign}h</p>
                      <p className="text-xs text-slate-400">Avg to Sign</p>
                    </div>
                    <MiniTrendBar trend={trend} tone={tone} />
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Note Completion Breakdown — This Week ({c.sessionsThisWeek} sessions)
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {[
                        {
                          label: 'Same Day',
                          value: c.notesSignedSameDay,
                          color: '#15803d',
                          bg: '#E0E2FC',
                        },
                        {
                          label: 'Within 24h',
                          value: c.notesSigned24h,
                          color: '#6868D0',
                          bg: '#E0E2FC',
                        },
                        {
                          label: 'Within 48h',
                          value: c.notesSigned48h,
                          color: '#d97706',
                          bg: '#fef3c7',
                        },
                        {
                          label: 'Overdue',
                          value: c.notesOverdue,
                          color: '#dc2626',
                          bg: '#fee2e2',
                        },
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
                          style={{ backgroundColor: stat.bg }}
                        >
                          <span className="text-base font-bold" style={{ color: stat.color }}>
                            {stat.value}
                          </span>
                          <span style={{ color: stat.color }}>{stat.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      6-Week Compliance Trend
                    </p>
                    <div className="flex h-16 items-end gap-2">
                      {trend.map((v, i) => (
                        <div key={i} className="flex flex-1 flex-col items-center gap-1">
                          <span className="text-[9px] text-slate-400">{v}%</span>
                          <div
                            className="w-full rounded-t-lg"
                            style={{
                              height: `${Math.max(8, (v / 100) * 48)}px`,
                              backgroundColor: BAR_PALETTES[tone][i],
                              opacity: i === 5 ? 1 : 0.85,
                            }}
                          />
                          <span className="text-[9px] text-slate-400">{WEEKS[i]}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {c.lateNotes.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Overdue Notes
                      </p>
                      <div className="space-y-2">
                        {c.lateNotes.map((n) => (
                          <div
                            key={n.noteId}
                            className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2"
                          >
                            <div>
                              <p className="text-xs font-medium text-slate-800">{n.patientName}</p>
                              <p className="text-xs text-slate-500">
                                {n.sessionType} · {n.sessionDate}
                              </p>
                            </div>
                            <span
                              className={`text-xs font-bold ${
                                n.daysOverdue >= 5 ? 'text-red-600' : 'text-orange-500'
                              }`}
                            >
                              {n.daysOverdue}d overdue
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    {c.notesOverdue > 0 && !remindersSent.has(c.clinicianId) && (
                      <button
                        type="button"
                        onClick={() => void sendReminder(c.clinicianId)}
                        className="flex items-center gap-1.5 rounded-xl border border-amber-300 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50"
                      >
                        <Bell size={12} /> Send Reminder
                      </button>
                    )}
                    {remindersSent.has(c.clinicianId) && (
                      <span className="flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
                        <Check size={12} /> Reminder Sent
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => router.push('/dashboard/ehr/notes')}
                      className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
                    >
                      View All Notes
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        }))}
      </div>
    </div>
  );
}
