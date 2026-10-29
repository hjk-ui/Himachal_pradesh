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
import { Alert, Button, Card, CardHeader, EmptyState, LoadingState, Page, PageHeader, Section, StatCard, StatGrid, StatusBadge, Tabs, buttonClasses, cardClasses, cx, type Tone } from '@/components/ui';
import { FOCUS_RING } from '@/components/ui/tokens';

// ─── Types ────────────────────────────────────────────────────────────────────

type RevalStatus = 'overdue' | 'due_soon' | 'current';
type NoteStatus = 'Signed' | 'Draft' | 'Locked';
type ActionUrgency = 'overdue' | 'soon' | 'info';

export interface EhrOverviewKpi {
  id: string;
  label: string;
  value: number;
  sub: string;
  tone: 'blue' | 'green' | 'orange' | 'red';
}

export interface EhrRevalPatient {
  id: string;
  name: string;
  lastEval: string;
  daysSince: number;
  nextDue: string;
  provider: string;
  status: RevalStatus;
}

export interface EhrRecentNote {
  id: string;
  client: string;
  type: string;
  date: string;
  duration: string;
  status: NoteStatus;
}

export interface EhrPendingAction {
  id: string;
  text: string;
  urgency: ActionUrgency;
}

// ─── Seed (DB via npm run db:seed:ehr-modules) ────────────────────────────────

export const EHR_OVERVIEW_KPI_SEED: EhrOverviewKpi[] = [
  { id: 'ehr-kpi-notes', label: 'Notes Today', value: 0, sub: 'today', tone: 'blue' },
  {
    id: 'ehr-kpi-plans',
    label: 'Active Treatment Plans',
    value: 0,
    sub: 'none due for review',
    tone: 'green',
  },
  {
    id: 'ehr-kpi-assess',
    label: 'Pending Assessments',
    value: 0,
    sub: 'none overdue',
    tone: 'orange',
  },
  {
    id: 'ehr-kpi-consents',
    label: 'Consents Needing Action',
    value: 0,
    sub: 'clients missing / expiring / revoked',
    tone: 'red',
  },
];

export const EHR_REVAL_SEED: EhrRevalPatient[] = [];

export const EHR_RECENT_NOTES_SEED: EhrRecentNote[] = [];

export const EHR_PENDING_ACTIONS_SEED: EhrPendingAction[] = [];

// ─── Config ───────────────────────────────────────────────────────────────────

const KPI_TONE: Record<EhrOverviewKpi['tone'], Tone> = {
  blue: 'brand',
  green: 'success',
  orange: 'warning',
  red: 'danger',
};

const KPI_ICON: Record<string, React.ReactNode> = {
  'ehr-kpi-notes': <FileText />,
  'ehr-kpi-plans': <ClipboardList />,
  'ehr-kpi-assess': <BarChart3 />,
  'ehr-kpi-consents': <PenLine />,
};

const REVAL_STATUS: Record<RevalStatus, { label: string; tone: Tone }> = {
  overdue: { label: 'Overdue', tone: 'danger' },
  due_soon: { label: 'Due Soon', tone: 'warning' },
  current: { label: 'Current', tone: 'success' },
};

const NOTE_STATUS_TONE: Record<NoteStatus, Tone> = {
  Signed: 'success',
  Draft: 'warning',
  Locked: 'neutral',
};

const ACTION_URGENCY: Record<ActionUrgency, Tone> = {
  overdue: 'danger',
  soon: 'warning',
  info: 'info',
};

const QUICK_ACTIONS = [
  { label: 'New Note', href: '/dashboard/ehr/notes', icon: FileText },
  { label: 'New Treatment Plan', href: '/dashboard/ehr/treatment-plans', icon: ClipboardList },
  { label: 'Run Assessment', href: '/dashboard/ehr/assessments', icon: BarChart3 },
  { label: 'Check Eligibility', href: '/dashboard/ehr/eligibility', icon: ShieldCheck },
  { label: 'Send Consent', href: '/dashboard/ehr/consents', icon: PenLine },
  { label: 'New Prescription', href: '/dashboard/ehr/prescriptions', icon: Pill },
  { label: 'Query CRISP HIE', href: '/dashboard/ehr/hie', icon: FileSearch },
  { label: 'TMS & Spravato', href: '/dashboard/ehr/tms-spravato', icon: Zap },
];

const MODULE_CARDS = [
  { title: 'Progress Notes', href: '/dashboard/ehr/notes', description: 'SOAP, DAP, BIRP, Group, Intake', metricKey: 'notes' as const, metricFallback: '0 today', icon: FileText },
  { title: 'Treatment Plans', href: '/dashboard/ehr/treatment-plans', description: 'Goals, objectives & interventions', metricKey: 'plans' as const, metricFallback: '0 active', icon: ClipboardList },
  { title: 'Assessments', href: '/dashboard/ehr/assessments', description: 'PHQ-9, GAD-7, Columbia, ASRS', metricKey: 'assess' as const, metricFallback: '0 on file', icon: BarChart3 },
  { title: 'Clinical Evaluations', href: '/dashboard/ehr/evaluations', description: 'Biopsychosocial, Psychiatric, Crisis & ASAM', metricKey: 'notes' as const, metricFallback: '8 templates', icon: FileText },
  { title: 'LOCUS / CALOCUS', href: '/dashboard/ehr/locus', description: 'Level of Care utilization assessment', metricKey: 'assess' as const, metricFallback: 'Adult & Youth', icon: BarChart3 },
  { title: 'Diagnoses', href: '/dashboard/ehr/diagnoses', description: 'DSM-5 & ICD-10 code management', metricKey: 'dx' as const, metricFallback: '0 unique Dx', icon: Microscope },
  { title: 'E-Prescribing', href: '/dashboard/ehr/prescriptions', description: 'Medication orders & DrFirst', metricKey: 'rx' as const, metricFallback: '0 refill requests', icon: Link2 },
  { title: 'Consent Forms', href: '/dashboard/ehr/consents', description: 'HIPAA, telehealth, ROI & more', metricKey: 'consents' as const, metricFallback: '0 pending', icon: PenLine },
  { title: 'Eligibility', href: '/dashboard/ehr/eligibility', description: 'Insurance verification & prior auth', metricKey: 'elig' as const, metricFallback: '0 pending', icon: ShieldCheck },
  { title: 'TMS & Spravato', href: '/dashboard/ehr/tms-spravato', description: 'TMS courses, Spravato REMS & monitoring', metricKey: 'assess' as const, metricFallback: 'TRD program', icon: Zap },
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
  // Counted on the server from the Prisma tables (not the legacy module blobs); null = unavailable
  const [counts, setCounts] = useState<{
    assessments: number;
    pendingRefills: number;
    pendingEligibility: number;
    uniqueDx: number | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ehr/overview-counts')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.success) setCounts(d.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true);
    Promise.allSettled([
      fetchEhrProgressNotes(),
      fetchTreatmentPlans(),
      // Consents hub worklist: clients with a required consent missing / expiring / expired / revoked
      fetch('/api/consents/worklist?summary=1', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ]).then((results) => {
      if (cancelled) return;
      const notesRes = results[0].status === 'fulfilled' ? results[0].value : null;
      const plansRes = results[1].status === 'fulfilled' ? results[1].value : [];
      const consentsRes = results[2].status === 'fulfilled' ? (results[2].value as { counts?: { clientsNeedingAttention?: number } } | null) : null;

      const notes = notesRes?.notes ?? [];
      setLiveNotes(notes.slice(0, 8));
      setNotesToday(notesRes?.stats.today ?? 0);
      setUnsignedCount(notesRes?.stats.unsigned ?? notes.filter((n) => (n.workflowStatus || 'Draft') === 'Draft').length);

      const active = plansRes.filter((p) => p.status === 'ACTIVE' || p.status === 'NEEDS_REVIEW').length;
      const expiring = plansRes.filter((p) => p.status === 'NEEDS_REVIEW' || p.status === 'EXPIRED').length;
      setActivePlans(active);
      setExpiringPlans(expiring);
      setPendingConsents(consentsRes?.counts?.clientsNeedingAttention ?? 0);
      setFeedLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [revalOpen, setRevalOpen] = useState(true);
  const [revalTab, setRevalTab] = useState<RevalTab>('all');
  const [actionTab, setActionTab] = useState<ActionTab>('all');

  const assessCount = counts?.assessments ?? 0;
  const uniqueDx = counts?.uniqueDx ?? null;
  const pendingRefills = counts?.pendingRefills ?? null;
  useEffect(() => {
    if (counts) setPendingElig(counts.pendingEligibility);
  }, [counts]);

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
        label: 'Assessments on File',
        value: assessCount,
        sub: 'PHQ-9 / GAD-7 / other',
        tone: 'orange',
      },
      {
        id: 'ehr-kpi-consents',
        label: 'Consents Needing Action',
        value: pendingConsents,
        sub: pendingConsents ? 'clients missing / expiring / revoked' : 'all complete',
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
        text: `${expiringPlans} treatment plan${expiringPlans === 1 ? ' needs' : 's need'} review`,
        urgency: 'soon',
      });
    }
    if (pendingConsents > 0) {
      rows.push({
        id: 'act-consents',
        text: `${pendingConsents} client${pendingConsents === 1 ? '' : 's'} with consents to complete`,
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
      assess: counts ? `${assessCount} on file` : '—',
      dx: uniqueDx == null ? '—' : `${uniqueDx} unique Dx`,
      rx: pendingRefills == null ? '—' : `${pendingRefills} refill requests`,
      consents: pendingConsents ? `${pendingConsents} need action` : 'none due',
      elig: counts ? `${pendingElig} pending` : '—',
    };
  }, [notesToday, activePlans, assessCount, uniqueDx, pendingRefills, pendingConsents, pendingElig, counts]);

  if (loading) {
    return (
      <Page>
        <PageHeader title="EHR Overview" description="Electronic Health Records — Altrixs Staff Portal" />
        <StatGrid columns={4}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </StatGrid>
        <LoadingState label="Loading EHR overview…" />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="EHR Overview"
        description="Electronic Health Records — Altrixs Staff Portal"
        actions={
          <Link href="/dashboard/ehr/notes" className={buttonClasses({ variant: 'primary' })}>
            <Plus size={16} aria-hidden />
            New Note
          </Link>
        }
      />

      {/* KPI cards */}
      <StatGrid columns={4}>
        {kpis.map((kpi) => (
          <StatCard
            key={kpi.id}
            label={kpi.label}
            value={kpi.value}
            hint={kpi.sub}
            icon={KPI_ICON[kpi.id]}
            tone={KPI_TONE[kpi.tone]}
          />
        ))}
      </StatGrid>

      {/* 90792 Tracker */}
      <Card className="overflow-hidden">
        <CardHeader
          icon={<RefreshCw />}
          title={
            <span className="flex flex-wrap items-center gap-2">
              Psychiatric Re-evaluation Tracker — CPT 90792
              <StatusBadge tone="danger" size="sm">{overdueCount} overdue</StatusBadge>
              <StatusBadge tone="warning" size="sm">{dueSoonCount} due soon</StatusBadge>
            </span>
          }
          description={<>Re-evaluation required every 9 months · {revals.length} patients tracked</>}
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRevalOpen((v) => !v)}
              aria-expanded={revalOpen}
            >
              {revalOpen ? 'Collapse' : 'Expand'}
              {revalOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
            </Button>
          }
        />

        {revalOpen && (
          <div className="px-4 pb-4 pt-3 sm:px-5">
            <Tabs
              className="mb-3"
              variant="pill"
              label="Re-evaluation status"
              controlsPanels={false}
              value={revalTab}
              onChange={setRevalTab}
              items={[
                { key: 'all', label: 'All', count: revals.length },
                { key: 'overdue', label: 'Overdue', count: overdueCount, countTone: 'attention' },
                { key: 'due_soon', label: 'Due Soon', count: dueSoonCount },
                { key: 'current', label: 'Current', count: currentCount },
              ]}
            />

            <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th scope="col" className="px-4 py-3">Patient</th>
                    <th scope="col" className="px-4 py-3">Last 90792</th>
                    <th scope="col" className="px-4 py-3 text-right">Days Since</th>
                    <th scope="col" className="px-4 py-3">Next Due</th>
                    <th scope="col" className="px-4 py-3">Provider</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredRevals.map((row) => {
                    const st = REVAL_STATUS[row.status];
                    return (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                              {initials(row.name)}
                            </span>
                            <span className="font-semibold text-slate-900">{row.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">{row.lastEval}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{row.daysSince}d</td>
                        <td className="px-4 py-3">{row.nextDue}</td>
                        <td className="px-4 py-3">{row.provider}</td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={st.tone} dot>{st.label}</StatusBadge>
                        </td>
                        <td className="px-4 py-3">
                          {row.status === 'current' ? (
                            <StatusBadge tone="success" icon={<Check />}>Current</StatusBadge>
                          ) : (
                            <Link href="/dashboard/appointments" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                              Schedule
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredRevals.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState compact title="No patients in this filter." description="Patients due for a 90792 re-evaluation appear here." />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              90792 Psychiatric Diagnostic Evaluation — required every 9 months per clinical
              protocol. Overdue = past 270 days. Due Soon = within 30 days of due date.
            </p>
          </div>
        )}
      </Card>

      {/* Quick Actions */}
      <Section title="Quick Actions">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {QUICK_ACTIONS.map((qa) => {
            const Icon = qa.icon;
            return (
              <Link
                key={qa.label}
                href={qa.href}
                className={cx(cardClasses, FOCUS_RING, 'flex flex-col items-center gap-2 px-3 py-4 text-center transition hover:border-slate-300 hover:shadow-sm')}
              >
                <span aria-hidden className="grid h-10 w-10 place-items-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200">
                  <Icon size={18} />
                </span>
                <span className="text-xs font-semibold text-slate-700">{qa.label}</span>
              </Link>
            );
          })}
        </div>
      </Section>

      {/* Recent notes + Pending actions */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Recent Progress Notes"
            actions={
              <Link href="/dashboard/ehr/notes" className={cx('rounded text-sm font-semibold text-blue-700 hover:underline', FOCUS_RING)}>
                View all
              </Link>
            }
          />
          <div className="clinic-scroll-x overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Client</th>
                  <th scope="col" className="px-4 py-3">Type</th>
                  <th scope="col" className="px-4 py-3">Date</th>
                  <th scope="col" className="px-4 py-3">Duration</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {notes.map((n) => (
                  <tr key={n.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                          {initials(n.client)}
                        </span>
                        <span className="font-semibold text-slate-900">{n.client}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone="brand" size="sm">{n.type}</StatusBadge>
                    </td>
                    <td className="px-4 py-3">{n.date}</td>
                    <td className="px-4 py-3">{n.duration}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={NOTE_STATUS_TONE[n.status] ?? 'neutral'} size="sm">{n.status}</StatusBadge>
                    </td>
                  </tr>
                ))}
                {notes.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState compact title="No recent notes yet." description="Notes you write on Progress Notes appear here." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Pending Actions" />
          <div className="px-4 pt-3">
            <Tabs
              variant="pill"
              label="Pending action urgency"
              controlsPanels={false}
              value={actionTab}
              onChange={setActionTab}
              items={[
                { key: 'all', label: 'All' },
                { key: 'overdue', label: 'Overdue' },
                { key: 'soon', label: 'Soon' },
              ]}
            />
          </div>
          <div className="space-y-2 p-4">
            {filteredActions.map((a) => (
              <Alert key={a.id} tone={ACTION_URGENCY[a.urgency]} icon={<AlertTriangle />}>
                {a.text}
              </Alert>
            ))}
            {filteredActions.length === 0 && (
              <EmptyState compact title="No pending actions." description="Unsigned notes, plan reviews, consents and eligibility checks appear here." />
            )}
          </div>
        </Card>
      </div>

      {/* Module cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="EHR modules">
        {MODULE_CARDS.map((mod) => {
          const Icon = mod.icon;
          const metric = moduleMetrics[mod.metricKey] ?? mod.metricFallback;
          return (
            <Link
              key={mod.title}
              href={mod.href}
              className={cx(cardClasses, FOCUS_RING, 'p-5 transition hover:border-slate-300 hover:shadow-sm')}
            >
              <span aria-hidden className="grid h-10 w-10 place-items-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200">
                <Icon size={18} />
              </span>
              <h3 className="mt-3 text-sm font-semibold text-slate-900">{mod.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{mod.description}</p>
              <p className="mt-3 text-sm font-semibold text-blue-700">{metric}</p>
            </Link>
          );
        })}
      </section>
    </Page>
  );
}
