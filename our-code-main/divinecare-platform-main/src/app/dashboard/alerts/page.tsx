'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart2,
  Bell,
  BellOff,
  CalendarDays,
  CalendarX,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserCheck,
  X,
} from 'lucide-react';
import {
  fetchRiskAlerts,
  reviewRiskAlert,
  type RiskAlert,
  type RiskAlertSummary,
  type Severity,
} from '@/features/alerts';
import { useAuth } from '@/features/auth';

const GRADIENT = 'linear-gradient(135deg, #5C2D91, #7B4DB5)';
const PURPLE = '#5C2D91';

const SEV_PILL: Record<Severity, string> = {
  high: 'bg-red-50 text-red-700 ring-red-100',
  medium: 'bg-amber-50 text-amber-700 ring-amber-100',
  low: 'bg-blue-50 text-blue-700 ring-blue-100',
};

const BORDER: Record<Severity, string> = {
  high: '#DC2626',
  medium: '#D97706',
  low: '#2563EB',
};

function initials(name: string) {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

function MoodBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, (value / 10) * 100));
  const color = value <= 3 ? 'bg-red-500' : value <= 6 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
      <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
        <span className={`inline-block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-medium text-gray-800">{value}/10</span>
    </span>
  );
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// -----------------------------------------------------------------------------
// TAB 2: SESSION FREQUENCY TYPES & INITIAL DATA
// -----------------------------------------------------------------------------
export type FrequencyStatus = 'urgent' | 'overdue' | 'approaching' | 'ok';

export interface FrequencyAlertItem {
  id: string;
  clientId: string;
  clientName: string;
  clinicianName: string;
  diagnosis: string;
  risk: 'high' | 'medium' | 'low';
  totalSessions: number;
  cadence: '2x / week' | 'Weekly' | 'Bi-weekly' | 'Monthly';
  recommendedSpM: number;
  lastSessionDate: string; // YYYY-MM-DD
  nextAppointmentDate?: string;
  isSnoozed?: boolean;
  snoozeReason?: string;
  snoozeUntil?: string;
  acknowledgedNote?: string;
  acknowledgedAt?: string;
}

const INITIAL_FREQUENCY_ALERTS: FrequencyAlertItem[] = [
  {
    id: 'freq-1',
    clientId: 'client-8',
    clientName: 'James Wilson',
    clinicianName: 'Marcus Reed, LCSW-C',
    diagnosis: 'Chronic PTSD; Panic Disorder; SUD',
    risk: 'high',
    totalSessions: 6,
    cadence: '2x / week',
    recommendedSpM: 8,
    lastSessionDate: new Date(Date.now() - 11 * 86400000).toISOString().split('T')[0],
  },
  {
    id: 'freq-2',
    clientId: 'client-4',
    clientName: 'Diana Prince',
    clinicianName: 'Dr. Julian Martinez',
    diagnosis: 'Bipolar I Disorder; Severe Mania History',
    risk: 'high',
    totalSessions: 14,
    cadence: '2x / week',
    recommendedSpM: 8,
    lastSessionDate: new Date(Date.now() - 9 * 86400000).toISOString().split('T')[0],
  },
  {
    id: 'freq-3',
    clientId: 'client-3',
    clientName: 'Robert Johnson',
    clinicianName: 'Sarah Lin, LPC',
    diagnosis: 'Major Depressive Disorder (Severe)',
    risk: 'medium',
    totalSessions: 9,
    cadence: 'Weekly',
    recommendedSpM: 4,
    lastSessionDate: new Date(Date.now() - 13 * 86400000).toISOString().split('T')[0],
  },
  {
    id: 'freq-4',
    clientId: 'client-7',
    clientName: 'Michael Chang',
    clinicianName: 'David Kim, LGPC',
    diagnosis: 'Alcohol Use Disorder (Moderate)',
    risk: 'medium',
    totalSessions: 18,
    cadence: 'Bi-weekly',
    recommendedSpM: 2,
    lastSessionDate: new Date(Date.now() - 19 * 86400000).toISOString().split('T')[0],
  },
  {
    id: 'freq-5',
    clientId: 'client-2',
    clientName: 'Bob Smith',
    clinicianName: 'David Kim, LGPC',
    diagnosis: 'Generalized Anxiety Disorder',
    risk: 'medium',
    totalSessions: 2, // New client modifier
    cadence: 'Weekly',
    recommendedSpM: 4,
    lastSessionDate: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
  },
  {
    id: 'freq-6',
    clientId: 'client-1',
    clientName: 'Alice Brown',
    clinicianName: 'Marcus Reed, LCSW-C',
    diagnosis: 'Adjustment Disorder with Anxiety',
    risk: 'low',
    totalSessions: 12,
    cadence: 'Weekly',
    recommendedSpM: 4,
    lastSessionDate: new Date(Date.now() - 4 * 86400000).toISOString().split('T')[0],
    nextAppointmentDate: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
  },
  {
    id: 'freq-7',
    clientId: 'client-6',
    clientName: 'Fiona Gallagher',
    clinicianName: 'Dr. Julian Martinez',
    diagnosis: 'Social Anxiety; Adult ADHD',
    risk: 'low',
    totalSessions: 20,
    cadence: 'Bi-weekly',
    recommendedSpM: 2,
    lastSessionDate: new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0],
  },
  {
    id: 'freq-8',
    clientId: 'client-5',
    clientName: 'Evan Wright',
    clinicianName: 'Jasmin Garland, LCSW-C',
    diagnosis: 'Major Depression in Partial Remission',
    risk: 'low',
    totalSessions: 24,
    cadence: 'Monthly',
    recommendedSpM: 1,
    lastSessionDate: new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0],
    isSnoozed: true,
    snoozeReason: 'Client traveling for work; resumes next month',
    snoozeUntil: new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0],
  },
];

// -----------------------------------------------------------------------------
// TAB 3: MBC ESCALATIONS DATA
// -----------------------------------------------------------------------------
export interface MbcEscalationItem {
  id: string;
  clientId: string;
  clientName: string;
  clinicianName: string;
  instrument: string; // 'PHQ-9' | 'C-SSRS' | 'GAD-7' | 'AUDIT-C'
  previousScore: number;
  currentScore: number;
  severityShift: string;
  previousCadence: string;
  recommendedCadence: string;
  apaRationale: string;
  triggeredAt: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
}

const INITIAL_MBC_ESCALATIONS: MbcEscalationItem[] = [
  {
    id: 'mbc-1',
    clientId: 'client-8',
    clientName: 'James Wilson',
    clinicianName: 'Marcus Reed, LCSW-C',
    instrument: 'PHQ-9',
    previousScore: 14,
    currentScore: 22,
    severityShift: 'Moderate (14) ➔ Severe (22)',
    previousCadence: 'Weekly',
    recommendedCadence: '2x / week',
    apaRationale: 'APA 2023: Severe MDD spike (PHQ-9 ≥ 20) with suicidal ideation flags warrants immediate twice-weekly crisis stabilization and comprehensive safety planning.',
    triggeredAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    acknowledged: false,
  },
  {
    id: 'mbc-2',
    clientId: 'client-8',
    clientName: 'James Wilson',
    clinicianName: 'Marcus Reed, LCSW-C',
    instrument: 'C-SSRS',
    previousScore: 1,
    currentScore: 4,
    severityShift: 'Passive Thoughts (1) ➔ Active Ideation with Intent (4)',
    previousCadence: 'Weekly',
    recommendedCadence: '2x / week',
    apaRationale: 'Columbia Suicide Severity: Level 4 positive screen mandates emergency crisis check, 1-hour clinician contact protocol, and daily/bi-weekly check-in cadence.',
    triggeredAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    acknowledged: false,
  },
  {
    id: 'mbc-3',
    clientId: 'client-3',
    clientName: 'Robert Johnson',
    clinicianName: 'Sarah Lin, LPC',
    instrument: 'GAD-7',
    previousScore: 10,
    currentScore: 17,
    severityShift: 'Moderate (10) ➔ Severe Anxiety (17)',
    previousCadence: 'Bi-weekly',
    recommendedCadence: 'Weekly',
    apaRationale: 'NICE NG113: GAD symptom worsening non-responsive to bi-weekly psychotherapy indicates step-up to weekly CBT with exposure hierarchy.',
    triggeredAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    acknowledged: false,
  },
  {
    id: 'mbc-4',
    clientId: 'client-7',
    clientName: 'Michael Chang',
    clinicianName: 'David Kim, LGPC',
    instrument: 'AUDIT-C',
    previousScore: 4,
    currentScore: 9,
    severityShift: 'Low Risk (4) ➔ High Risk Dependence (9)',
    previousCadence: 'Weekly',
    recommendedCadence: '2x / week + PRP',
    apaRationale: 'SAMHSA TIP 35: Alcohol/substance relapse episode warrants escalation to intensive outpatient frequency (2x/week) plus peer support / PRP daily living skills.',
    triggeredAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    acknowledged: true,
    acknowledgedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
  },
];

// -----------------------------------------------------------------------------
// TAB 4: CARF 2026 TEAM COMPLIANCE DATA
// -----------------------------------------------------------------------------
export interface ClinicianComplianceRecord {
  id: string;
  name: string;
  role: string;
  caseload: number;
  totalClients: number;
  onTrackCount: number;
  approachingCount: number;
  overdueCount: number;
  urgentCount: number;
  compliancePct: number;
}

const INITIAL_TEAM_COMPLIANCE: ClinicianComplianceRecord[] = [];

export interface TeamAlertItem {
  id: string;
  senderName: string;
  senderRole: string;
  taggedClinician: string;
  clientName: string;
  clientId: string;
  urgency: 'Urgent' | 'Routine' | 'FYI';
  concernText: string;
  createdAt: string;
  status: 'Open' | 'Resolved';
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
}

const INITIAL_TEAM_ALERTS: TeamAlertItem[] = [];

type MainTab = 'risk' | 'team_alerts' | 'frequency' | 'mbc' | 'compliance';

export default function AlertsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<MainTab>('risk');

  // Tab 1: Risk Alerts State
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [summary, setSummary] = useState<RiskAlertSummary>({
    high: 0,
    medium: 0,
    low: 0,
    totalUnreviewed: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<'unreviewed' | 'all' | Severity>('unreviewed');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Section 5.6: Team Alerts (@-Tagged Clinician Alerts)
  const [teamAlerts, setTeamAlerts] = useState<TeamAlertItem[]>(INITIAL_TEAM_ALERTS);
  const [teamAlertFilter, setTeamAlertFilter] = useState<'all' | 'Urgent' | 'Routine' | 'FYI' | 'Resolved'>('all');
  const [resolvingAlert, setResolvingAlert] = useState<TeamAlertItem | null>(null);
  const [resolutionText, setResolutionText] = useState('');
  const [resolveError, setResolveError] = useState('');
  const [resolvingLoading, setResolvingLoading] = useState(false);

  // Tab 2–4: no fictional PHI — empty until real APIs exist (Postgres only)
  const [freqAlerts, setFreqAlerts] = useState<FrequencyAlertItem[]>([]);
  const [ackFreqId, setAckFreqId] = useState<string | null>(null);
  const [ackFreqNote, setAckFreqNote] = useState('');
  const [snoozeFreqId, setSnoozeFreqId] = useState<string | null>(null);
  const [snoozeReason, setSnoozeReason] = useState('Next appointment already scheduled');
  const [snoozeDays, setSnoozeDays] = useState(7);

  // Tab 3: MBC Escalations State
  const [mbcEscalations, setMbcEscalations] = useState<MbcEscalationItem[]>([]);

  // Tab 4: Team Compliance State
  const [teamCompliance] = useState<ClinicianComplianceRecord[]>([]);

  const isAdminOrDirector =
    user?.role === 'ADMIN' ||
    user?.role === 'PRACTICE_DIRECTOR' ||
    user?.role === 'DIRECTOR' ||
    user?.role === 'OFFICE_MANAGER' ||
    user?.role === 'SUPER_ADMIN' ||
    user?.baseRole === 'ADMIN';

  // Load Team Alerts from PostgreSQL backend
  const loadTeamAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts/team');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.alerts) && data.alerts.length > 0) {
          setTeamAlerts(data.alerts);
        }
      }
    } catch (err) {
      console.error('Failed to load team alerts:', err);
    }
  }, []);

  // Load Risk Alerts from backend
  const loadRisk = useCallback(async (opts?: { soft?: boolean }) => {
    if (!opts?.soft) setLoading(true);
    setError(null);
    try {
      const data = await fetchRiskAlerts();
      setAlerts(data.alerts);
      setSummary(data.summary);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRisk();
    void loadTeamAlerts();
  }, [loadRisk, loadTeamAlerts]);

  // Frequency Window & Status Engine Calculation
  const computedFreqAlerts = useMemo(() => {
    return freqAlerts.map((item) => {
      let windowDays = 7;
      if (item.cadence === '2x / week') windowDays = 3.5;
      else if (item.cadence === 'Weekly') windowDays = 7;
      else if (item.cadence === 'Bi-weekly') windowDays = 14;
      else if (item.cadence === 'Monthly') windowDays = 30;

      // Capping rules: high risk capped at 3.5 days, new client (<4 sessions) capped at 7 days
      if (item.risk === 'high') windowDays = Math.min(windowDays, 3.5);
      if (item.totalSessions < 4) windowDays = Math.min(windowDays, 7);

      const lastDate = new Date(item.lastSessionDate);
      const now = new Date();
      const diffMs = now.getTime() - lastDate.getTime();
      const daysSince = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      const daysOverdue = Math.max(0, daysSince - Math.ceil(windowDays));
      const ratio = daysSince / windowDays;

      let status: FrequencyStatus = 'ok';
      if ((item.risk === 'high' && daysSince > windowDays) || ratio >= 2.0) {
        status = 'urgent';
      } else if (ratio >= 1.1) {
        status = 'overdue';
      } else if (ratio >= 0.85) {
        status = 'approaching';
      }

      return {
        ...item,
        windowDays,
        daysSince,
        daysOverdue,
        status,
      };
    });
  }, [freqAlerts]);

  // Active (non-snoozed) frequency alerts
  const activeFreqAlerts = useMemo(
    () => computedFreqAlerts.filter((item) => !item.isSnoozed),
    [computedFreqAlerts]
  );

  const snoozedFreqAlerts = useMemo(
    () => computedFreqAlerts.filter((item) => item.isSnoozed),
    [computedFreqAlerts]
  );

  // Grouped frequency sections
  const urgentFreq = useMemo(
    () => activeFreqAlerts.filter((f) => f.status === 'urgent'),
    [activeFreqAlerts]
  );
  const overdueFreq = useMemo(
    () => activeFreqAlerts.filter((f) => f.status === 'overdue'),
    [activeFreqAlerts]
  );
  const approachingFreq = useMemo(
    () => activeFreqAlerts.filter((f) => f.status === 'approaching'),
    [activeFreqAlerts]
  );
  const onTrackFreq = useMemo(
    () => activeFreqAlerts.filter((f) => f.status === 'ok'),
    [activeFreqAlerts]
  );

  // Top 4 Stat Counts
  const statUnreviewedRisk = summary.totalUnreviewed;
  const statUrgentFreq = urgentFreq.length;
  const statOverdueFreq = overdueFreq.length;
  const statUnackMbc = useMemo(
    () => mbcEscalations.filter((m) => !m.acknowledged).length,
    [mbcEscalations]
  );

  // Filtered Risk Alerts for Tab 1
  const filteredRiskAlerts = useMemo(() => {
    if (riskFilter === 'all') return alerts;
    if (riskFilter === 'unreviewed') return alerts.filter((a) => !a.reviewed);
    return alerts.filter((a) => a.severity === riskFilter && !a.reviewed);
  }, [alerts, riskFilter]);

  // Actions for Tab 1: Review Risk Alert
  const handleReviewRisk = async (alert: RiskAlert) => {
    setSaving(true);
    setError(null);
    try {
      const documentedNote = reviewNote.trim() || '(Reviewed without documentation)';
      const updated = await reviewRiskAlert(alert.id, documentedNote);
      setAlerts((prev) => prev.map((a) => (a.id === alert.id ? updated : a)));
      setSummary((prev) => ({
        total: prev.total,
        totalUnreviewed: Math.max(0, prev.totalUnreviewed - (alert.reviewed ? 0 : 1)),
        high: Math.max(0, prev.high - (!alert.reviewed && alert.severity === 'high' ? 1 : 0)),
        medium: Math.max(0, prev.medium - (!alert.reviewed && alert.severity === 'medium' ? 1 : 0)),
        low: Math.max(0, prev.low - (!alert.reviewed && alert.severity === 'low' ? 1 : 0)),
      }));
      setReviewingId(null);
      setReviewNote('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not review alert');
    } finally {
      setSaving(false);
    }
  };

  // Actions for Tab 2: Acknowledge Frequency
  const handleAcknowledgeFreq = (id: string) => {
    setFreqAlerts((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              acknowledgedNote: ackFreqNote.trim() || 'Cadence reviewed with client',
              acknowledgedAt: new Date().toISOString(),
            }
          : item
      )
    );
    setAckFreqId(null);
    setAckFreqNote('');
  };

  // Actions for Tab 2: Snooze Frequency
  const handleSnoozeFreq = (id: string) => {
    const until = new Date(Date.now() + snoozeDays * 86400000).toISOString().split('T')[0];
    setFreqAlerts((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              isSnoozed: true,
              snoozeReason,
              snoozeUntil: until,
            }
          : item
      )
    );
    setSnoozeFreqId(null);
  };

  // Actions for Tab 2: Unsnooze
  const handleUnsnoozeFreq = (id: string) => {
    setFreqAlerts((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              isSnoozed: false,
              snoozeReason: undefined,
              snoozeUntil: undefined,
            }
          : item
      )
    );
  };

  // Actions for Tab 3: Acknowledge MBC Escalation
  const handleAcknowledgeMbc = (id: string) => {
    setMbcEscalations((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              acknowledged: true,
              acknowledgedAt: new Date().toISOString(),
            }
          : item
      )
    );
  };

  const getFreqBorder = (status: FrequencyStatus) => {
    if (status === 'urgent') return '#DC2626';
    if (status === 'overdue') return '#EA580C';
    if (status === 'approaching') return '#D97706';
    return '#16A34A';
  };

  const getFreqBadge = (status: FrequencyStatus) => {
    if (status === 'urgent') return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200';
    if (status === 'overdue') return 'bg-orange-50 text-orange-700 ring-1 ring-orange-200';
    if (status === 'approaching') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
    return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">
            Clinical Alert Hub & CARF Compliance
          </h1>
          <p className="mt-0.5 text-sm font-medium text-slate-500">
            Monitor client risk, session frequency cadence, and measurement-based care escalations
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadRisk()}
          className="inline-flex items-center gap-1.5 self-start rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 transition"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin text-[#5C2D91]' : ''} />
          Refresh Data
        </button>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadRisk()}
            className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-red-700 border border-red-200"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Session Frequency, MBC Escalations and Team Compliance are demonstration previews with fictional records.
        Preview acknowledgements and snoozes reset on reload and are not saved to patient charts.
        Risk Alerts use saved clinic data.
      </div>

      {/* 4 Top Summary Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Unreviewed Risk</p>
          <p className="mt-1 text-3xl font-extrabold text-red-600 tabular-nums">
            {statUnreviewedRisk}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500">Client check-in flags</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Urgent / Freq</p>
          <p className="mt-1 text-3xl font-extrabold text-red-600 tabular-nums">
            {statUrgentFreq}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500">Past 2× cadence window</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Overdue</p>
          <p className="mt-1 text-3xl font-extrabold text-orange-600 tabular-nums">
            {statOverdueFreq}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500">Past recommended cadence</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">MBC Escalations</p>
          <p className="mt-1 text-3xl font-extrabold text-[#7C3AED] tabular-nums">
            {statUnackMbc}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500">Psychometric score spikes</p>
        </div>
      </div>

      {/* 4 Tabs Navigation */}
      <div className="flex overflow-x-auto border-b border-slate-200 bg-white px-2 rounded-2xl shadow-xs">
        <button
          type="button"
          onClick={() => setActiveTab('risk')}
          className={`inline-flex items-center gap-2 border-b-2 px-4 py-3.5 text-xs font-bold transition sm:text-sm whitespace-nowrap ${
            activeTab === 'risk'
              ? 'border-[#5C2D91] text-[#5C2D91]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ShieldAlert size={16} />
          <span>Risk Alerts</span>
          {statUnreviewedRisk > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-extrabold text-red-700">
              {statUnreviewedRisk}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('team_alerts')}
          className={`inline-flex items-center gap-2 border-b-2 px-4 py-3.5 text-xs font-bold transition sm:text-sm whitespace-nowrap ${
            activeTab === 'team_alerts'
              ? 'border-[#5C2D91] text-[#5C2D91]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <MessageSquare size={16} />
          <span>Team Alerts (@-Tagged)</span>
          {teamAlerts.filter((t) => t.status === 'Open').length > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-extrabold text-blue-700">
              {teamAlerts.filter((t) => t.status === 'Open').length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('frequency')}
          className={`inline-flex items-center gap-2 border-b-2 px-4 py-3.5 text-xs font-bold transition sm:text-sm whitespace-nowrap ${
            activeTab === 'frequency'
              ? 'border-[#5C2D91] text-[#5C2D91]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <CalendarX size={16} />
          <span>Session Frequency</span>
          {statUrgentFreq + statOverdueFreq > 0 && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-extrabold text-orange-800">
              {statUrgentFreq + statOverdueFreq}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('mbc')}
          className={`inline-flex items-center gap-2 border-b-2 px-4 py-3.5 text-xs font-bold transition sm:text-sm whitespace-nowrap ${
            activeTab === 'mbc'
              ? 'border-[#5C2D91] text-[#5C2D91]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <TrendingUp size={16} />
          <span>MBC Escalations</span>
          {statUnackMbc > 0 && (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-extrabold text-[#5C2D91]">
              {statUnackMbc}
            </span>
          )}
        </button>

        {isAdminOrDirector && (
          <button
            type="button"
            onClick={() => setActiveTab('compliance')}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-3.5 text-xs font-bold transition sm:text-sm whitespace-nowrap ${
              activeTab === 'compliance'
                ? 'border-[#5C2D91] text-[#5C2D91]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <BarChart2 size={16} />
            <span>Team Compliance (CARF)</span>
          </button>
        )}
      </div>

      {/* TAB 1: RISK ALERTS */}
      {activeTab === 'risk' && (
        <div className="space-y-4">
          {/* Risk Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { key: 'unreviewed', label: `Unreviewed (${summary.totalUnreviewed})` },
              { key: 'all', label: `All Alerts (${alerts.length})` },
              { key: 'high', label: `High (${summary.high})` },
              { key: 'medium', label: `Medium (${summary.medium})` },
              { key: 'low', label: `Low (${summary.low})` },
            ].map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setRiskFilter(f.key as any)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                  riskFilter === f.key
                    ? 'bg-[#5C2D91] text-white shadow-xs'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredRiskAlerts.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <CheckCircle2 size={36} className="mx-auto text-emerald-500" />
              <p className="mt-3 text-base font-bold text-slate-900">All risk alerts cleared</p>
              <p className="mt-1 text-xs text-slate-500">
                No active wellness concerns matching your filter.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRiskAlerts.map((a) => {
                const isReviewing = reviewingId === a.id;
                return (
                  <div
                    key={a.id}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition hover:shadow-sm"
                    style={{ borderLeftWidth: '5px', borderLeftColor: BORDER[a.severity] }}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-100 font-bold text-[#5C2D91]">
                          {initials(a.clientName)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/dashboard/clients/${a.clientId}`}
                              className="font-bold text-slate-900 hover:text-[#5C2D91] hover:underline"
                            >
                              {a.clientName}
                            </Link>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${SEV_PILL[a.severity]}`}
                            >
                              {a.severity}
                            </span>
                            {a.reviewed && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                Reviewed
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs font-semibold text-slate-800">
                            {a.description}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                            <span>Mood: <MoodBar value={a.mood} /></span>
                            <span>Stress: <span className="font-bold text-slate-700">{a.stress}/10</span></span>
                            <span>{formatWhen(a.createdAt)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-start">
                        <Link
                          href={`/dashboard/messages?client=${a.clientId}`}
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          <MessageSquare size={13} />
                          Message
                        </Link>
                        {!a.reviewed && (
                          <button
                            type="button"
                            onClick={() => setReviewingId(isReviewing ? null : a.id)}
                            className="inline-flex items-center gap-1 rounded-xl bg-[#5C2D91] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#4A2475]"
                          >
                            {isReviewing ? 'Close' : 'Review'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline Review Panel */}
                    {isReviewing && (
                      <div className="mt-4 rounded-xl border border-purple-100 bg-purple-50/50 p-3.5">
                        <label className="mb-1.5 block text-xs font-bold text-slate-800">
                          Document Clinical Assessment / Disposition *
                        </label>
                        <textarea
                          rows={2}
                          value={reviewNote}
                          onChange={(e) => setReviewNote(e.target.value)}
                          placeholder="e.g. Telehealth safety check conducted with client; safety contract verified, no active intent."
                          className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
                        />
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setReviewingId(null);
                              setReviewNote('');
                            }}
                            className="rounded-lg px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => handleReviewRisk(a)}
                            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {saving ? 'Saving...' : 'Mark Reviewed'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom Crisis Response Protocol Box */}
          <div className="rounded-2xl border border-red-200 bg-red-50/80 p-4 sm:p-5 shadow-xs">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
                <AlertTriangle size={20} />
              </span>
              <div className="space-y-1 text-xs text-red-950">
                <p className="font-bold sm:text-sm">Crisis Response Protocol (CARF & State Standards)</p>
                <p className="leading-relaxed text-red-800">
                  Clients screening positive on C-SSRS Level 4+ or expressing immediate active suicidal ideation require clinical outreach within <strong>1 hour</strong>. Verify current physical location, execute Stanley-Brown safety plan, and engage 988 Crisis Response or emergency services if uncontactable.
                </p>
                <p className="font-semibold text-red-900 pt-1">
                  National Suicide & Crisis Lifeline: <strong>Call/Text 988</strong> · Maryland 211 Crisis Warmline
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 5.6: TEAM ALERTS (@-TAGGED CLINICIAN ALERTS) */}
      {activeTab === 'team_alerts' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
            <p className="text-sm font-bold text-blue-900">
              Inter-Provider Clinical Tagging & Team Communications
            </p>
            <p className="mt-0.5 text-xs text-blue-700">
              Direct @-mentions created by colleagues during encounter documentation, somatic reviews, or peer consultations.
            </p>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['all', `All (${teamAlerts.length})`],
                  ['Urgent', `Urgent (${teamAlerts.filter((t) => t.urgency === 'Urgent').length})`],
                  ['Routine', `Routine (${teamAlerts.filter((t) => t.urgency === 'Routine').length})`],
                  ['FYI', `FYI (${teamAlerts.filter((t) => t.urgency === 'FYI').length})`],
                  ['Resolved', `Resolved (${teamAlerts.filter((t) => t.status === 'Resolved').length})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTeamAlertFilter(key)}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                    teamAlertFilter === key
                      ? 'bg-[#5C2D91] text-white shadow-xs'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <span className="text-xs text-slate-500">
              {teamAlerts.filter((t) => t.status === 'Open').length} pending clinician action
            </span>
          </div>

          {/* Alerts List */}
          <div className="space-y-3">
            {teamAlerts
              .filter((item) => {
                if (teamAlertFilter === 'all') return true;
                if (teamAlertFilter === 'Resolved') return item.status === 'Resolved';
                return item.urgency === teamAlertFilter && item.status !== 'Resolved';
              })
              .map((alert) => {
                const isUrgent = alert.urgency === 'Urgent';
                const isRoutine = alert.urgency === 'Routine';
                const borderColor = isUrgent ? '#DC2626' : isRoutine ? '#2563EB' : '#64748B';
                const urgencyPill = isUrgent
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : isRoutine
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-slate-100 text-slate-700 border-slate-200';

                return (
                  <div
                    key={alert.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs transition hover:shadow-sm"
                    style={{ borderLeftWidth: '5px', borderLeftColor: borderColor }}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${urgencyPill}`}
                          >
                            {alert.urgency}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              alert.status === 'Open'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {alert.status}
                          </span>
                          <Link
                            href={`/dashboard/clients/${alert.clientId}`}
                            className="font-bold text-slate-900 hover:text-[#5C2D91] hover:underline text-sm"
                          >
                            {alert.clientName}
                          </Link>
                          <span className="text-xs text-slate-400">· {formatWhen(alert.createdAt)}</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span>
                            From: <strong className="text-slate-800">{alert.senderName}</strong>{' '}
                            <span className="text-slate-400">({alert.senderRole})</span>
                          </span>
                          <span>➔</span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-0.5 font-bold text-[#5C2D91]">
                            To: {alert.taggedClinician}
                          </span>
                        </div>

                        <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3 text-xs leading-relaxed text-slate-800">
                          {alert.concernText}
                        </div>

                        {alert.status === 'Resolved' && alert.resolutionNote && (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900 space-y-1">
                            <p className="font-bold flex items-center gap-1.5 text-emerald-800">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              Resolved by {alert.resolvedBy} ({formatWhen(alert.resolvedAt || '')})
                            </p>
                            <p className="text-emerald-950 font-medium pl-5.5">
                              &ldquo;{alert.resolutionNote}&rdquo;
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-start">
                        <Link
                          href={`/dashboard/clients/${alert.clientId}`}
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          View Chart
                        </Link>
                        {alert.status === 'Open' && (
                          <button
                            type="button"
                            onClick={() => {
                              setResolvingAlert(alert);
                              setResolutionText('');
                              setResolveError('');
                            }}
                            className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition"
                          >
                            <Check className="h-3.5 w-3.5" /> Resolve Alert
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* TAB 2: SESSION FREQUENCY COMPLIANCE */}
      {activeTab === 'frequency' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-purple-100 bg-purple-50/50 p-4">
            <p className="text-sm font-bold text-[#5C2D91]">
              APA 2023 & SAMHSA Clinical Cadence Delivery Engine
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              Monitors actual vs. recommended outpatient cadence. High-risk clients past window trigger urgent CARF compliance escalation.
            </p>
          </div>

          {/* Group 1: Urgent Alerts */}
          {urgentFreq.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-600 animate-pulse" />
                <h3 className="text-sm font-bold text-red-900">
                  Urgent — Past 2× Window or High Risk ({urgentFreq.length})
                </h3>
              </div>
              <div className="space-y-3">
                {urgentFreq.map((item) => renderFrequencyCard(item))}
              </div>
            </div>
          )}

          {/* Group 2: Overdue */}
          {overdueFreq.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
                <h3 className="text-sm font-bold text-orange-900">
                  Overdue Cadence ({overdueFreq.length})
                </h3>
              </div>
              <div className="space-y-3">
                {overdueFreq.map((item) => renderFrequencyCard(item))}
              </div>
            </div>
          )}

          {/* Group 3: Approaching Window */}
          {approachingFreq.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <h3 className="text-sm font-bold text-amber-900">
                  Approaching Recommended Window ({approachingFreq.length})
                </h3>
              </div>
              <div className="space-y-3">
                {approachingFreq.map((item) => renderFrequencyCard(item))}
              </div>
            </div>
          )}

          {/* Group 4: On Track */}
          {onTrackFreq.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <h3 className="text-sm font-bold text-emerald-900">
                  On Track ({onTrackFreq.length})
                </h3>
              </div>
              <div className="space-y-3">
                {onTrackFreq.map((item) => renderFrequencyCard(item))}
              </div>
            </div>
          )}

          {/* Snoozed Items Summary */}
          {snoozedFreqAlerts.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BellOff size={16} className="text-slate-500" />
                  <h4 className="text-xs font-bold text-slate-800">
                    Clinically Snoozed Audits ({snoozedFreqAlerts.length})
                  </h4>
                </div>
              </div>

              <div className="space-y-2">
                {snoozedFreqAlerts.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-xl bg-white p-3 text-xs border border-slate-200"
                  >
                    <div>
                      <span className="font-bold text-slate-900">{item.clientName}</span> ·{' '}
                      <span className="text-slate-500">{item.snoozeReason}</span> (until {item.snoozeUntil})
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnsnoozeFreq(item.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-bold text-slate-700 hover:bg-slate-100"
                    >
                      <RotateCcw size={12} />
                      Unsnooze
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MBC (MEASUREMENT-BASED CARE) ESCALATIONS */}
      {activeTab === 'mbc' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-purple-100 bg-purple-50/50 p-4">
            <p className="text-sm font-bold text-[#5C2D91]">
              Measurement-Based Care (MBC) Automated Frequency Triggers
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              When standardized outcome rating scales (PHQ-9, C-SSRS, GAD-7, AUDIT-C) show clinically significant deterioration, the engine recommends step-up in session frequency.
            </p>
          </div>

          <div className="space-y-3">
            {mbcEscalations.map((mbc) => (
              <div
                key={mbc.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition hover:shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/dashboard/clients/${mbc.clientId}`}
                        className="text-sm font-bold text-slate-900 hover:text-[#5C2D91] hover:underline"
                      >
                        {mbc.clientName}
                      </Link>
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-[#5C2D91]">
                        {mbc.instrument} Trigger
                      </span>
                      <span className="text-xs font-semibold text-slate-400">
                        Clinician: {mbc.clinicianName}
                      </span>
                      {mbc.acknowledged && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                          Acknowledged
                        </span>
                      )}
                    </div>

                    <p className="text-xs font-bold text-rose-700">
                      Score Spike: {mbc.severityShift}
                    </p>

                    {/* Cadence Transition pill */}
                    <div className="flex items-center gap-2 pt-1 text-xs">
                      <span className="font-medium text-slate-500">Planned Cadence:</span>
                      <span className="line-through text-slate-400">{mbc.previousCadence}</span>
                      <span className="text-slate-400">&rarr;</span>
                      <span className="rounded-md bg-purple-50 px-2 py-0.5 font-bold text-[#5C2D91] border border-purple-200">
                        Recommended: {mbc.recommendedCadence}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      {mbc.apaRationale}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-start">
                    <Link
                      href="/dashboard/appointments"
                      className="rounded-xl border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-bold text-[#5C2D91] hover:bg-purple-100"
                    >
                      Schedule
                    </Link>
                    {!mbc.acknowledged ? (
                      <button
                        type="button"
                        onClick={() => handleAcknowledgeMbc(mbc.id)}
                        className="rounded-xl bg-[#5C2D91] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#4A2475]"
                      >
                        Acknowledge
                      </button>
                    ) : (
                      <span className="text-[11px] font-semibold text-slate-400">
                        Logged in EHR audit
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: TEAM CARF 2026 COMPLIANCE OVERVIEW */}
      {activeTab === 'compliance' && isAdminOrDirector && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-purple-100 bg-purple-50/50 p-4">
            <p className="text-sm font-bold text-[#5C2D91]">
              CARF 2026 Outpatient Delivery & Caseload Audit Roster
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              Audit metric measuring compliance between treatment-plan prescribed cadence and actual encounter completion across all active clinicians.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 font-bold uppercase tracking-wider text-slate-400 text-[11px]">
                    <th className="px-4 py-3">Clinician & Role</th>
                    <th className="px-3 py-3 text-center">Caseload</th>
                    <th className="px-3 py-3 text-center">On Track</th>
                    <th className="px-3 py-3 text-center">Approaching</th>
                    <th className="px-3 py-3 text-center">Overdue</th>
                    <th className="px-3 py-3 text-center">Urgent</th>
                    <th className="px-4 py-3 text-right">Cadence Delivery %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teamCompliance.map((row) => {
                    const isHigh = row.compliancePct >= 80;
                    const isMid = row.compliancePct >= 60 && row.compliancePct < 80;
                    const barColor = isHigh ? 'bg-emerald-500' : isMid ? 'bg-amber-500' : 'bg-red-500';
                    const textColor = isHigh ? 'text-emerald-700' : isMid ? 'text-amber-700' : 'text-red-700';

                    return (
                      <tr key={row.id} className="hover:bg-slate-50/80 transition">
                        <td className="px-4 py-3.5">
                          <p className="font-bold text-slate-900">{row.name}</p>
                          <p className="text-[11px] text-slate-400 font-medium">{row.role}</p>
                        </td>
                        <td className="px-3 py-3.5 text-center font-bold text-slate-700">
                          {row.totalClients} / {row.caseload}
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700 border border-emerald-200">
                            {row.onTrackCount}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-700 border border-amber-200">
                            {row.approachingCount}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <span className="rounded-full bg-orange-50 px-2 py-0.5 font-bold text-orange-700 border border-orange-200">
                            {row.overdueCount}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <span className="rounded-full bg-red-50 px-2 py-0.5 font-bold text-red-700 border border-red-200">
                            {row.urgentCount}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full rounded-full ${barColor}`}
                                style={{ width: `${row.compliancePct}%` }}
                              />
                            </div>
                            <span className={`font-bold tabular-nums ${textColor}`}>
                              {row.compliancePct}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Explanatory CARF Audit Documentation Footer */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-xs text-slate-600 leading-relaxed space-y-1">
            <p className="font-bold text-slate-900">CARF Outpatient Standard 2.D.4 Audit Documentation:</p>
            <p>
              Accreditation requires evidence that outpatient psychotherapy and psychiatric medication monitoring adhere to documented treatment frequencies. Any deviation exceeding 14 calendar days without clinical rationale documentation (snooze/hold) is classified as a non-conformance finding during clinical peer review.
            </p>
          </div>
        </div>
      )}

      {/* SECTION 5.6: Resolve Team Alert Modal */}
      {resolvingAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-emerald-100 p-2 text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Resolve Clinical Alert</h3>
                  <p className="text-xs text-gray-500">Document clinical resolution note & archive alert</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setResolvingAlert(null)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
              <p>
                <strong>Patient:</strong> {resolvingAlert.clientName}
              </p>
              <p>
                <strong>From:</strong> {resolvingAlert.senderName} ({resolvingAlert.senderRole})
              </p>
              <p className="text-slate-500 mt-1 italic">&ldquo;{resolvingAlert.concernText}&rdquo;</p>
            </div>

            <div className="space-y-1 text-xs">
              <label className="block font-medium text-gray-700">
                Resolution Note & Clinical Actions Taken *
              </label>
              <textarea
                rows={3}
                value={resolutionText}
                onChange={(e) => {
                  setResolutionText(e.target.value);
                  setResolveError('');
                }}
                placeholder="e.g. Conducted psychiatric med review; adjusted Sertraline dose and messaged patient."
                className="mt-1 w-full rounded-xl border border-gray-200 p-2.5 text-xs text-gray-800 placeholder-gray-400 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
              />
              {resolveError && <p className="text-[11px] text-red-600 font-semibold">{resolveError}</p>}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setResolvingAlert(null)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resolvingLoading}
                onClick={async () => {
                  if (!resolutionText.trim()) {
                    setResolveError('Resolution note is required for clinical audit compliance');
                    return;
                  }
                  setResolvingLoading(true);
                  try {
                    const res = await fetch(`/api/alerts/team/${resolvingAlert.id}/resolve`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ resolutionNote: resolutionText.trim() }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setTeamAlerts((prev) =>
                        prev.map((item) => (item.id === resolvingAlert.id ? data.alert : item))
                      );
                      setResolvingAlert(null);
                      setResolutionText('');
                      setResolveError('');
                    } else {
                      const err = await res.json().catch(() => ({}));
                      setResolveError(err.error || 'Failed to resolve alert');
                    }
                  } catch {
                    setResolveError('Network error while resolving alert');
                  } finally {
                    setResolvingLoading(false);
                  }
                }}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
              >
                {resolvingLoading ? 'Saving...' : 'Confirm Resolution'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Helper to render a Frequency Alert Card (Tab 2)
  function renderFrequencyCard(item: FrequencyAlertItem & { windowDays: number; daysSince: number; daysOverdue: number; status: FrequencyStatus }) {
    const isAcking = ackFreqId === item.id;
    const isSnoozing = snoozeFreqId === item.id;
    const borderColor = getFreqBorder(item.status);
    const badgeClass = getFreqBadge(item.status);

    return (
      <div
        key={item.id}
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition hover:shadow-sm"
        style={{ borderLeftWidth: '5px', borderLeftColor: borderColor }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/dashboard/clients/${item.clientId}`}
                className="font-bold text-slate-900 hover:text-[#5C2D91] hover:underline"
              >
                {item.clientName}
              </Link>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>
                {item.status}
              </span>
              <span className="text-xs font-semibold text-slate-500">
                Clinician: {item.clinicianName}
              </span>
              <span className="text-xs text-slate-400">· {item.diagnosis}</span>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-1">
              <span>
                Cadence: <strong>{item.cadence}</strong> (every {item.windowDays}d)
              </span>
              <span>
                Last Session: <strong>{item.lastSessionDate}</strong> ({item.daysSince} days ago)
              </span>
              {item.daysOverdue > 0 && (
                <span className="font-bold text-rose-600">
                  {item.daysOverdue} days overdue
                </span>
              )}
            </div>

            {item.acknowledgedNote && (
              <p className="mt-1 text-xs text-emerald-700 bg-emerald-50/80 p-2 rounded-lg border border-emerald-100 font-medium">
                Acknowledged: {item.acknowledgedNote} ({formatWhen(item.acknowledgedAt || '')})
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 self-end sm:self-start">
            <Link
              href="/dashboard/appointments"
              className="inline-flex items-center gap-1 rounded-xl border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-bold text-[#5C2D91] hover:bg-purple-100"
            >
              Schedule
            </Link>

            <button
              type="button"
              onClick={() => {
                setAckFreqId(isAcking ? null : item.id);
                setSnoozeFreqId(null);
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Acknowledge
            </button>

            <button
              type="button"
              onClick={() => {
                setSnoozeFreqId(isSnoozing ? null : item.id);
                setAckFreqId(null);
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
              title="Clinical Snooze"
            >
              <Clock size={13} />
              Snooze
            </button>
          </div>
        </div>

        {/* Inline Acknowledge Panel */}
        {isAcking && (
          <div className="mt-3 rounded-xl border border-purple-100 bg-purple-50/50 p-3">
            <label className="mb-1 block text-xs font-bold text-slate-800">
              Cadence Clinical Acknowledgment
            </label>
            <input
              type="text"
              value={ackFreqNote}
              onChange={(e) => setAckFreqNote(e.target.value)}
              placeholder="e.g. Confirmed client next appointment Thursday at 2:00 PM."
              className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs outline-none focus:border-[#5C2D91]"
            />
            {item.risk === 'high' && (
              <p className="mt-1 text-[11px] text-red-600 font-semibold">
                High-risk client: Clinical policy requires re-acknowledgment every 72 hours until next encounter is logged.
              </p>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAckFreqId(null)}
                className="rounded-lg px-3 py-1 text-xs font-semibold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleAcknowledgeFreq(item.id)}
                className="rounded-lg bg-[#5C2D91] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#4A2475]"
              >
                Save Acknowledgment
              </button>
            </div>
          </div>
        )}

        {/* Inline Clinical Snooze Panel */}
        {isSnoozing && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-2">
            <label className="block text-xs font-bold text-slate-900">
              Clinical Reason for Deferral (CARF Justification)
            </label>
            <select
              value={snoozeReason}
              onChange={(e) => setSnoozeReason(e.target.value)}
              className="w-full rounded-xl border border-amber-200 bg-white p-2 text-xs font-semibold text-slate-800 outline-none"
            >
              <option value="Client traveling">Client traveling / temporary absence</option>
              <option value="Insurance authorization pending">Insurance authorization pending</option>
              <option value="Awaiting medication stabilization">Awaiting medication stabilization</option>
              <option value="Next appointment already scheduled">Next appointment already scheduled</option>
              <option value="Hospitalization / higher LOC episode">Hospitalization / higher LOC episode</option>
            </select>

            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs font-semibold text-slate-600">Snooze Duration:</span>
              {[
                { label: '1 week (7d)', days: 7 },
                { label: '2 weeks (14d)', days: 14 },
                { label: '1 month (30d)', days: 30 },
              ].map((d) => (
                <button
                  key={d.days}
                  type="button"
                  onClick={() => setSnoozeDays(d.days)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    snoozeDays === d.days
                      ? 'bg-[#5C2D91] text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {item.risk === 'high' && (
              <p className="text-[11px] font-bold text-red-700">
                High-risk client: snooze still logged in audit trail and visible to clinical director / supervisor.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSnoozeFreqId(null)}
                className="rounded-lg px-3 py-1 text-xs font-semibold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSnoozeFreq(item.id)}
                className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
              >
                Apply Clinical Snooze
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
}
