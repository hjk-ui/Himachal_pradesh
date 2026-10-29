'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  Flag,
  Mail,
  Phone,
  Plus,
  Printer,
  Shield,
  X,
} from 'lucide-react';
import { useModuleList } from '@/lib/modules/useModuleList';
import { businessDaysBetween } from '@/lib/workflows/dates';
import {
  type Grievance,
  type GrievanceCategory,
  type GrievancePriority,
  type GrievanceStatus,
  type GrievancesMeta,
  type TimelineEvent,
  CATEGORIES,
  CATEGORY_BAR,
  CATEGORY_STYLE,
  GRIEVANCES_META_SEED,
  avgResolutionDays,
  daysToResolve,
  formatGrievanceDate,
  isOpenGrievance,
  isResolvedGrievance,
  normalizeGrievance,
} from '@/features/compliance/grievancesData';

const STATUS_LABEL: Record<GrievanceStatus, string> = {
  submitted: 'Submitted',
  acknowledged: 'Acknowledged',
  investigating: 'Investigating',
  resolved: 'Resolved',
  appealed: 'Appealed',
  closed: 'Closed',
};

const PIPELINE: GrievanceStatus[] = [
  'submitted',
  'acknowledged',
  'investigating',
  'resolved',
  'closed',
];

const emptyForm = {
  subject: '',
  category: 'Clinical Care' as GrievanceCategory,
  clientInitials: '',
  priority: 'standard' as GrievancePriority,
  description: '',
  rightsCited: 'Right to file a grievance without retaliation',
  assignedTo: 'Dr. Patricia Moore',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nextId(list: Grievance[]): string {
  const nums = list
    .map((g) => {
      const m = g.id.match(/GRV-(\d{4})-(\d+)/i);
      return m ? Number(m[2]) : 0;
    })
    .filter((n) => n > 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `GRV-2026-${String(next).padStart(3, '0')}`;
}

function inQuarter(iso: string, year = 2026, q = 3): boolean {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (d.getFullYear() !== year) return false;
  const m = d.getMonth() + 1;
  if (q === 3) return m >= 7 && m <= 9;
  return true;
}

export default function GrievancesPage() {
  const [rawItems, setItems, { loading }] = useModuleList<Grievance>('grievances', []);
  const [metaList] = useModuleList<GrievancesMeta>('grievances-meta', []);
  const [tab, setTab] = useState<'active' | 'resolved'>('resolved');
  const [categoryFilter, setCategoryFilter] = useState<'all' | GrievanceCategory>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [letterGrievance, setLetterGrievance] = useState<Grievance | null>(null);
  const [form, setForm] = useState(emptyForm);

  const items = useMemo(() => rawItems.map(normalizeGrievance), [rawItems]);
  const meta = metaList[0]?.version === 1 ? metaList[0] : GRIEVANCES_META_SEED;
  const targetDays = meta.resolutionTargetDays || 10;

  const active = useMemo(() => items.filter(isOpenGrievance), [items]);
  const resolved = useMemo(() => items.filter(isResolvedGrievance), [items]);

  const filtered = useMemo(() => {
    const base = tab === 'active' ? active : resolved;
    const list =
      categoryFilter === 'all' ? base : base.filter((g) => g.category === categoryFilter);
    return [...list].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }, [tab, active, resolved, categoryFilter]);

  const stats = useMemo(() => {
    const avg = avgResolutionDays(items);
    const resolvedQuarter = resolved.filter(
      (g) => g.resolvedAt && inQuarter(g.resolvedAt)
    ).length;
    const rightsOpen = active.filter((g) => g.category === 'Rights').length;
    const last90Resolved = resolved.filter((g) => daysToResolve(g) != null);
    const allWithinTarget =
      last90Resolved.length > 0 &&
      last90Resolved.every((g) => (daysToResolve(g) ?? 99) <= targetDays);
    return {
      active: active.length,
      avg,
      underTarget: avg > 0 && avg < targetDays,
      resolvedQuarter,
      rightsOpen,
      closedCount: resolved.length,
      allWithinTarget,
    };
  }, [items, active, resolved, targetDays]);

  const categoryBreakdown = useMemo(() => {
    const total = items.length || 1;
    const counts: Record<string, number> = {};
    for (const c of CATEGORIES) counts[c] = 0;
    for (const g of items) counts[g.category] = (counts[g.category] || 0) + 1;
    return CATEGORIES.map((c) => ({
      category: c,
      count: counts[c] || 0,
      pct: Math.round(((counts[c] || 0) / total) * 100),
    }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.pct - a.pct);
  }, [items]);

  function advanceStatus(id: string) {
    setItems((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const idx = PIPELINE.indexOf(g.status);
        if (idx < 0 || idx >= PIPELINE.length - 1) return g;
        const nextStatus = PIPELINE[idx + 1];
        const event: TimelineEvent = {
          id: `t-${Date.now()}`,
          at: `${todayIso()} ${new Date().toTimeString().slice(0, 5)}`,
          actor: meta.officer.name,
          note: `Status advanced to ${STATUS_LABEL[nextStatus]}.`,
          status: nextStatus,
        };
        const resolvedAt =
          nextStatus === 'resolved' || nextStatus === 'closed' ? todayIso() : g.resolvedAt;
        const resolutionSummary =
          nextStatus === 'resolved' || nextStatus === 'closed'
            ? g.resolutionSummary || event.note
            : g.resolutionSummary;
        return {
          ...g,
          status: nextStatus,
          resolvedAt,
          resolutionSummary,
          timeline: [...g.timeline, event],
        };
      })
    );
  }

  function submitGrievance() {
    if (!form.subject.trim() || !form.description.trim()) return;
    const due = new Date();
    due.setDate(due.getDate() + targetDays);
    const id = nextId(items);
    const next: Grievance = {
      id,
      subject: form.subject.trim(),
      category: form.category,
      status: 'submitted',
      clientInitials: form.clientInitials.trim() || 'N/A',
      submittedAt: todayIso(),
      dueDate: due.toISOString().slice(0, 10),
      assignedTo: form.assignedTo.trim() || meta.officer.name,
      priority: form.priority,
      description: form.description.trim(),
      resolutionSummary: '',
      rightsCited: form.rightsCited
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      attachments: [],
      timeline: [
        {
          id: 't1',
          at: `${todayIso()} ${new Date().toTimeString().slice(0, 5)}`,
          actor: 'System',
          note: 'Grievance logged by staff',
          status: 'submitted',
        },
      ],
    };
    setItems((prev) => [next, ...prev]);
    setForm(emptyForm);
    setShowModal(false);
    setTab('active');
    setExpandedId(id);
  }

  if (loading && items.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Grievances & Client Rights</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Complaint intake, resolution tracking, and rights documentation
          </p>
        </div>
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
          Loading grievances…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Grievances & Client Rights
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Complaint intake, resolution tracking, and rights documentation
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          <Plus size={16} />
          Log New Grievance
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Active Grievances
            </p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600">
              <FileText size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{stats.active}</p>
          <p className="mt-1 text-xs text-slate-500">Currently open</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Avg Resolution Time
            </p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-sky-600">
              <Clock size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">
            {stats.avg || '—'}
            {stats.avg ? <span className="text-lg font-semibold text-slate-500"> days</span> : null}
          </p>
          <p className={`mt-1 text-xs font-medium ${stats.underTarget ? 'text-emerald-600' : 'text-amber-700'}`}>
            {stats.underTarget ? `Under ${targetDays}-day target` : `Target: ${targetDays} business days`}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Resolved This Quarter
            </p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{stats.resolvedQuarter}</p>
          <p className="mt-1 text-xs text-slate-500">Q3 2026</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Rights Complaints
            </p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-600">
              <Flag size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{stats.rightsOpen}</p>
          <p className="mt-1 text-xs font-medium text-amber-700">Requires rights officer review</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex w-fit gap-1 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setTab('active')}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                  tab === 'active' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                Active Grievances
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                    tab === 'active' ? 'bg-indigo-100 text-indigo-700' : 'bg-indigo-500 text-white'
                  }`}
                >
                  {stats.active}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTab('resolved')}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                  tab === 'resolved' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                Resolved
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                    tab === 'resolved' ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-500 text-white'
                  }`}
                >
                  {stats.closedCount}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Filter size={14} className="text-slate-400" />
              <select
                value={categoryFilter}
                onChange={(e) =>
                  setCategoryFilter(e.target.value as 'all' | GrievanceCategory)
                }
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="all">All Categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {tab === 'resolved' && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-500">
                Last 90 days — {stats.closedCount} grievances closed
              </p>
              {stats.allWithinTarget && (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                  All within target
                </span>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3">ID / Date</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">
                      {tab === 'resolved' ? 'Days to Resolve' : 'Status'}
                    </th>
                    <th className="px-4 py-3">Assigned To</th>
                    <th className="px-4 py-3">
                      {tab === 'resolved' ? 'Resolution Summary' : 'Subject'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">
                        No grievances in this view.
                      </td>
                    </tr>
                  )}
                  {filtered.map((g) => {
                    const days = daysToResolve(g);
                    const open = expandedId === g.id;
                    return (
                      <Fragment key={g.id}>
                        <tr
                          className="cursor-pointer border-b border-slate-100 hover:bg-slate-50/70"
                          onClick={() => setExpandedId(open ? null : g.id)}
                        >
                          <td className="px-4 py-3.5 align-top">
                            <p className="font-semibold text-slate-900">{g.id}</p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {formatGrievanceDate(g.submittedAt)}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 align-top font-medium text-slate-800">
                            {g.clientInitials}
                          </td>
                          <td className="px-4 py-3.5 align-top">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${CATEGORY_STYLE[g.category]}`}
                            >
                              {g.category}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 align-top">
                            {tab === 'resolved' ? (
                              <span
                                className={`text-sm font-semibold ${
                                  days != null && days <= targetDays
                                    ? 'text-emerald-600'
                                    : 'text-amber-700'
                                }`}
                              >
                                {days != null ? `${days}d` : '—'}
                              </span>
                            ) : (
                              <div>
                                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                                  {STATUS_LABEL[g.status]}
                                </span>
                                {(() => {
                                  const remaining = businessDaysBetween(todayIso(), g.dueDate);
                                  const isOverdue = g.dueDate < todayIso() || remaining <= 0;
                                  const pct = isOverdue ? 100 : Math.min(100, Math.max(10, Math.round(((10 - remaining) / 10) * 100)));
                                  return (
                                    <div className="mt-1.5 space-y-1">
                                      {isOverdue ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700 animate-pulse border border-red-300">
                                          <AlertTriangle size={11} /> OVERDUE (&gt;10d)
                                        </span>
                                      ) : (
                                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${remaining <= 3 ? 'text-amber-800 font-bold' : 'text-slate-600'}`}>
                                          <Clock size={11} className={remaining <= 3 ? 'text-amber-600' : 'text-slate-400'} />
                                          {remaining} business day{remaining === 1 ? '' : 's'} remaining
                                        </span>
                                      )}
                                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
                                        <div
                                          className={`h-full rounded-full transition-all ${
                                            isOverdue ? 'bg-red-600' : remaining <= 3 ? 'bg-amber-500' : 'bg-indigo-600'
                                          }`}
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                      <p className="text-[10px] text-slate-400">Due {formatGrievanceDate(g.dueDate)}</p>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3.5 align-top text-slate-600">{g.assignedTo}</td>
                          <td className="max-w-[280px] px-4 py-3.5 align-top text-slate-600">
                            <p className="line-clamp-2">
                              {tab === 'resolved'
                                ? g.resolutionSummary || g.subject
                                : g.subject}
                            </p>
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-b border-slate-100 bg-slate-50/50">
                            <td colSpan={6} className="px-4 py-4">
                              <div className="grid gap-4 lg:grid-cols-2">
                                <div>
                                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                    Description
                                  </p>
                                  <p className="mt-1 text-sm text-slate-700">{g.description}</p>
                                  {g.rightsCited.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                      {g.rightsCited.map((r) => (
                                        <span
                                          key={r}
                                          className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200"
                                        >
                                          {r}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                    Timeline
                                  </p>
                                  <ul className="mt-2 space-y-2">
                                    {g.timeline.map((t) => (
                                      <li key={t.id} className="text-sm text-slate-700">
                                        <span className="font-semibold text-slate-900">{t.at}</span>
                                        {' · '}
                                        {t.actor}: {t.note}
                                      </li>
                                    ))}
                                  </ul>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setLetterGrievance(g);
                                      }}
                                      className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 flex items-center gap-1.5"
                                    >
                                      <FileText size={13} /> 2-Day Acknowledgment Letter
                                    </button>
                                    {isOpenGrievance(g) && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          advanceStatus(g.id);
                                        }}
                                        className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                                      >
                                        Advance status →
                                      </button>
                                    )}
                                  </div>
                                </div>
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
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Shield size={18} className="text-indigo-600" />
              <h2 className="text-sm font-semibold text-slate-900">Client Rights</h2>
            </div>
            <ul className="space-y-2.5 text-sm text-slate-700">
              {[
                'Right to file without fear of retaliation',
                'Acknowledged within 24 hours',
                `Resolution required within ${targetDays} business days per CARF Section 1.I`,
                'External review escalation options',
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Client Rights Officer
            </p>
            <p className="mt-2 text-base font-bold text-slate-900">{meta.officer.name}</p>
            <p className="text-sm text-slate-500">{meta.officer.title}</p>
            <div className="mt-3 space-y-1.5 text-sm text-slate-600">
              <p className="inline-flex items-center gap-2">
                <Phone size={14} className="text-slate-400" />
                {meta.officer.phone}
              </p>
              <p className="flex items-center gap-2 break-all">
                <Mail size={14} className="shrink-0 text-slate-400" />
                {meta.officer.email}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Category Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Last 12 months — {items.length} total grievances
            </p>
            <div className="mt-4 space-y-3">
              {categoryBreakdown.map((row) => (
                <div key={row.category}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium text-slate-700">{row.category}</span>
                    <span className="font-semibold text-slate-500">{row.pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(row.pct, 4)}%`,
                        backgroundColor: CATEGORY_BAR[row.category],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-400">
              CARF 1.I requires annual trend analysis. Next review:{' '}
              <span className="font-semibold text-slate-600">
                {formatGrievanceDate(meta.nextTrendReview)}
              </span>
            </p>
          </div>
        </aside>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Log New Grievance</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Opens a CARF-tracked complaint for acknowledgment within 24 hours
                </p>
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
                <label className="text-xs font-semibold uppercase text-slate-500">Subject</label>
                <input
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="Brief summary of the complaint"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value as GrievanceCategory })
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Priority</label>
                  <select
                    value={form.priority}
                    onChange={(e) =>
                      setForm({ ...form, priority: e.target.value as GrievancePriority })
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="critical">Critical</option>
                    <option value="standard">Standard</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Client</label>
                  <input
                    value={form.clientInitials}
                    onChange={(e) => setForm({ ...form, clientInitials: e.target.value })}
                    placeholder="e.g. Marcus T."
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Assigned to</label>
                  <input
                    value={form.assignedTo}
                    onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">Description</label>
                <textarea
                  rows={4}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="mt-1 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="What happened, who was involved…"
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
                onClick={submitGrievance}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                <Plus size={16} />
                Submit grievance
              </button>
            </div>
          </div>
        </div>
      )}

      {letterGrievance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="text-indigo-600" size={20} />
                <h3 className="text-base font-bold text-slate-900">CARF 2-Day Acknowledgment Letter</h3>
              </div>
              <button
                type="button"
                onClick={() => setLetterGrievance(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-6 text-sm text-slate-800 space-y-3 font-serif">
              <div className="border-b border-slate-200 pb-3 text-center">
                <h4 className="font-bold text-base text-slate-900 font-sans tracking-wide">DIVINE COUNSELING LLC</h4>
                <p className="text-xs text-slate-500 font-sans">CARF-Accredited Outpatient Mental Health Clinic</p>
                <p className="text-xs text-slate-400 font-sans mt-0.5">Date: {todayIso()}</p>
              </div>
              <p>Dear Client ({letterGrievance.clientInitials}),</p>
              <p className="leading-relaxed">
                Thank you for bringing your concerns to our attention. This letter serves as formal acknowledgment that Divine Counseling LLC received your grievance ({letterGrievance.id}) on <strong className="font-sans font-semibold">{formatGrievanceDate(letterGrievance.receivedAt || letterGrievance.submittedAt)}</strong> regarding: &ldquo;{letterGrievance.subject}&rdquo;.
              </p>
              <p className="leading-relaxed">
                In compliance with CARF Standard 1.I and Maryland OMHC regulations, your complaint has been assigned to <strong className="font-sans font-semibold">{meta.officer.name}</strong> ({meta.officer.title}) for independent investigation. A formal written determination will be issued within 10 business days (target deadline: <strong className="font-sans font-semibold">{formatGrievanceDate(letterGrievance.dueDate)}</strong>).
              </p>
              <p className="leading-relaxed text-xs text-slate-600 italic">
                Divine Counseling LLC strictly prohibits any form of retaliation against clients who file grievances. Your care and services remain completely uncompromised.
              </p>
              <div className="pt-2 text-xs font-sans text-slate-700">
                <p className="font-bold">{meta.officer.name}</p>
                <p>{meta.officer.title}</p>
                <p>{meta.officer.phone} · {meta.officer.email}</p>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                <Printer size={14} /> Print Letter
              </button>
              {letterGrievance.status === 'submitted' && (
                <button
                  type="button"
                  onClick={() => {
                    advanceStatus(letterGrievance.id);
                    setLetterGrievance(null);
                  }}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow-sm"
                >
                  Mark Acknowledged &amp; Advance
                </button>
              )}
              <button
                type="button"
                onClick={() => setLetterGrievance(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
