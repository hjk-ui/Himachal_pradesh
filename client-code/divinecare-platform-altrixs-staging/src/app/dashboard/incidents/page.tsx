'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  Hexagon,
  MapPin,
  Plus,
  Shield,
  TrendingDown,
  User,
  Users,
  X,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useStaff } from '@/features/staff';
import { isInQuarter, practiceQuarter } from '@/lib/compliance/metrics';
import { fromPracticeWallTime, practiceToday } from '@/lib/time/practiceTime';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FormField,
  IconButton,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  buttonClasses,
  cx,
  inputClasses,
  type Tone,
} from '@/components/ui';
import {
  type Incident,
  type IncidentStatus,
  type Severity,
  INCIDENT_TYPES,
  INCIDENTS_SEED,
  CHART_CATEGORIES,
  avgResolutionDays,
  chartCategoryForType,
  formatIncidentDate,
  isOpenIncident,
  normalizeIncident,
} from '@/features/compliance/incidentsData';

export { INCIDENTS_SEED } from '@/features/compliance/incidentsData';

type TabKey = 'open' | 'history';

const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: 'danger',
  serious: 'warning',
  minor: 'neutral',
};

const STATUS_TONE: Record<IncidentStatus, Tone> = {
  reported: 'info',
  investigating: 'warning',
  corrective_action: 'warning',
  closed: 'success',
  filed_in_error: 'neutral',
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  reported: 'Reported',
  investigating: 'Investigating',
  corrective_action: 'Corrective Action',
  closed: 'Closed',
  filed_in_error: 'Filed in error',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  serious: 'Serious',
  minor: 'Minor',
};

const emptyForm = {
  title: '',
  type: INCIDENT_TYPES[0] as string,
  severity: 'minor' as Severity,
  clientInitials: '',
  location: '',
  description: '',
  immediateAction: '',
  carfCategory: 'Health & Safety',
  dueFollowUp: '',
  /** Practice wall-clock date/time the incident occurred (needed for 24h timeliness). */
  occurredDate: '',
  occurredTime: '',
  /** Staff user id of the assignee ('' = unassigned) */
  assignedTo: '',
  /** Staff user ids named as involved */
  involvedStaffIds: [] as string[],
};

/** Today on the practice clock (America/New_York), not UTC. */
function todayIso() {
  return practiceToday();
}

/**
 * Incident reports (IncidentReport rows via /api/incidents). Reviewers (leadership, Office Manager,
 * verified Medical Director) get the practice's reports; other staff the reports they filed, that
 * name them as involved staff or that are assigned to them. The server numbers new reports.
 */
export default function IncidentsPage() {
  const [rawIncidents, setRawIncidents] = useState<Incident[]>([]);
  const [reviewer, setReviewer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabKey>('history');
  const [expanded, setExpanded] = useState<string | null>(null);
  const { users: staffDirectory } = useStaff();
  const activeStaff = useMemo(() => staffDirectory.filter((u) => u.status === 'ACTIVE'), [staffDirectory]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiJson<{ success: true; reviewer: boolean; incidents: Incident[] }>('/api/incidents');
      setRawIncidents(res.incidents ?? []);
      setReviewer(Boolean(res.reviewer));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load incidents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replaceIncident = (next: Incident) =>
    setRawIncidents((prev) => prev.map((i) => (i.recordId === next.recordId ? next : i)));
  const quarter = useMemo(() => practiceQuarter(), []);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const incidents = useMemo(() => rawIncidents.map(normalizeIncident), [rawIncidents]);

  const openCount = useMemo(() => incidents.filter(isOpenIncident).length, [incidents]);
  const historyCount = useMemo(() => incidents.filter((i) => !isOpenIncident(i)).length, [incidents]);

  const filtered = useMemo(() => {
    const list = incidents.filter((i) => (tab === 'open' ? isOpenIncident(i) : !isOpenIncident(i)));
    return [...list].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  }, [incidents, tab]);

  const quarterIncidents = useMemo(
    () => incidents.filter((i) => isInQuarter(i.reportedAt, quarter)),
    [incidents, quarter]
  );

  const stats = useMemo(() => {
    const today = todayIso();
    const overdue = incidents.filter((i) => isOpenIncident(i) && i.dueFollowUp < today).length;
    return {
      total: quarterIncidents.length,
      open: openCount,
      avgDays: avgResolutionDays(incidents),
      overdue,
    };
  }, [incidents, quarterIncidents, openCount]);

  const typeBars = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of CHART_CATEGORIES) counts[c.key] = 0;
    for (const i of quarterIncidents) {
      const key = i.chartCategory || chartCategoryForType(i.type);
      counts[key] = (counts[key] || 0) + 1;
    }
    const max = Math.max(1, ...Object.values(counts));
    return CHART_CATEGORIES.map((c) => ({
      ...c,
      count: counts[c.key] || 0,
      pct: ((counts[c.key] || 0) / max) * 100,
    })).filter((r) => r.count > 0 || quarterIncidents.length === 0);
  }, [quarterIncidents]);

  async function advanceStatus(inc: Incident) {
    if (!inc.recordId) return;
    const order: IncidentStatus[] = ['reported', 'investigating', 'corrective_action', 'closed'];
    const idx = order.indexOf(inc.status);
    const next = order[Math.min(idx + 1, order.length - 1)];
    setActionError(null);
    try {
      const res = await apiJson<{ success: true; incident: Incident }>(`/api/incidents/${encodeURIComponent(inc.recordId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      replaceIncident(res.incident);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not update the incident');
    }
  }

  async function submitIncident() {
    if (!form.title.trim() || !form.description.trim() || saving) return;
    const due =
      form.dueFollowUp ||
      (() => {
        const d = new Date();
        d.setDate(d.getDate() + 14);
        return d.toISOString().slice(0, 10);
      })();
    const occurred =
      form.occurredDate && form.occurredTime ? fromPracticeWallTime(form.occurredDate, form.occurredTime) : null;
    setSaving(true);
    setActionError(null);
    try {
      // The server sets the reporter (the signed-in user), the number and the report time.
      const res = await apiJson<{ success: true; incident: Incident }>('/api/incidents', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          type: form.type,
          chartCategory: chartCategoryForType(form.type),
          severity: form.severity,
          clientInitials: form.clientInitials.trim() || null,
          occurredAt: occurred ? occurred.toISOString() : null,
          dueFollowUp: due,
          location: form.location.trim() || null,
          description: form.description.trim(),
          immediateAction: form.immediateAction.trim() || null,
          carfCategory: form.carfCategory || null,
          assignedToUserId: form.assignedTo || null,
          involvedStaffIds: form.involvedStaffIds,
        }),
      });
      setRawIncidents((prev) => [res.incident, ...prev]);
      setExpanded(res.incident.id);
      setForm(emptyForm);
      setShowModal(false);
      setTab('open');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not file the incident');
    } finally {
      setSaving(false);
    }
  }

  function handleCarfExport() {
    const report = {
      exportedAt: new Date().toISOString(),
      program: 'CARF Incident Summary',
      period: `${quarter.label} (${quarter.rangeLabel})`,
      summary: stats,
      incidents: incidents.map((i) => ({
        id: i.id,
        date: i.reportedAt,
        type: i.type,
        severity: i.severity,
        status: i.status,
        client: i.clientInitials,
        reporter: i.reportedBy,
        timeliness: i.timeliness,
        location: i.location,
        description: i.description,
        immediateAction: i.immediateAction,
        investigationNotes: i.investigationNotes,
        correctiveActions: i.correctiveActions,
        rootCause: i.rootCause,
        carfCategory: i.carfCategory,
      })),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carf-incident-export-${todayIso()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const description = (
    <>
      <p>Client safety incidents, investigations, and corrective actions — required for accreditation</p>
      {!reviewer && !loading && (
        <p className="mt-1 text-xs text-slate-500">
          You see the reports you filed, that name you as involved staff, or that are assigned to you. Quality and leadership review all reports.
        </p>
      )}
    </>
  );

  if (loading && incidents.length === 0) {
    return (
      <Page>
        <PageHeader title="Incident Reporting" description={description} />
        <Card>
          <LoadingState label="Loading incidents…" />
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Incident Reporting"
        description={description}
        actions={
          <>
            <Button variant="secondary" icon={<Hexagon />} onClick={handleCarfExport}>
              CARF Export
            </Button>
            <Button icon={<Plus />} onClick={() => setShowModal(true)}>
              Report Incident
            </Button>
          </>
        }
      />

      {(loadError || actionError) && (
        <Alert
          tone="danger"
          actions={
            loadError ? (
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            ) : undefined
          }
        >
          {loadError || actionError}
        </Alert>
      )}

      <StatGrid columns={4}>
        <StatCard
          label="Total This Quarter"
          value={stats.total}
          hint={quarter.rangeLabel}
          icon={<ClipboardList />}
          tone="info"
        />
        <StatCard
          label="Open Investigations"
          value={stats.open}
          hint="Require follow-up"
          icon={<AlertTriangle />}
          tone="warning"
        />
        <StatCard
          label="Avg Resolution Time"
          value={stats.avgDays || '—'}
          hint="days (closed incidents)"
          icon={<Clock />}
          tone="neutral"
        />
        <StatCard
          label="Overdue Follow-ups"
          value={<span className={stats.overdue > 0 ? 'text-rose-700' : undefined}>{stats.overdue}</span>}
          hint={
            stats.overdue > 0 ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                Past due date
                <StatusBadge tone="danger" size="sm">Action needed</StatusBadge>
              </span>
            ) : (
              'Past due date'
            )
          }
          icon={<TrendingDown />}
          tone="danger"
        />
      </StatGrid>

      <Card>
        <CardHeader title={`Incidents by Type — ${quarter.label}`} icon={<BarChart3 />} />
        <CardBody>
          <div className="space-y-3">
            {typeBars.map((row) => (
              <div key={row.key} className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[130px_minmax(0,1fr)]">
                <span className="truncate text-xs font-medium text-slate-600">{row.key}</span>
                <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${Math.max(row.pct, row.count ? 8 : 0)}%` }}
                    title={`${row.count}`}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            {stats.total} incident{stats.total === 1 ? '' : 's'} reported {quarter.rangeLabel}
          </p>
        </CardBody>
      </Card>

      <Tabs
        variant="pill"
        label="Incident view"
        controlsPanels={false}
        value={tab}
        onChange={setTab}
        items={[
          { key: 'open', label: 'Open Incidents', count: openCount },
          { key: 'history', label: 'Incident History', count: historyCount },
        ]}
      />

      <Card className="overflow-hidden">
        <div className="clinic-scroll-x overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-4 py-3">ID</th>
                <th scope="col" className="px-4 py-3">Date</th>
                <th scope="col" className="px-4 py-3">Client</th>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3">Severity</th>
                <th scope="col" className="px-4 py-3">Reporter</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Timeliness</th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      compact
                      title="No incidents in this view."
                      description={
                        tab === 'open'
                          ? 'Open incidents appear here until they are closed. Use Report Incident to file a new one.'
                          : 'Closed incidents appear here once their investigation is complete.'
                      }
                    />
                  </td>
                </tr>
              )}
              {filtered.map((inc) => {
                const open = expanded === inc.id;
                const overdue = isOpenIncident(inc) && inc.dueFollowUp < todayIso();
                return (
                  <Fragment key={inc.id}>
                    <tr
                      className="group cursor-pointer hover:bg-slate-50"
                      onClick={() => setExpanded(open ? null : inc.id)}
                    >
                      <td className="sticky left-0 z-10 bg-white px-4 py-3 font-mono text-xs text-slate-500 group-hover:bg-slate-50">{inc.id}</td>
                      <td className="px-4 py-3 text-slate-700">{formatIncidentDate(inc.reportedAt)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-slate-800">
                          <Users size={14} aria-hidden className="text-slate-500" />
                          {inc.clientInitials || '—'}
                        </span>
                      </td>
                      <td className="max-w-[160px] truncate px-4 py-3 font-medium text-slate-800">{inc.type}</td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={SEVERITY_TONE[inc.severity] ?? 'neutral'}>
                          {SEVERITY_LABEL[inc.severity] ?? (inc.severity || 'Not recorded')}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{inc.reportedBy || 'Not recorded'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={STATUS_TONE[inc.status] ?? 'neutral'}>
                          {STATUS_LABEL[inc.status] ?? inc.status}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3">
                        {inc.timeliness === null ? (
                          <span className="text-xs font-medium text-slate-500">Not recorded</span>
                        ) : inc.timeliness === 'within_24h' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 size={14} aria-hidden />
                            Within 24h
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                            <AlertTriangle size={14} aria-hidden />
                            Late report
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-50">
                        <td colSpan={9} className="px-4 py-5">
                          <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                            <span className="inline-flex items-center gap-1.5">
                              <MapPin size={14} aria-hidden className="text-slate-500" />
                              {inc.location || 'Location not recorded'}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1.5 ${overdue ? 'font-semibold text-rose-700' : ''}`}
                            >
                              <CalendarDays size={14} aria-hidden className="text-slate-500" />
                              Due: {formatIncidentDate(inc.dueFollowUp)}
                              {overdue ? ' (overdue)' : ''}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <User size={14} aria-hidden className="text-slate-500" />
                              {inc.assignedTo || 'Unassigned'}
                            </span>
                            <StatusBadge tone="neutral">{inc.carfCategory}</StatusBadge>
                          </div>

                          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                            <div className="min-w-0 space-y-4">
                              <div>
                                <p className="text-xs font-semibold text-slate-600">
                                  Description
                                </p>
                                <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{inc.description}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-600">
                                  Investigation Notes
                                </p>
                                <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                                  {inc.investigationNotes || 'Investigation not started.'}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-600">
                                  Root Cause
                                </p>
                                <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-800">
                                  {inc.rootCause || 'Pending investigation.'}
                                </p>
                              </div>
                            </div>
                            <div className="min-w-0 space-y-4">
                              <div>
                                <p className="text-xs font-semibold text-slate-600">
                                  Immediate Action Taken
                                </p>
                                <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                                  {inc.immediateAction || 'Not documented.'}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-600">
                                  Corrective Actions
                                </p>
                                {inc.correctiveActions.length === 0 ? (
                                  <p className="mt-1.5 text-sm text-slate-500">None documented yet.</p>
                                ) : (
                                  <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
                                    {inc.correctiveActions.map((a) => (
                                      <li key={a}>{a}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="mt-5 flex flex-wrap gap-2">
                            {isOpenIncident(inc) && inc.canWork && (
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void advanceStatus(inc);
                                }}
                              >
                                Advance status
                                <ArrowRight className="h-4 w-4" aria-hidden />
                              </Button>
                            )}
                            {reviewer && (
                            <Link
                              href={`/dashboard/qi?newCap=true&incidentId=${inc.id}&source=${encodeURIComponent(`Incident ${inc.id}: ${inc.title}`)}`}
                              className={buttonClasses({ variant: 'secondary' })}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Shield size={16} aria-hidden /> Create QI Corrective Action Plan (CAP)
                            </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="incident-new-title"
            className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl sm:rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <h2 id="incident-new-title" className="text-base font-semibold text-slate-900">Report Incident</h2>
                <p className="mt-0.5 text-sm text-slate-500">Creates a new reported event for QI / CARF review</p>
              </div>
              <IconButton
                label="Close"
                className="h-10 w-10 shrink-0 md:h-8 md:w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                icon={<X className="h-[18px] w-[18px]" />}
                onClick={() => setShowModal(false)}
              />
            </div>
            <div className="space-y-4 px-5 py-5">
              <FormField label="Title">
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className={inputClasses}
                  placeholder="Brief summary of what occurred"
                />
              </FormField>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Type">
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className={inputClasses}
                  >
                    {INCIDENT_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Severity">
                  <select
                    value={form.severity}
                    onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}
                    className={inputClasses}
                  >
                    <option value="critical">Critical</option>
                    <option value="serious">Serious</option>
                    <option value="minor">Minor</option>
                  </select>
                </FormField>
                {form.severity === 'critical' && (
                  <Alert
                    tone="danger"
                    className="sm:col-span-2"
                    title="Maryland OMHC & BHA Mandatory 24-Hour Reporting:"
                  >
                    Per COMAR 10.21.20 &amp; CARF Standard 1.H, critical incidents (suicide attempt, death, sentinel medical event, abuse) must be reported to the Maryland Behavioral Health Administration (BHA) and OMHC within 24 hours. A formal QI Root Cause Analysis must be initiated within 5 days.
                  </Alert>
                )}
                <FormField label="Client initials">
                  <input
                    value={form.clientInitials}
                    onChange={(e) => setForm({ ...form, clientInitials: e.target.value })}
                    placeholder="e.g. D.R. or N/A"
                    className={inputClasses}
                  />
                </FormField>
                <FormField label="Follow-up due">
                  <input
                    type="date"
                    value={form.dueFollowUp}
                    onChange={(e) => setForm({ ...form, dueFollowUp: e.target.value })}
                    className={inputClasses}
                  />
                </FormField>
                <FormField label="Occurred on">
                  <input
                    type="date"
                    value={form.occurredDate}
                    onChange={(e) => setForm({ ...form, occurredDate: e.target.value })}
                    className={inputClasses}
                  />
                </FormField>
                <FormField label="Occurred at (time)" hint="Needed to show 24-hour reporting timeliness.">
                  <input
                    type="time"
                    value={form.occurredTime}
                    onChange={(e) => setForm({ ...form, occurredTime: e.target.value })}
                    className={inputClasses}
                  />
                </FormField>
                <FormField label="Assign to">
                  <select
                    value={form.assignedTo}
                    onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
                    className={inputClasses}
                  >
                    <option value="">Unassigned</option>
                    {activeStaff.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name || u.email}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField
                  label="Staff involved"
                  className="sm:col-span-2"
                  hint="Staff named here can see this report. Hold Ctrl (Cmd on Mac) to select more than one."
                >
                  <select
                    multiple
                    value={form.involvedStaffIds}
                    onChange={(e) =>
                      setForm({ ...form, involvedStaffIds: Array.from(e.target.selectedOptions).map((o) => o.value) })
                    }
                    className={cx(inputClasses, 'h-24')}
                  >
                    {activeStaff.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name || u.email}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Location">
                  <input
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className={inputClasses}
                  />
                </FormField>
                <FormField label="CARF category">
                  <input
                    value={form.carfCategory}
                    onChange={(e) => setForm({ ...form, carfCategory: e.target.value })}
                    className={inputClasses}
                  />
                </FormField>
              </div>
              <FormField label="Description">
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={cx(inputClasses, 'resize-y')}
                  placeholder="What happened and who was involved…"
                />
              </FormField>
              <FormField label="Immediate action taken">
                <textarea
                  rows={2}
                  value={form.immediateAction}
                  onChange={(e) => setForm({ ...form, immediateAction: e.target.value })}
                  className={cx(inputClasses, 'resize-y')}
                  placeholder="Steps taken right after the event…"
                />
              </FormField>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3">
              <Button variant="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button icon={<Plus />} onClick={() => void submitIncident()} disabled={saving}>
                {saving ? 'Submitting…' : 'Submit report'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
