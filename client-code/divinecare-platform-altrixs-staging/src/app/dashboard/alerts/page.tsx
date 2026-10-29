'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart2,
  CalendarDays,
  CalendarX,
  Check,
  CheckCircle2,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import {
  fetchRiskAlerts,
  reviewRiskAlert,
  type RiskAlert,
  type RiskAlertSummary,
  type Severity,
} from '@/features/alerts';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { useLocation } from '@/context/LocationContext';
import {
  BUCKET_META,
  LikelyInactiveActions,
  SessionFrequencyTable,
  useSessionFrequency,
  type AlertBucket,
  type SessionFrequencyItem,
} from '@/features/caseload/sessionFrequency';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  cardClasses,
  cx,
  EmptyState,
  ErrorState,
  FOCUS_RING,
  inputClasses,
  LoadingState,
  Modal,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  type TabItem,
  type Tone,
} from '@/components/ui';

const SEV_TONE: Record<Severity, Tone> = {
  high: 'danger',
  medium: 'warning',
  low: 'info',
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
  const color = value <= 3 ? 'bg-rose-500' : value <= 6 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span aria-hidden className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <span className={`inline-block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-medium text-slate-800">{value}/10</span>
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
// TAB 3: MBC ESCALATIONS DATA
// -----------------------------------------------------------------------------
export interface MbcEscalationItem {
  id: string;
  clientId: string;
  clientName: string;
  clinicianName?: string;
  instrument: string; // 'PHQ-9' | 'C-SSRS' | 'GAD-7' | 'AUDIT-C'
  previousScore?: number;
  currentScore: number;
  severityShift: string;
  previousCadence?: string;
  recommendedCadence?: string;
  apaRationale?: string;
  triggeredAt: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
}

const INITIAL_MBC_ESCALATIONS: MbcEscalationItem[] = [];

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

/** Session-frequency groups loaded with the page; the rest load when opened */
const EAGER_BUCKETS: AlertBucket[] = ['overdue', 'unassigned', 'due_soon', 'no_sessions'];

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

  // Tab 2: Session frequency — GET /api/clinical/session-frequency (counts and list from one response)
  const { activeLocationId, isAllLocations } = useLocation();
  const freqLocationId = isAllLocations ? undefined : activeLocationId || undefined;
  // Counts for the whole scope + the action lists; long lists (on track, scheduled) load when opened
  const freq = useSessionFrequency({ locationId: freqLocationId, view: 'summary', buckets: EAGER_BUCKETS });
  const [extraBuckets, setExtraBuckets] = useState<AlertBucket[]>([]);
  const freqExtra = useSessionFrequency({
    locationId: freqLocationId,
    view: 'summary',
    buckets: extraBuckets,
    enabled: extraBuckets.length > 0,
  });

  // Tab 3: MBC Escalations State (GET/POST /api/clinical/mbc/alerts)
  const [mbcEscalations, setMbcEscalations] = useState<MbcEscalationItem[]>([]);
  const [mbcError, setMbcError] = useState<string | null>(null);
  const [mbcAckId, setMbcAckId] = useState<string | null>(null);
  const [mbcAckNote, setMbcAckNote] = useState('');
  const [mbcSaving, setMbcSaving] = useState(false);

  // Open a tab from a link, e.g. /dashboard/alerts?tab=frequency from the client directory banner
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'risk' || tab === 'team_alerts' || tab === 'frequency' || tab === 'mbc' || tab === 'compliance') {
      setActiveTab(tab);
    }
  }, []);

  // MBC escalations (PHQ-9 / GAD-7 score alerts + clinician response): same roles as /dashboard/mbc
  // and its API (licensed providers, leadership, crisis). PRP, Case Manager and Office Manager open
  // Alerts but not this tab, so it is hidden instead of answering 403.
  const canSeeMbc = canAccessPath(user?.role, '/dashboard/mbc');
  useEffect(() => {
    if (user && !canSeeMbc && activeTab === 'mbc') setActiveTab('risk');
  }, [user, canSeeMbc, activeTab]);

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
        if (Array.isArray(data.alerts)) {
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

  // Load MBC alerts (flagged assessments + acknowledgments) from the clinical API
  const loadMbc = useCallback(async () => {
    if (!canSeeMbc) {
      setMbcEscalations([]);
      return;
    }
    try {
      const res = await fetch('/api/clinical/mbc/alerts');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.data)) {
        // Roles without clinical access get 403 — leave the tab empty
        if (res.status !== 403) setMbcError(data.error || 'Could not load MBC alerts');
        return;
      }
      setMbcError(null);
      setMbcEscalations(
        data.data.map((a: {
          id: string;
          clientId: string;
          clientName: string;
          instrumentName: string;
          totalScore: number;
          severity: string;
          safetyFlagged?: boolean;
          safetyNotes?: string | null;
          completedAt: string;
          isAcknowledged: boolean;
        }) => ({
          id: a.id,
          clientId: a.clientId,
          clientName: a.clientName,
          instrument: a.instrumentName,
          currentScore: a.totalScore,
          severityShift: `${a.severity} (score ${a.totalScore})${a.safetyFlagged ? ' · safety item endorsed' : ''}`,
          apaRationale: a.safetyNotes || undefined,
          triggeredAt: a.completedAt,
          acknowledged: a.isAcknowledged,
        }))
      );
    } catch (err) {
      setMbcError(err instanceof Error ? err.message : 'Could not load MBC alerts');
    }
  }, [canSeeMbc]);

  useEffect(() => {
    void loadRisk();
    void loadTeamAlerts();
    void loadMbc();
  }, [loadRisk, loadTeamAlerts, loadMbc]);

  // Frequency groups: each list is a filter of the same items the summary counts
  const freqByBucket = useMemo(() => {
    const groups = new Map<AlertBucket, SessionFrequencyItem[]>();
    for (const item of [...freq.items, ...freqExtra.items]) {
      groups.set(item.bucket, [...(groups.get(item.bucket) ?? []), item]);
    }
    return groups;
  }, [freq.items, freqExtra.items]);

  // Team compliance: per assigned clinician, computed server-side from the same items
  const teamCompliance = freq.byClinician;

  // Top 4 Stat Counts
  const statUnreviewedRisk = summary.totalUnreviewed;
  const statOverdueFreq = freq.summary.overdue;
  const statDueSoonFreq = freq.summary.due_soon;
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

  // Actions for Tab 3: Acknowledge MBC Escalation (persists an MbcAlertAck with the clinician's note)
  const handleAcknowledgeMbc = async (id: string) => {
    if (!mbcAckNote.trim()) return;
    setMbcSaving(true);
    setMbcError(null);
    try {
      const res = await fetch('/api/clinical/mbc/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessmentRecordId: id, notes: mbcAckNote.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setMbcError(data.error || `Could not save acknowledgment (${res.status})`);
        return;
      }
      setMbcEscalations((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, acknowledged: true, acknowledgedAt: data.data?.createdAt ?? new Date().toISOString() }
            : item
        )
      );
      setMbcAckId(null);
      setMbcAckNote('');
    } catch (err) {
      setMbcError(err instanceof Error ? err.message : 'Could not save acknowledgment');
    } finally {
      setMbcSaving(false);
    }
  };

  const openTeamAlerts = teamAlerts.filter((t) => t.status === 'Open').length;
  const filteredTeamAlerts = teamAlerts.filter((item) => {
    if (teamAlertFilter === 'all') return true;
    if (teamAlertFilter === 'Resolved') return item.status === 'Resolved';
    return item.urgency === teamAlertFilter && item.status !== 'Resolved';
  });

  const tabItems: TabItem<MainTab>[] = [
    { key: 'risk', label: 'Risk Alerts', icon: <ShieldAlert />, count: statUnreviewedRisk > 0 ? statUnreviewedRisk : undefined, countTone: 'attention' },
    { key: 'team_alerts', label: 'Team Alerts (@-Tagged)', icon: <MessageSquare />, count: openTeamAlerts > 0 ? openTeamAlerts : undefined, countTone: 'attention' },
    { key: 'frequency', label: 'Session Frequency', icon: <CalendarX />, count: statOverdueFreq > 0 ? statOverdueFreq : undefined, countTone: 'attention' },
    ...(canSeeMbc
      ? [{ key: 'mbc' as const, label: 'MBC Escalations', icon: <TrendingUp />, count: statUnackMbc > 0 ? statUnackMbc : undefined, countTone: 'attention' as const }]
      : []),
    ...(isAdminOrDirector ? [{ key: 'compliance' as const, label: 'Team Compliance (CARF)', icon: <BarChart2 /> }] : []),
  ];

  return (
    <Page>
      <PageHeader
        title="Clinical Alert Hub & CARF Compliance"
        description="Monitor client risk, session frequency cadence, and measurement-based care escalations"
        actions={
          <Button
            variant="secondary"
            onClick={() => void loadRisk()}
            icon={<RefreshCw className={loading ? 'animate-spin' : ''} />}
          >
            Refresh Data
          </Button>
        }
      />

      {error ? (
        <Alert
          tone="danger"
          actions={
            <Button variant="secondary" size="sm" onClick={() => void loadRisk()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      <Alert tone="warning" title="Preview data">
        Session Frequency, MBC Escalations and Team Compliance are demonstration previews with fictional records.
        Preview acknowledgments and snoozes reset on reload and are not saved to patient charts.
        Risk Alerts use saved clinic data.
      </Alert>

      {/* 4 Top Summary Stat Cards */}
      <StatGrid columns={4}>
        <StatCard
          label="Unreviewed Risk"
          value={statUnreviewedRisk}
          hint="Client check-in flags"
          icon={<ShieldAlert />}
          tone="danger"
        />
        <StatCard
          label="Sessions Overdue"
          value={statOverdueFreq}
          hint="Individual therapy, past interval + grace"
          icon={<CalendarX />}
          tone="danger"
        />
        <StatCard
          label="Sessions Due Soon"
          value={statDueSoonFreq}
          hint="Due now, nothing booked yet"
          icon={<CalendarDays />}
          tone="warning"
        />
        <StatCard
          label="MBC Escalations"
          value={statUnackMbc}
          hint="Psychometric score spikes"
          icon={<TrendingUp />}
          tone="brand"
        />
      </StatGrid>

      {/* Tabs Navigation */}
      <Tabs
        items={tabItems}
        value={activeTab}
        onChange={(key) => setActiveTab(key)}
        label="Alert categories"
        controlsPanels={false}
      />

      {/* TAB 1: RISK ALERTS */}
      {activeTab === 'risk' && (
        <div className="space-y-4">
          {/* Risk Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter risk alerts">
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
                aria-pressed={riskFilter === f.key}
                onClick={() => setRiskFilter(f.key as any)}
                className={cx(
                  'min-h-10 rounded-full px-3.5 py-1.5 text-xs font-semibold transition md:min-h-8',
                  FOCUS_RING,
                  riskFilter === f.key
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loading && alerts.length === 0 ? (
            <Card>
              <LoadingState label="Loading risk alerts…" />
            </Card>
          ) : filteredRiskAlerts.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CheckCircle2 />}
                title="All risk alerts cleared"
                description="No active wellness concerns matching your filter."
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredRiskAlerts.map((a) => {
                const isReviewing = reviewingId === a.id;
                return (
                  <Card key={a.id} className="p-4 transition hover:shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div
                          aria-hidden
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 font-semibold text-blue-700"
                        >
                          {initials(a.clientName)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/dashboard/clients/${a.clientId}`}
                              className="rounded font-semibold text-slate-900 hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                            >
                              {a.clientName}
                            </Link>
                            <StatusBadge tone={SEV_TONE[a.severity]} size="sm" dot className="capitalize">
                              {a.severity}
                            </StatusBadge>
                            {a.reviewed && (
                              <StatusBadge tone="neutral" size="sm">
                                Reviewed
                              </StatusBadge>
                            )}
                          </div>
                          <p className="mt-1 break-words text-sm text-slate-800">{a.description}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                            <span>Mood: <MoodBar value={a.mood} /></span>
                            <span>Stress: <span className="font-semibold text-slate-700">{a.stress}/10</span></span>
                            <span>{formatWhen(a.createdAt)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2 self-end sm:self-start">
                        <Link
                          href={`/dashboard/messages?client=${a.clientId}`}
                          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                        >
                          <MessageSquare size={14} aria-hidden />
                          Message
                        </Link>
                        {!a.reviewed && (
                          <Button size="sm" onClick={() => setReviewingId(isReviewing ? null : a.id)}>
                            {isReviewing ? 'Close' : 'Review'}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Inline Review Panel */}
                    {isReviewing && (
                      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                        <label htmlFor={`review-note-${a.id}`} className="mb-1.5 block text-sm font-medium text-slate-700">
                          Document Clinical Assessment / Disposition *
                        </label>
                        <textarea
                          id={`review-note-${a.id}`}
                          rows={2}
                          value={reviewNote}
                          onChange={(e) => setReviewNote(e.target.value)}
                          placeholder="e.g. Telehealth safety check conducted with client; safety contract verified, no active intent."
                          className={inputClasses}
                        />
                        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setReviewingId(null);
                              setReviewNote('');
                            }}
                          >
                            Cancel
                          </Button>
                          <Button size="sm" disabled={saving} onClick={() => handleReviewRisk(a)}>
                            {saving ? 'Saving…' : 'Mark Reviewed'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {/* Bottom Crisis Response Protocol Box */}
          <Alert tone="danger" title="Crisis Response Protocol (CARF & State Standards)">
            <p className="leading-relaxed">
              Clients screening positive on C-SSRS Level 4+ or expressing immediate active suicidal ideation require clinical outreach within <strong>1 hour</strong>. Verify current physical location, execute Stanley-Brown safety plan, and engage 988 Crisis Response or emergency services if uncontactable.
            </p>
            <p className="pt-1 font-semibold">
              National Suicide & Crisis Lifeline: <strong>Call/Text 988</strong> · Maryland 211 Crisis Warmline
            </p>
          </Alert>
        </div>
      )}

      {/* SECTION 5.6: TEAM ALERTS (@-TAGGED CLINICIAN ALERTS) */}
      {activeTab === 'team_alerts' && (
        <div className="space-y-6">
          <Alert tone="info" title="Inter-Provider Clinical Tagging & Team Communications">
            Direct @-mentions created by colleagues during encounter documentation, somatic reviews, or peer consultations.
          </Alert>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter team alerts">
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
                  aria-pressed={teamAlertFilter === key}
                  onClick={() => setTeamAlertFilter(key)}
                  className={cx(
                    'min-h-10 rounded-full px-3.5 py-1.5 text-xs font-semibold transition md:min-h-8',
                    FOCUS_RING,
                    teamAlertFilter === key
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <span className="text-xs text-slate-500">{openTeamAlerts} pending clinician action</span>
          </div>

          {/* Alerts List */}
          {filteredTeamAlerts.length === 0 ? (
            <Card>
              <EmptyState
                icon={<MessageSquare />}
                title="No team alerts"
                description="Alerts appear here when a colleague @-tags you on a client during documentation or consultation."
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredTeamAlerts.map((alert) => {
                const urgencyTone: Tone =
                  alert.urgency === 'Urgent' ? 'danger' : alert.urgency === 'Routine' ? 'info' : 'neutral';

                return (
                  <Card key={alert.id} className="p-4 transition hover:shadow-sm sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={urgencyTone} size="sm" dot>
                            {alert.urgency}
                          </StatusBadge>
                          <StatusBadge tone={alert.status === 'Open' ? 'warning' : 'success'} size="sm">
                            {alert.status}
                          </StatusBadge>
                          <Link
                            href={`/dashboard/clients/${alert.clientId}`}
                            className="rounded text-sm font-semibold text-slate-900 hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                          >
                            {alert.clientName}
                          </Link>
                          <span className="text-xs text-slate-500">· {formatWhen(alert.createdAt)}</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span>
                            From: <strong className="text-slate-800">{alert.senderName}</strong>{' '}
                            <span className="text-slate-500">({alert.senderRole})</span>
                          </span>
                          <ArrowRight size={12} className="text-slate-400" aria-hidden />
                          <StatusBadge tone="brand" size="sm">
                            To: {alert.taggedClinician}
                          </StatusBadge>
                        </div>

                        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm leading-relaxed text-slate-800">
                          {alert.concernText}
                        </div>

                        {alert.status === 'Resolved' && alert.resolutionNote && (
                          <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                            <p className="flex items-center gap-1.5 font-semibold text-emerald-800">
                              <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden />
                              Resolved by {alert.resolvedBy} ({formatWhen(alert.resolvedAt || '')})
                            </p>
                            <p className="pl-5.5 font-medium text-emerald-900">
                              &ldquo;{alert.resolutionNote}&rdquo;
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2 self-end sm:self-start">
                        <Link
                          href={`/dashboard/clients/${alert.clientId}`}
                          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                        >
                          View Chart
                        </Link>
                        {alert.status === 'Open' && (
                          <Button
                            size="sm"
                            icon={<Check />}
                            onClick={() => {
                              setResolvingAlert(alert);
                              setResolutionText('');
                              setResolveError('');
                            }}
                          >
                            Resolve Alert
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SESSION FREQUENCY (individual therapy) */}
      {activeTab === 'frequency' && (
        <div className="space-y-5">
          <Alert tone="info" title="Individual therapy session frequency">
            <p className="mt-1 text-xs">
              Recommended frequency comes from the active treatment plan&apos;s service frequency, else an approved
              authorization with therapy CPT codes, else the clinic default (weekly). Overdue = days since the last
              attended session (90832/90834/90837) past the interval plus grace (weekly: over 10 days, every 2 weeks:
              over 17, monthly: over 35), unless a session is already booked within the grace window. Med-management
              visits do not count toward therapy cadence. Active clients only; clients with no appointment or note in
              the last 180 days and nothing booked are listed under &quot;Overdue more than 180 days — likely inactive&quot;
              instead of overdue
              {freq.summary.total ? ` · ${freq.summary.total} clients in scope` : ''}.
            </p>
          </Alert>

          {freq.loading ? (
            <Card>
              <LoadingState label="Loading session frequency…" />
            </Card>
          ) : freq.error ? (
            <Alert tone="danger">{freq.error}</Alert>
          ) : (
            (['overdue', 'unassigned', 'due_soon', 'no_sessions', 'scheduled', 'on_track', 'not_tracked', 'likely_inactive'] as AlertBucket[]).map((bucket) => {
              const list = freqByBucket.get(bucket) ?? [];
              const count = freq.summary[bucket];
              const meta = BUCKET_META[bucket];
              const eager = EAGER_BUCKETS.includes(bucket);
              const open = bucket === 'overdue' || bucket === 'unassigned' || bucket === 'due_soon';
              const pending = !eager && (!extraBuckets.includes(bucket) || freqExtra.loading);
              return (
                <details
                  key={bucket}
                  open={open && count > 0}
                  onToggle={(e) => {
                    if (!eager && (e.currentTarget as HTMLDetailsElement).open && !extraBuckets.includes(bucket)) {
                      setExtraBuckets((prev) => [...prev, bucket]);
                    }
                  }}
                  className={cx(cardClasses, 'overflow-hidden')}
                >
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                    <span aria-hidden className={cx('h-2.5 w-2.5 rounded-full', meta.dot)} />
                    {meta.label} ({count})
                    {bucket === 'unassigned' && (
                      <span className="text-xs font-medium text-slate-500">— active clients with no assigned clinician</span>
                    )}
                  </summary>
                  <div className="border-t border-slate-100">
                    {pending ? (
                      <LoadingState label="Loading…" className="py-6" />
                    ) : !eager && freqExtra.error ? (
                      <p role="alert" className="px-4 py-6 text-center text-sm text-rose-700">{freqExtra.error}</p>
                    ) : (
                      <>
                        {bucket === 'likely_inactive' && (
                          <LikelyInactiveActions
                            items={list}
                            canReview={canAccessPath(user?.role, '/dashboard/ehr/discharge')}
                          />
                        )}
                        <SessionFrequencyTable items={list} />
                      </>
                    )}
                  </div>
                </details>
              );
            })
          )}
        </div>
      )}

      {/* TAB 3: MBC (MEASUREMENT-BASED CARE) ESCALATIONS */}
      {activeTab === 'mbc' && canSeeMbc && (
        <div className="space-y-4">
          <Alert tone="brand" title="Measurement-Based Care (MBC) Automated Frequency Triggers">
            When standardized outcome rating scales (PHQ-9, C-SSRS, GAD-7, AUDIT-C) show clinically significant deterioration, the engine recommends step-up in session frequency.
          </Alert>

          {mbcError && <Alert tone="danger">{mbcError}</Alert>}
          {mbcEscalations.length === 0 && !mbcError && (
            <Card>
              <EmptyState
                compact
                icon={<TrendingUp />}
                title="No MBC alerts for your clients."
                description="Flagged PHQ-9, GAD-7, C-SSRS and AUDIT-C scores appear here for acknowledgment."
              />
            </Card>
          )}

          <div className="space-y-3">
            {mbcEscalations.map((mbc) => (
              <Card key={mbc.id} className="p-4 transition hover:shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/dashboard/clients/${mbc.clientId}`}
                        className="rounded text-sm font-semibold text-slate-900 hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                      >
                        {mbc.clientName}
                      </Link>
                      <StatusBadge tone="brand" size="sm">
                        {mbc.instrument} Trigger
                      </StatusBadge>
                      {mbc.clinicianName && (
                        <span className="text-xs font-semibold text-slate-500">
                          Clinician: {mbc.clinicianName}
                        </span>
                      )}
                      {mbc.acknowledged && (
                        <StatusBadge tone="success" size="sm">
                          Acknowledged
                        </StatusBadge>
                      )}
                    </div>

                    <p className="text-xs font-semibold text-rose-700">
                      Score Spike: {mbc.severityShift}
                    </p>

                    {/* Cadence Transition pill */}
                    {mbc.previousCadence && mbc.recommendedCadence && (
                      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                        <span className="font-medium text-slate-500">Planned Cadence:</span>
                        <span className="text-slate-500 line-through">{mbc.previousCadence}</span>
                        <ArrowRight size={12} className="text-slate-400" aria-hidden />
                        <StatusBadge tone="brand" size="sm">
                          Recommended: {mbc.recommendedCadence}
                        </StatusBadge>
                      </div>
                    )}

                    {mbc.apaRationale && (
                      <p className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600">
                        {mbc.apaRationale}
                      </p>
                    )}

                    {mbcAckId === mbc.id && !mbc.acknowledged && (
                      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <label htmlFor={`mbc-ack-${mbc.id}`} className="mb-1 block text-sm font-medium text-slate-700">
                          Clinician response (required)
                        </label>
                        <input
                          id={`mbc-ack-${mbc.id}`}
                          type="text"
                          value={mbcAckNote}
                          onChange={(e) => setMbcAckNote(e.target.value)}
                          maxLength={5000}
                          placeholder="e.g. Reviewed with client; increased session frequency to weekly."
                          className={inputClasses}
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setMbcAckId(null);
                              setMbcAckNote('');
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            disabled={mbcSaving || !mbcAckNote.trim()}
                            onClick={() => void handleAcknowledgeMbc(mbc.id)}
                          >
                            {mbcSaving ? 'Saving…' : 'Save Acknowledgment'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 self-end sm:self-start">
                    <Link href="/dashboard/appointments" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                      Schedule
                    </Link>
                    {!mbc.acknowledged ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          setMbcAckId(mbc.id);
                          setMbcAckNote('');
                        }}
                      >
                        Acknowledge
                      </Button>
                    ) : (
                      <span className="text-xs font-semibold text-slate-500">
                        Acknowledgment saved
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: TEAM CARF 2026 COMPLIANCE OVERVIEW */}
      {activeTab === 'compliance' && isAdminOrDirector && (
        <div className="space-y-4">
          <Alert tone="brand" title="CARF 2026 Outpatient Delivery & Caseload Audit Roster">
            Audit metric measuring compliance between treatment-plan prescribed cadence and actual encounter completion across all active clinicians.
          </Alert>

          <Card className="overflow-hidden">
            {freq.loading ? (
              <LoadingState rows={4} label="Loading team compliance…" />
            ) : freq.error ? (
              <ErrorState title="Could not load team compliance" description={freq.error} onRetry={() => void freq.reload()} />
            ) : teamCompliance.length === 0 ? (
              <EmptyState
                icon={<BarChart2 />}
                title="No clinicians with assigned active clients"
                description="Assign active clients to clinicians to see their cadence compliance here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th scope="col" className="px-4 py-3">Clinician & Role</th>
                      <th scope="col" className="px-3 py-3 text-center">Active clients</th>
                      <th scope="col" className="px-3 py-3 text-center">On Track / Scheduled</th>
                      <th scope="col" className="px-3 py-3 text-center">Due Soon</th>
                      <th scope="col" className="px-3 py-3 text-center">Overdue</th>
                      <th scope="col" className="px-3 py-3 text-center">No Sessions</th>
                      <th scope="col" className="px-4 py-3 text-right">On Cadence %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {teamCompliance.map((row) => {
                      const isHigh = row.compliancePct >= 80;
                      const isMid = row.compliancePct >= 60 && row.compliancePct < 80;
                      const barColor = isHigh ? 'bg-emerald-500' : isMid ? 'bg-amber-500' : 'bg-rose-500';
                      const textColor = isHigh ? 'text-emerald-700' : isMid ? 'text-amber-700' : 'text-rose-700';

                      return (
                        <tr key={row.id} className="transition hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-900">{row.name}</p>
                          </td>
                          <td className="px-3 py-3 text-center font-semibold tabular-nums text-slate-700">{row.total}</td>
                          <td className="px-3 py-3 text-center">
                            <StatusBadge tone="success" size="sm">{row.counts.on_track + row.counts.scheduled}</StatusBadge>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <StatusBadge tone="warning" size="sm">{row.counts.due_soon}</StatusBadge>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <StatusBadge tone="danger" size="sm">{row.counts.overdue}</StatusBadge>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <StatusBadge tone="neutral" size="sm">{row.counts.no_sessions}</StatusBadge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                                <div
                                  className={`h-full rounded-full ${barColor}`}
                                  style={{ width: `${row.compliancePct}%` }}
                                />
                              </div>
                              <span className={`font-semibold tabular-nums ${textColor}`}>
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
            )}
          </Card>

          {/* Explanatory CARF Audit Documentation Footer */}
          <Card className="space-y-1 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
            <p className="font-semibold text-slate-900">CARF Outpatient Standard 2.D.4 Audit Documentation:</p>
            <p>
              Accreditation requires evidence that outpatient psychotherapy and psychiatric medication monitoring adhere to documented treatment frequencies. Any deviation exceeding 14 calendar days without clinical rationale documentation (snooze/hold) is classified as a non-conformance finding during clinical peer review.
            </p>
          </Card>
        </div>
      )}

      {/* SECTION 5.6: Resolve Team Alert Modal */}
      {resolvingAlert && (
        <Modal
          title="Resolve Clinical Alert"
          size="sm"
          onClose={() => setResolvingAlert(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setResolvingAlert(null)}>
                Cancel
              </Button>
              <Button
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
              >
                {resolvingLoading ? 'Saving…' : 'Confirm Resolution'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-500">Document clinical resolution note & archive alert</p>

          <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
            <p>
              <strong>Patient:</strong> {resolvingAlert.clientName}
            </p>
            <p>
              <strong>From:</strong> {resolvingAlert.senderName} ({resolvingAlert.senderRole})
            </p>
            <p className="mt-1 italic text-slate-500">&ldquo;{resolvingAlert.concernText}&rdquo;</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="team-alert-resolution" className="block text-sm font-medium text-slate-700">
              Resolution Note & Clinical Actions Taken *
            </label>
            <textarea
              id="team-alert-resolution"
              rows={3}
              value={resolutionText}
              onChange={(e) => {
                setResolutionText(e.target.value);
                setResolveError('');
              }}
              placeholder="e.g. Conducted psychiatric med review; adjusted Sertraline dose and messaged patient."
              aria-invalid={resolveError ? true : undefined}
              className={cx(inputClasses, 'mt-1')}
            />
            {resolveError && <p role="alert" className="text-xs font-semibold text-rose-700">{resolveError}</p>}
          </div>
        </Modal>
      )}
    </Page>
  );
}
