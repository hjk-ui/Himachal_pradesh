'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
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
import { useAuth } from '@/features/auth';
import {
  type Incident,
  type IncidentStatus,
  type Severity,
  INCIDENT_TYPES,
  CHART_CATEGORIES,
  QUARTER_LABEL,
  CHART_TITLE_PERIOD,
  avgResolutionDays,
  chartCategoryForType,
  formatIncidentDate,
  isOpenIncident,
  normalizeIncident,
} from '@/features/compliance/incidentsData';

type TabKey = 'open' | 'history';

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'bg-red-100 text-red-800',
  serious: 'bg-orange-100 text-orange-800',
  minor: 'bg-amber-50 text-amber-800',
};

const STATUS_STYLE: Record<IncidentStatus, string> = {
  reported: 'bg-indigo-50 text-indigo-700',
  investigating: 'bg-amber-50 text-amber-800',
  corrective_action: 'bg-orange-50 text-orange-800',
  closed: 'bg-emerald-50 text-emerald-700',
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  reported: 'Reported',
  investigating: 'Investigating',
  corrective_action: 'Corrective Action',
  closed: 'Closed',
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
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nextIncidentId(list: Incident[]): string {
  const nums = list
    .map((i) => {
      const m = i.id.match(/INC-(\d{4})-(\d+)/i);
      return m ? Number(m[2]) : 0;
    })
    .filter((n) => n > 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `INC-2026-${String(next).padStart(3, '0')}`;
}

export default function IncidentsPage() {
  const { user } = useAuth();
  const [rawIncidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('history');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/incidents', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setIncidents(Array.isArray(data.incidents) ? data.incidents : []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const incidents = useMemo(() => rawIncidents.map(normalizeIncident), [rawIncidents]);

  useEffect(() => {
    const front = incidents.find((inc) => /front desk|lobby/i.test(`${inc.reportedBy} ${inc.title} ${inc.type} ${inc.location} ${inc.description}`));
    if (!front) return;
    setTab(isOpenIncident(front) ? 'open' : 'history');
  }, [incidents]);

  const openCount = useMemo(() => incidents.filter(isOpenIncident).length, [incidents]);
  const historyCount = useMemo(() => incidents.filter((i) => !isOpenIncident(i)).length, [incidents]);

  const filtered = useMemo(() => {
    const list = incidents.filter((i) => (tab === 'open' ? isOpenIncident(i) : !isOpenIncident(i)));
    return [...list].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  }, [incidents, tab]);

  const stats = useMemo(() => {
    const today = todayIso();
    const overdue = incidents.filter((i) => isOpenIncident(i) && i.dueFollowUp < today).length;
    return {
      total: incidents.length,
      open: openCount,
      avgDays: avgResolutionDays(incidents),
      overdue,
    };
  }, [incidents, openCount]);

  const typeBars = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of CHART_CATEGORIES) counts[c.key] = 0;
    for (const i of incidents) {
      const key = i.chartCategory || chartCategoryForType(i.type);
      counts[key] = (counts[key] || 0) + 1;
    }
    const max = Math.max(1, ...Object.values(counts));
    return CHART_CATEGORIES.map((c) => ({
      ...c,
      count: counts[c.key] || 0,
      pct: ((counts[c.key] || 0) / max) * 100,
    })).filter((r) => r.count > 0 || incidents.length === 0);
  }, [incidents]);

  async function advanceStatus(id: string) {
    const order: IncidentStatus[] = ['reported', 'investigating', 'corrective_action', 'closed'];
    const current = rawIncidents.find((item) => item.id === id);
    if (!current) return;
    const idx = order.indexOf(current.status);
    const next = order[Math.min(idx + 1, order.length - 1)];
    const response = await fetch(`/api/incidents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    if (!response.ok) return;
    setIncidents((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        return {
          ...i,
          status: next,
          closedAt: next === 'closed' ? i.closedAt || todayIso() : i.closedAt,
        };
      })
    );
  }

  async function submitIncident() {
    if (!form.title.trim() || !form.description.trim()) return;
    const due =
      form.dueFollowUp ||
      (() => {
        const d = new Date();
        d.setDate(d.getDate() + 14);
        return d.toISOString().slice(0, 10);
      })();
    const response = await fetch('/api/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title.trim(),
        type: form.type,
        chartCategory: chartCategoryForType(form.type),
        severity: form.severity,
        status: 'reported',
        clientInitials: form.clientInitials.trim() || 'N/A',
        assignedTo: user?.name || 'Review',
        reportedAt: todayIso(),
        dueFollowUp: due,
        location: form.location.trim() || 'Clinic',
        description: form.description.trim(),
        immediateAction: form.immediateAction.trim() || 'Immediate actions pending documentation.',
        investigationNotes: '',
        correctiveActions: [],
        rootCause: '',
        timeliness: 'within_24h',
        carfCategory: form.carfCategory,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.incident) return;
    setIncidents((prev) => [data.incident, ...prev]);
    setExpanded(data.incident.id);
    setForm(emptyForm);
    setShowModal(false);
    setTab('open');
  }

  function handleCarfExport() {
    const report = {
      exportedAt: new Date().toISOString(),
      program: 'CARF Incident Summary',
      period: QUARTER_LABEL,
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

  if (loading && incidents.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Incident Reporting</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Client safety incidents, investigations, and corrective actions — required for accreditation
          </p>
        </div>
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
          Loading incidents…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Incident Reporting</h1>
          <p className="mt-1 text-sm text-slate-500">
            Client safety incidents, investigations, and corrective actions — required for accreditation
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCarfExport}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <Hexagon size={16} className="text-indigo-600" />
            CARF Export
          </button>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            <Plus size={16} />
            Report Incident
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-slate-500">Total This Quarter</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-sky-600">
              <ClipboardList size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{stats.total}</p>
          <p className="mt-1 text-xs text-slate-500">{QUARTER_LABEL}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-slate-500">Open Investigations</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-600">
              <AlertTriangle size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{stats.open}</p>
          <p className="mt-1 text-xs text-slate-500">Require follow-up</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-slate-500">Avg Resolution Time</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-50 text-teal-600">
              <Clock size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{stats.avgDays || '—'}</p>
          <p className="mt-1 text-xs text-slate-500">days (closed incidents)</p>
        </div>

        <div className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {stats.overdue > 0 && (
            <span className="absolute right-3 top-3 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
              Action needed
            </span>
          )}
          <div className="flex items-start justify-between pr-16">
            <p className="text-xs font-medium text-slate-500">Overdue Follow-ups</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-red-50 text-red-600">
              <TrendingDown size={18} />
            </span>
          </div>
          <p className={`mt-2 text-3xl font-bold ${stats.overdue > 0 ? 'text-red-600' : 'text-slate-900'}`}>
            {stats.overdue}
          </p>
          <p className="mt-1 text-xs text-slate-500">Past due date</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 size={16} className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-800">
            Incidents by Type — {CHART_TITLE_PERIOD}
          </h2>
        </div>
        <div className="space-y-3">
          {typeBars.map((row) => (
            <div key={row.key} className="grid grid-cols-[110px_1fr] items-center gap-3 sm:grid-cols-[130px_1fr]">
              <span className="truncate text-xs font-medium text-slate-600">{row.key}</span>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.max(row.pct, row.count ? 8 : 0)}%`, backgroundColor: row.color }}
                  title={`${row.count}`}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-400">
          {stats.total} incident{stats.total === 1 ? '' : 's'} reported {QUARTER_LABEL}
        </p>
      </div>

      <div className="flex w-fit gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            { key: 'open' as const, label: `Open Incidents (${openCount})` },
            { key: 'history' as const, label: `Incident History (${historyCount})` },
          ]
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Reporter</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Timeliness</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-500">
                    No incidents in this view.
                  </td>
                </tr>
              )}
              {filtered.map((inc) => {
                const open = expanded === inc.id;
                const overdue = isOpenIncident(inc) && inc.dueFollowUp < todayIso();
                return (
                  <Fragment key={inc.id}>
                    <tr
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50/70"
                      onClick={() => setExpanded(open ? null : inc.id)}
                    >
                      <td className="px-4 py-3.5 font-mono text-xs text-slate-500">{inc.id}</td>
                      <td className="px-4 py-3.5 text-slate-700">{formatIncidentDate(inc.reportedAt)}</td>
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center gap-1.5 text-slate-800">
                          <Users size={14} className="text-slate-400" />
                          {inc.clientInitials}
                        </span>
                      </td>
                      <td className="max-w-[160px] truncate px-4 py-3.5 font-medium text-slate-800">{inc.type}</td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_STYLE[inc.severity]}`}
                        >
                          {SEVERITY_LABEL[inc.severity]}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600">{inc.reportedBy}</td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[inc.status]}`}
                        >
                          {STATUS_LABEL[inc.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        {inc.timeliness === 'within_24h' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                            <CheckCircle2 size={14} />
                            Within 24h
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                            <AlertTriangle size={14} />
                            Late report
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-slate-400">
                        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-slate-100 bg-slate-50/40">
                        <td colSpan={9} className="px-4 py-5">
                          <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                            <span className="inline-flex items-center gap-1.5">
                              <MapPin size={14} className="text-slate-400" />
                              {inc.location}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1.5 ${overdue ? 'font-semibold text-red-600' : ''}`}
                            >
                              <CalendarDays size={14} className="text-slate-400" />
                              Due: {formatIncidentDate(inc.dueFollowUp)}
                              {overdue ? ' (overdue)' : ''}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <User size={14} className="text-slate-400" />
                              {inc.assignedTo}
                            </span>
                            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
                              {inc.carfCategory}
                            </span>
                          </div>

                          <div className="grid gap-5 lg:grid-cols-2">
                            <div className="space-y-4">
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                  Description
                                </p>
                                <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{inc.description}</p>
                              </div>
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                  Investigation Notes
                                </p>
                                <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                                  {inc.investigationNotes || 'Investigation not started.'}
                                </p>
                              </div>
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                  Root Cause
                                </p>
                                <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-800">
                                  {inc.rootCause || 'Pending investigation.'}
                                </p>
                              </div>
                            </div>
                            <div className="space-y-4">
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                  Immediate Action Taken
                                </p>
                                <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                                  {inc.immediateAction || 'Not documented.'}
                                </p>
                              </div>
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
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
                            {isOpenIncident(inc) && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  advanceStatus(inc.id);
                                }}
                                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                              >
                                Advance status →
                              </button>
                            )}
                            <Link
                              href={`/dashboard/qi?newCap=true&incidentId=${inc.id}&source=${encodeURIComponent(`Incident ${inc.id}: ${inc.title}`)}`}
                              className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 flex items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Shield size={14} /> Create QI Corrective Action Plan (CAP)
                            </Link>
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
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Report Incident</h2>
                <p className="mt-0.5 text-sm text-slate-500">Creates a new reported event for QI / CARF review</p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">Title</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="Brief summary of what occurred"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {INCIDENT_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Severity</label>
                  <select
                    value={form.severity}
                    onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="critical">Critical</option>
                    <option value="serious">Serious</option>
                    <option value="minor">Minor</option>
                  </select>
                </div>
                {form.severity === 'critical' && (
                  <div className="sm:col-span-2 rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs text-red-900">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 shrink-0 text-red-600" size={16} />
                      <div>
                        <strong className="font-bold text-red-950">Maryland OMHC &amp; BHA Mandatory 24-Hour Reporting:</strong>
                        <p className="mt-0.5 text-red-850">
                          Per COMAR 10.21.20 &amp; CARF Standard 1.H, critical incidents (suicide attempt, death, sentinel medical event, abuse) must be reported to the Maryland Behavioral Health Administration (BHA) and OMHC within 24 hours. A formal QI Root Cause Analysis must be initiated within 5 days.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Client initials</label>
                  <input
                    value={form.clientInitials}
                    onChange={(e) => setForm({ ...form, clientInitials: e.target.value })}
                    placeholder="e.g. D.R. or N/A"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Follow-up due</label>
                  <input
                    type="date"
                    value={form.dueFollowUp}
                    onChange={(e) => setForm({ ...form, dueFollowUp: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Location</label>
                  <input
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">CARF category</label>
                  <input
                    value={form.carfCategory}
                    onChange={(e) => setForm({ ...form, carfCategory: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="What happened and who was involved…"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">Immediate action taken</label>
                <textarea
                  rows={2}
                  value={form.immediateAction}
                  onChange={(e) => setForm({ ...form, immediateAction: e.target.value })}
                  className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="Steps taken right after the event…"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitIncident}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                <Plus size={16} />
                Submit report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
