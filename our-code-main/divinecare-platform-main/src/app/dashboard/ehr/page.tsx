'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileSearch,
  FileText,
  Link2,
  Microscope,
  PenLine,
  Pill,
  Plus,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useModuleList } from '@/lib/modules/useModuleList';
import { fetchEhrProgressNotes, type EhrProgressNote } from '@/features/clients';
import { fetchTreatmentPlans } from '@/features/ehr/treatmentPlansApi';
import { fetchConsents } from '@/features/consents/api';
import { fetchEligibilityChecks } from '@/features/ehr/eligibilityApi';

import {
  type EhrOverviewKpi,
  type EhrRevalPatient,
  type EhrRecentNote,
  type EhrPendingAction,
  type RevalStatus,
  type NoteStatus,
  type ActionUrgency,
  EHR_OVERVIEW_KPI_SEED,
  EHR_REVAL_SEED,
  EHR_RECENT_NOTES_SEED,
  EHR_PENDING_ACTIONS_SEED,
} from '@/features/ehr/overviewData';

// ─── Config ───────────────────────────────────────────────────────────────────

const KPI_TONE: Record<EhrOverviewKpi['tone'], { value: string; bg: string; border: string }> = {
  blue: { value: '#2563EB', bg: '#EFF6FF', border: '#DBEAFE' },
  green: { value: '#059669', bg: '#ECFDF5', border: '#D1FAE5' },
  orange: { value: '#EA580C', bg: '#FFF7ED', border: '#FFEDD5' },
  red: { value: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
};

const REVAL_STATUS: Record<
  RevalStatus,
  { label: string; color: string; bg: string; avatar: string; btn: string }
> = {
  overdue: {
    label: 'Overdue',
    color: '#DC2626',
    bg: '#FEF2F2',
    avatar: '#FEE2E2',
    btn: 'border-red-300 text-red-600 hover:bg-red-50',
  },
  due_soon: {
    label: 'Due Soon',
    color: '#EA580C',
    bg: '#FFF7ED',
    avatar: '#FFEDD5',
    btn: 'border-orange-300 text-orange-600 hover:bg-orange-50',
  },
  current: {
    label: 'Current',
    color: '#059669',
    bg: '#ECFDF5',
    avatar: '#D1FAE5',
    btn: 'border-emerald-300 text-emerald-700 hover:bg-emerald-50',
  },
};

const NOTE_TYPE_BADGE: Record<string, { bg: string; color: string }> = {
  SOAP: { bg: '#EDE9FE', color: '#6D28D9' },
  DAP: { bg: '#DBEAFE', color: '#1D4ED8' },
  BIRP: { bg: '#DCFCE7', color: '#15803D' },
  Group: { bg: '#F3E8FF', color: '#7E22CE' },
  Intake: { bg: '#E0F2FE', color: '#0369A1' },
};

const NOTE_STATUS_BADGE: Record<NoteStatus, { bg: string; color: string }> = {
  Signed: { bg: '#DBEAFE', color: '#1D4ED8' },
  Draft: { bg: '#FEF3C7', color: '#B45309' },
  Locked: { bg: '#DCFCE7', color: '#15803D' },
};

const ACTION_URGENCY: Record<ActionUrgency, { bg: string; border: string; icon: string }> = {
  overdue: { bg: '#FEF2F2', border: '#FECACA', icon: '#DC2626' },
  soon: { bg: '#FFFBEB', border: '#FDE68A', icon: '#D97706' },
  info: { bg: '#EFF6FF', border: '#BFDBFE', icon: '#2563EB' },
};

const QUICK_ACTIONS = [
  { label: 'New Note', href: '/dashboard/ehr/notes', icon: FileText, color: '#2563EB', bg: '#EFF6FF' },
  {
    label: 'New Treatment Plan',
    href: '/dashboard/ehr/treatment-plans',
    icon: ClipboardList,
    color: '#059669',
    bg: '#ECFDF5',
  },
  {
    label: 'Run Assessment',
    href: '/dashboard/ehr/assessments',
    icon: BarChart3,
    color: '#EA580C',
    bg: '#FFF7ED',
  },
  {
    label: 'Check Eligibility',
    href: '/dashboard/ehr/eligibility',
    icon: ShieldCheck,
    color: '#DC2626',
    bg: '#FEF2F2',
  },
  {
    label: 'Send Consent',
    href: '/dashboard/ehr/consents',
    icon: PenLine,
    color: '#7C3AED',
    bg: '#F5F3FF',
  },
  {
    label: 'New Prescription',
    href: '/dashboard/ehr/prescriptions',
    icon: Pill,
    color: '#0F766E',
    bg: '#F0FDFA',
  },
  {
    label: 'Query CRISP HIE',
    href: '/dashboard/ehr/hie',
    icon: FileSearch,
    color: '#00897B',
    bg: '#E0F2F1',
  },
  {
    label: 'TMS & Spravato',
    href: '/dashboard/ehr/tms-spravato',
    icon: Zap,
    color: '#5C2D91',
    bg: '#F5F3FF',
  },
];

const MODULE_CARDS = [
  {
    title: 'Progress Notes',
    href: '/dashboard/ehr/notes',
    description: 'SOAP, DAP, BIRP, Group, Intake',
    metricKey: 'notes' as const,
    metricFallback: '0 today',
    metricColor: '#2563EB',
    icon: FileText,
    iconBg: '#EFF6FF',
    iconColor: '#2563EB',
  },
  {
    title: 'Treatment Plans',
    href: '/dashboard/ehr/treatment-plans',
    description: 'Goals, objectives & interventions',
    metricKey: 'plans' as const,
    metricFallback: '0 active',
    metricColor: '#059669',
    icon: ClipboardList,
    iconBg: '#ECFDF5',
    iconColor: '#059669',
  },
  {
    title: 'Assessments',
    href: '/dashboard/ehr/assessments',
    description: 'PHQ-9, GAD-7, Columbia, ASRS',
    metricKey: 'assess' as const,
    metricFallback: '0 on file',
    metricColor: '#EA580C',
    icon: BarChart3,
    iconBg: '#FFF7ED',
    iconColor: '#EA580C',
  },
  {
    title: 'Clinical Evaluations',
    href: '/dashboard/ehr/evaluations',
    description: 'Biopsychosocial, Psychiatric, Crisis & ASAM',
    metricKey: 'notes' as const,
    metricFallback: '8 templates',
    metricColor: '#5C2D91',
    icon: FileText,
    iconBg: '#F5F3FF',
    iconColor: '#5C2D91',
  },
  {
    title: 'LOCUS / CALOCUS',
    href: '/dashboard/ehr/locus',
    description: 'Level of Care utilization assessment',
    metricKey: 'assess' as const,
    metricFallback: 'Adult & Youth',
    metricColor: '#0284C7',
    icon: BarChart3,
    iconBg: '#F0F9FF',
    iconColor: '#0284C7',
  },
  {
    title: 'Diagnoses',
    href: '/dashboard/ehr/diagnoses',
    description: 'DSM-5 & ICD-10 code management',
    metricKey: 'dx' as const,
    metricFallback: '0 unique Dx',
    metricColor: '#7C3AED',
    icon: Microscope,
    iconBg: '#F5F3FF',
    iconColor: '#7C3AED',
  },
  {
    title: 'E-Prescribing',
    href: '/dashboard/ehr/prescriptions',
    description: 'Medication orders & Dr. First',
    metricKey: 'rx' as const,
    metricFallback: '0 refill requests',
    metricColor: '#DC2626',
    icon: Link2,
    iconBg: '#FEF2F2',
    iconColor: '#DC2626',
  },
  {
    title: 'Consent Forms',
    href: '/dashboard/ehr/consents',
    description: 'HIPAA, telehealth, ROI & more',
    metricKey: 'consents' as const,
    metricFallback: '0 pending',
    metricColor: '#0F766E',
    icon: PenLine,
    iconBg: '#F0FDFA',
    iconColor: '#0F766E',
  },
  {
    title: 'Eligibility',
    href: '/dashboard/ehr/eligibility',
    description: 'Insurance verification & prior auth',
    metricKey: 'elig' as const,
    metricFallback: '0 pending',
    metricColor: '#2563EB',
    icon: ShieldCheck,
    iconBg: '#EFF6FF',
    iconColor: '#2563EB',
  },
  {
    title: 'TMS & Spravato',
    href: '/dashboard/ehr/tms-spravato',
    description: 'TMS courses, Spravato REMS & monitoring',
    metricKey: 'assess' as const,
    metricFallback: 'TRD program',
    metricColor: '#5C2D91',
    icon: Zap,
    iconBg: '#F5F3FF',
    iconColor: '#5C2D91',
  },
];

function initials(name: string) {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .map((p) => p[0])
      .join('')
      .slice(0, 1)
      .toUpperCase() || '?'
  );
}

type RevalTab = 'all' | RevalStatus;
type ActionTab = 'all' | 'overdue' | 'soon';

export default function EHROverviewPage() {
  const [liveNotes, setLiveNotes] = useState<EhrProgressNote[]>([]);
  const [notesToday, setNotesToday] = useState(0);
  const [unsignedCount, setUnsignedCount] = useState(0);
  const [activePlans, setActivePlans] = useState(0);
  const [expiringPlans, setExpiringPlans] = useState(0);
  const [pendingConsents, setPendingConsents] = useState(0);
  const [pendingElig, setPendingElig] = useState(0);
  const [feedLoading, setFeedLoading] = useState(true);

  const [revals, , { loading: loadingRevals }] = useModuleList<EhrRevalPatient>('ehr-overview-revals', []);
  const [assessBuckets] = useModuleList<{ items?: unknown[] }>('assessments', []);
  const [dxRecords] = useModuleList<{ icd10?: string }>('diagnoses', []);
  const [refillRequests] = useModuleList<{ status?: string }>('prescription-refills', []);

  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true);
    Promise.allSettled([
      fetchEhrProgressNotes(),
      fetchTreatmentPlans(),
      fetchConsents(),
      fetchEligibilityChecks(),
    ]).then((results) => {
      if (cancelled) return;
      const notesRes = results[0].status === 'fulfilled' ? results[0].value : null;
      const plansRes = results[1].status === 'fulfilled' ? results[1].value : [];
      const consentsRes = results[2].status === 'fulfilled' ? results[2].value : [];
      const eligRes = results[3].status === 'fulfilled' ? results[3].value : [];

      const notes = notesRes?.notes ?? [];
      setLiveNotes(notes.slice(0, 8));
      setNotesToday(notesRes?.stats.today ?? 0);
      setUnsignedCount(notesRes?.stats.unsigned ?? notes.filter((n) => (n.workflowStatus || 'Draft') === 'Draft').length);

      const active = plansRes.filter((p) => p.status === 'ACTIVE' || p.status === 'NEEDS_REVIEW').length;
      const expiring = plansRes.filter((p) => p.status === 'NEEDS_REVIEW' || p.status === 'EXPIRED').length;
      setActivePlans(active);
      setExpiringPlans(expiring);
      setPendingConsents(consentsRes.filter((c) => c.status === 'pending').length);
      setPendingElig(eligRes.filter((e) => e.status === 'PENDING').length);
      setFeedLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [revalOpen, setRevalOpen] = useState(true);
  const [revalTab, setRevalTab] = useState<RevalTab>('all');
  const [actionTab, setActionTab] = useState<ActionTab>('all');

  const assessCount = assessBuckets.reduce((n, b) => n + (Array.isArray(b.items) ? b.items.length : 0), 0);
  const uniqueDx = new Set(dxRecords.map((d) => d.icd10).filter(Boolean)).size;
  const pendingRefills = refillRequests.filter((r) => r.status === 'Pending').length;

  const kpis: EhrOverviewKpi[] = useMemo(
    () => [
      {
        id: 'ehr-kpi-notes',
        label: 'Notes Today',
        value: notesToday,
        sub: unsignedCount ? `${unsignedCount} unsigned` : 'from Progress Notes',
        tone: 'blue',
      },
      {
        id: 'ehr-kpi-plans',
        label: 'Active Treatment Plans',
        value: activePlans,
        sub: expiringPlans ? `${expiringPlans} due for review` : 'no reviews due',
        tone: 'green',
      },
      {
        id: 'ehr-kpi-assess',
        label: 'Assessments on file',
        value: assessCount,
        sub: 'PHQ-9 / GAD-7 / other',
        tone: 'orange',
      },
      {
        id: 'ehr-kpi-consents',
        label: 'Consents pending',
        value: pendingConsents,
        sub: pendingConsents ? 'need signature' : 'none waiting',
        tone: 'red',
      },
    ],
    [notesToday, unsignedCount, activePlans, expiringPlans, assessCount, pendingConsents]
  );

  const notes: EhrRecentNote[] = useMemo(
    () =>
      liveNotes.map((n) => ({
        id: n.id,
        client: n.clientName,
        type: n.noteType || 'Progress',
        date: new Date(n.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        duration: n.durationMinutes ? `${n.durationMinutes} min` : '—',
        status: (n.workflowStatus || 'Draft') as NoteStatus,
      })),
    [liveNotes]
  );

  const actions: EhrPendingAction[] = useMemo(() => {
    const rows: EhrPendingAction[] = [];
    if (unsignedCount > 0) {
      rows.push({
        id: 'act-unsigned',
        text: `${unsignedCount} unsigned progress note${unsignedCount === 1 ? '' : 's'} — sign on Progress Notes`,
        urgency: 'overdue',
      });
    }
    if (expiringPlans > 0) {
      rows.push({
        id: 'act-plans',
        text: `${expiringPlans} treatment plan${expiringPlans === 1 ? '' : 's'} need review`,
        urgency: 'soon',
      });
    }
    if (pendingConsents > 0) {
      rows.push({
        id: 'act-consents',
        text: `${pendingConsents} consent form${pendingConsents === 1 ? '' : 's'} pending signature`,
        urgency: 'soon',
      });
    }
    if (pendingElig > 0) {
      rows.push({
        id: 'act-elig',
        text: `${pendingElig} eligibility check${pendingElig === 1 ? '' : 's'} still pending`,
        urgency: 'info',
      });
    }
    return rows;
  }, [unsignedCount, expiringPlans, pendingConsents, pendingElig]);

  const loading = feedLoading && notes.length === 0 && kpis.every((k) => k.value === 0) && loadingRevals && revals.length === 0;

  const overdueCount = revals.filter((r) => r.status === 'overdue').length;
  const dueSoonCount = revals.filter((r) => r.status === 'due_soon').length;
  const currentCount = revals.filter((r) => r.status === 'current').length;

  const filteredRevals = useMemo(() => {
    if (revalTab === 'all') return revals;
    return revals.filter((r) => r.status === revalTab);
  }, [revals, revalTab]);

  const filteredActions = useMemo(() => {
    if (actionTab === 'all') return actions;
    if (actionTab === 'overdue') return actions.filter((a) => a.urgency === 'overdue');
    return actions.filter((a) => a.urgency === 'soon');
  }, [actions, actionTab]);

  const moduleMetrics = useMemo(() => {
    return {
      notes: `${notesToday} today`,
      plans: `${activePlans} active`,
      assess: `${assessCount} on file`,
      dx: uniqueDx ? `${uniqueDx} unique Dx` : '0 unique Dx',
      rx: `${pendingRefills} refill requests`,
      consents: pendingConsents ? `${pendingConsents} pending` : '0 pending',
      elig: pendingElig ? `${pendingElig} pending` : '0 pending',
    };
  }, [notesToday, activePlans, assessCount, uniqueDx, pendingRefills, pendingConsents, pendingElig]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-4 p-1">
        <div className="h-10 w-64 animate-pulse rounded-lg bg-slate-200" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1E1B4B] sm:text-3xl">
            EHR Overview
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Electronic Health Records — Altrixs Staff Portal
          </p>
        </div>
        <Link
          href="/dashboard/ehr/notes"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#5C2D91] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4C1D7A]"
        >
          <Plus size={16} />
          New Note
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const tone = KPI_TONE[kpi.tone];
          return (
            <article
              key={kpi.id}
              className="rounded-2xl border bg-white p-5 shadow-sm"
              style={{ borderColor: tone.border, background: `linear-gradient(180deg, ${tone.bg} 0%, #fff 70%)` }}
            >
              <p className="text-3xl font-bold tabular-nums" style={{ color: tone.value }}>
                {kpi.value}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{kpi.label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{kpi.sub}</p>
            </article>
          );
        })}
      </div>

      {/* 90792 Tracker */}
      <section className="overflow-hidden rounded-2xl border border-rose-100 bg-[#FFF5F5] shadow-sm">
        <div className="flex flex-col gap-3 border-b border-rose-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl bg-white text-rose-600 shadow-sm">
              <RefreshCw size={16} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  Psychiatric Re-evaluation Tracker — CPT 90792
                </h2>
                <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-bold text-red-700">
                  {overdueCount} overdue
                </span>
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                  {dueSoonCount} due soon
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Re-evaluation required every 9 months · {revals.length} patients tracked
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRevalOpen((v) => !v)}
            className="inline-flex items-center gap-1 self-start rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-rose-50"
          >
            {revalOpen ? 'Collapse' : 'Expand'}
            {revalOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {revalOpen && (
          <div className="bg-white px-4 pb-4 pt-3 sm:px-5">
            <div className="mb-3 flex flex-wrap gap-2">
              {(
                [
                  ['all', `All (${revals.length})`],
                  ['overdue', `Overdue (${overdueCount})`],
                  ['due_soon', `Due Soon (${dueSoonCount})`],
                  ['current', `Current (${currentCount})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRevalTab(key)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    revalTab === key
                      ? 'bg-[#5C2D91] text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Patient</th>
                    <th className="px-4 py-3">Last 90792</th>
                    <th className="px-4 py-3">Days Since</th>
                    <th className="px-4 py-3">Next Due</th>
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRevals.map((row) => {
                    const st = REVAL_STATUS[row.status];
                    return (
                      <tr key={row.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold"
                              style={{ background: st.avatar, color: st.color }}
                            >
                              {initials(row.name)}
                            </span>
                            <span className="font-semibold text-slate-900">{row.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{row.lastEval}</td>
                        <td className="px-4 py-3">
                          <span className="font-bold tabular-nums" style={{ color: st.color }}>
                            {row.daysSince}d
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{row.nextDue}</td>
                        <td className="px-4 py-3 text-slate-600">{row.provider}</td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center gap-1.5 text-xs font-bold"
                            style={{ color: st.color }}
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: st.color }}
                            />
                            {st.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {row.status === 'current' ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold ${st.btn}`}
                            >
                              <Check size={12} />
                              Current
                            </span>
                          ) : (
                            <Link
                              href="/dashboard/appointments"
                              className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-semibold ${st.btn}`}
                            >
                              Schedule
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredRevals.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                        No patients in this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-slate-400">
              90792 Psychiatric Diagnostic Evaluation — required every 9 months per clinical
              protocol. Overdue = past 270 days. Due Soon = within 30 days of due date.
            </p>
          </div>
        )}
      </section>

      {/* Quick Actions */}
      <section>
        <h2 className="mb-3 text-base font-bold text-slate-900">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {QUICK_ACTIONS.map((qa) => {
            const Icon = qa.icon;
            return (
              <Link
                key={qa.label}
                href={qa.href}
                className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <span
                  className="grid h-11 w-11 place-items-center rounded-xl"
                  style={{ background: qa.bg, color: qa.color }}
                >
                  <Icon size={18} />
                </span>
                <span className="text-xs font-semibold text-slate-700">{qa.label}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Recent notes + Pending actions */}
      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-bold text-slate-900">Recent Progress Notes</h2>
            <Link
              href="/dashboard/ehr/notes"
              className="text-sm font-semibold text-[#5C2D91] hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {notes.map((n) => {
                  const typeBadge = NOTE_TYPE_BADGE[n.type] ?? {
                    bg: '#F1F5F9',
                    color: '#475569',
                  };
                  const statusBadge = NOTE_STATUS_BADGE[n.status];
                  return (
                    <tr key={n.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#EDE9FE] text-xs font-bold text-[#5C2D91]">
                            {initials(n.client)}
                          </span>
                          <span className="font-semibold text-slate-900">{n.client}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                          style={{ background: typeBadge.bg, color: typeBadge.color }}
                        >
                          {n.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{n.date}</td>
                      <td className="px-4 py-3 text-slate-600">{n.duration}</td>
                      <td className="px-4 py-3">
                        <span
                          className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                          style={{ background: statusBadge.bg, color: statusBadge.color }}
                        >
                          {n.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {notes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                      No recent notes yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-bold text-slate-900">Pending Actions</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  ['all', 'All'],
                  ['overdue', 'Overdue'],
                  ['soon', 'Soon'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActionTab(key)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    actionTab === key
                      ? 'bg-[#5C2D91] text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2 p-4">
            {filteredActions.map((a) => {
              const u = ACTION_URGENCY[a.urgency];
              return (
                <div
                  key={a.id}
                  className="flex items-start gap-2.5 rounded-xl border px-3 py-2.5"
                  style={{ background: u.bg, borderColor: u.border }}
                >
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: u.icon }} />
                  <p className="text-sm font-medium text-slate-800">{a.text}</p>
                </div>
              );
            })}
            {filteredActions.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">No pending actions.</p>
            )}
          </div>
        </section>
      </div>

      {/* Module cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {MODULE_CARDS.map((mod) => {
          const Icon = mod.icon;
          const metric = moduleMetrics[mod.metricKey] ?? mod.metricFallback;
          return (
            <Link
              key={mod.title}
              href={mod.href}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div
                className="grid h-11 w-11 place-items-center rounded-xl"
                style={{ background: mod.iconBg, color: mod.iconColor }}
              >
                <Icon size={18} />
              </div>
              <h3 className="mt-3 text-base font-bold text-slate-900">{mod.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{mod.description}</p>
              <p className="mt-3 text-sm font-bold" style={{ color: mod.metricColor }}>
                {metric}
              </p>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
