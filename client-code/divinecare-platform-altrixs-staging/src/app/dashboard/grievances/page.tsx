'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
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
import { addBusinessDays, businessDaysBetween } from '@/lib/workflows/dates';
import { useAuth } from '@/features/auth';
import { isInQuarter, practiceDaysAgo, practiceQuarter, practiceYear } from '@/lib/compliance/metrics';
import { practiceToday } from '@/lib/time/practiceTime';
import { usePracticeIdentity } from '@/lib/practice/usePracticeIdentity';
import {
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
  cx,
  inputClasses,
  type Tone,
} from '@/components/ui';
import {
  type Grievance,
  type GrievanceCategory,
  type GrievancePriority,
  type GrievanceStatus,
  type GrievancesMeta,
  type TimelineEvent,
  CATEGORIES,
  GRIEVANCES_META_SEED,
  avgResolutionDays,
  daysToResolve,
  formatGrievanceDate,
  isOpenGrievance,
  isResolvedGrievance,
  normalizeGrievance,
} from '@/features/compliance/grievancesData';

export {
  GRIEVANCES_SEED,
  GRIEVANCES_META_SEED,
} from '@/features/compliance/grievancesData';

/** Category pill tone (design-system tones; categories are labels, not status). */
const CATEGORY_TONE: Record<GrievanceCategory, Tone> = {
  'Clinical Care': 'brand',
  Privacy: 'warning',
  Billing: 'neutral',
  'Staff Conduct': 'danger',
  Access: 'info',
  Rights: 'warning',
};

/** Category breakdown bar fill. */
const CATEGORY_BAR_CLASS: Record<GrievanceCategory, string> = {
  'Clinical Care': 'bg-blue-600',
  Privacy: 'bg-amber-400',
  Billing: 'bg-slate-400',
  'Staff Conduct': 'bg-rose-500',
  Access: 'bg-sky-500',
  Rights: 'bg-amber-600',
};

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
  assignedTo: '',
};

/** Today on the practice clock (America/New_York). */
function todayIso() {
  return practiceToday();
}

function nowStamp() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/New_York' }).slice(0, 16);
}

function nextId(list: Grievance[]): string {
  const year = practiceYear();
  const nums = list
    .map((g) => {
      const m = g.id.match(/GRV-(\d{4})-(\d+)/i);
      return m && Number(m[1]) === year ? Number(m[2]) : 0;
    })
    .filter((n) => n > 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `GRV-${year}-${String(next).padStart(3, '0')}`;
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
  const { user } = useAuth();
  const actorName = user?.displayName || 'Not recorded';
  const { identity } = usePracticeIdentity();
  const orgName = identity?.name || null;
  const accreditation = identity?.accreditationLabel || null;
  const quarter = useMemo(() => practiceQuarter(), []);
  const since90 = useMemo(() => practiceDaysAgo(90), []);

  const items = useMemo(() => rawItems.map(normalizeGrievance), [rawItems]);
  const meta = metaList[0]?.version === 1 ? metaList[0] : GRIEVANCES_META_SEED;
  const targetDays = meta.resolutionTargetDays || 10;
  const officerName = meta.officer.name || 'Client Rights Officer';
  const officerContact = [meta.officer.phone, meta.officer.email].filter(Boolean).join(' · ');

  const active = useMemo(() => items.filter(isOpenGrievance), [items]);
  const resolvedAll = useMemo(() => items.filter(isResolvedGrievance), [items]);
  // The Resolved tab covers the last 90 days (practice time), as its heading says.
  const resolved = useMemo(
    () => resolvedAll.filter((g) => (g.resolvedAt ?? '').slice(0, 10) >= since90),
    [resolvedAll, since90]
  );

  const filtered = useMemo(() => {
    const base = tab === 'active' ? active : resolved;
    const list =
      categoryFilter === 'all' ? base : base.filter((g) => g.category === categoryFilter);
    return [...list].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }, [tab, active, resolved, categoryFilter]);

  const stats = useMemo(() => {
    const avg = avgResolutionDays(items);
    const resolvedQuarter = resolvedAll.filter((g) => isInQuarter(g.resolvedAt, quarter)).length;
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
  }, [items, active, resolved, resolvedAll, quarter, targetDays]);

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
          at: nowStamp(),
          actor: actorName,
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
    const received = todayIso();
    const id = nextId(items);
    const next: Grievance = {
      id,
      subject: form.subject.trim(),
      category: form.category,
      status: 'submitted',
      clientInitials: form.clientInitials.trim(),
      submittedAt: received,
      receivedAt: received,
      // Receipt day is day zero; deadlines count business days only.
      acknowledgmentDueDate: addBusinessDays(received, 2),
      dueDate: addBusinessDays(received, targetDays),
      assignedTo: form.assignedTo.trim() || meta.officer.name || 'Unassigned',
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
          at: nowStamp(),
          actor: actorName,
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

  const header = (
    <PageHeader
      title="Grievances & Client Rights"
      description="Complaint intake, resolution tracking, and rights documentation"
      actions={
        <Button icon={<Plus />} onClick={() => setShowModal(true)}>
          Log New Grievance
        </Button>
      }
    />
  );

  if (loading && items.length === 0) {
    return (
      <Page>
        {header}
        <Card>
          <LoadingState label="Loading grievances…" />
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      {header}

      <StatGrid columns={4}>
        <StatCard
          label="Active Grievances"
          value={stats.active}
          hint="Currently open"
          icon={<FileText />}
          tone="neutral"
        />
        <StatCard
          label="Avg Resolution Time"
          value={
            <>
              {stats.avg || '—'}
              {stats.avg ? <span className="text-lg font-semibold text-slate-500"> days</span> : null}
            </>
          }
          hint={
            <span className={`font-medium ${stats.underTarget ? 'text-emerald-700' : 'text-amber-700'}`}>
              {stats.underTarget ? `Under ${targetDays}-day target` : `Target: ${targetDays} business days`}
            </span>
          }
          icon={<Clock />}
          tone="info"
        />
        <StatCard
          label="Resolved This Quarter"
          value={stats.resolvedQuarter}
          hint={quarter.label}
          icon={<CheckCircle2 />}
          tone="success"
        />
        <StatCard
          label="Rights Complaints"
          value={stats.rightsOpen}
          hint={<span className="font-medium text-amber-700">Requires rights officer review</span>}
          icon={<Flag />}
          tone="warning"
        />
      </StatGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              variant="pill"
              label="Grievance view"
              controlsPanels={false}
              value={tab}
              onChange={setTab}
              items={[
                { key: 'active', label: 'Active Grievances', count: stats.active, countTone: 'attention' },
                { key: 'resolved', label: 'Resolved', count: stats.closedCount },
              ]}
            />

            <div className="flex items-center gap-2">
              <Filter size={14} className="text-slate-500" aria-hidden />
              <select
                aria-label="Filter by category"
                value={categoryFilter}
                onChange={(e) =>
                  setCategoryFilter(e.target.value as 'all' | GrievanceCategory)
                }
                className={cx(inputClasses, 'w-auto font-medium text-slate-700')}
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
              {stats.allWithinTarget && <StatusBadge tone="success">All within target</StatusBadge>}
            </div>
          )}

          <Card className="overflow-hidden">
            <div className="clinic-scroll-x overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-4 py-3">ID / Date</th>
                    <th scope="col" className="px-4 py-3">Client</th>
                    <th scope="col" className="px-4 py-3">Category</th>
                    <th scope="col" className="px-4 py-3">
                      {tab === 'resolved' ? 'Days to Resolve' : 'Status'}
                    </th>
                    <th scope="col" className="px-4 py-3">Assigned To</th>
                    <th scope="col" className="px-4 py-3">
                      {tab === 'resolved' ? 'Resolution Summary' : 'Subject'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState
                          compact
                          title="No grievances in this view."
                          description={
                            tab === 'active'
                              ? 'Open grievances appear here once logged. Use Log New Grievance to record a complaint.'
                              : 'Grievances resolved in the last 90 days appear here.'
                          }
                        />
                      </td>
                    </tr>
                  )}
                  {filtered.map((g) => {
                    const days = daysToResolve(g);
                    const open = expandedId === g.id;
                    return (
                      <Fragment key={g.id}>
                        <tr
                          className="group cursor-pointer hover:bg-slate-50"
                          onClick={() => setExpandedId(open ? null : g.id)}
                        >
                          <td className="sticky left-0 z-10 bg-white px-4 py-3 align-top group-hover:bg-slate-50">
                            <p className="font-semibold text-slate-900">{g.id}</p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {formatGrievanceDate(g.submittedAt)}
                            </p>
                          </td>
                          <td className="px-4 py-3 align-top font-medium text-slate-800">
                            {g.clientInitials || '—'}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <StatusBadge tone={CATEGORY_TONE[g.category] ?? 'neutral'}>{g.category}</StatusBadge>
                          </td>
                          <td className="px-4 py-3 align-top">
                            {tab === 'resolved' ? (
                              <span
                                className={`text-sm font-semibold ${
                                  days != null && days <= targetDays
                                    ? 'text-emerald-700'
                                    : 'text-amber-700'
                                }`}
                              >
                                {days != null ? `${days}d` : '—'}
                              </span>
                            ) : (
                              <div>
                                <StatusBadge tone="warning">{STATUS_LABEL[g.status]}</StatusBadge>
                                {(() => {
                                  const remaining = businessDaysBetween(todayIso(), g.dueDate);
                                  const isOverdue = g.dueDate < todayIso() || remaining <= 0;
                                  const pct = isOverdue ? 100 : Math.min(100, Math.max(10, Math.round(((targetDays - remaining) / targetDays) * 100)));
                                  return (
                                    <div className="mt-1.5 space-y-1">
                                      {isOverdue ? (
                                        <StatusBadge tone="danger" size="sm" icon={<AlertTriangle />}>
                                          Overdue (&gt;{targetDays} business days)
                                        </StatusBadge>
                                      ) : (
                                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${remaining <= 3 ? 'text-amber-800' : 'text-slate-600'}`}>
                                          <Clock size={11} aria-hidden className={remaining <= 3 ? 'text-amber-600' : 'text-slate-500'} />
                                          {remaining} business day{remaining === 1 ? '' : 's'} remaining
                                        </span>
                                      )}
                                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
                                        <div
                                          className={`h-full rounded-full transition-all ${
                                            isOverdue ? 'bg-rose-600' : remaining <= 3 ? 'bg-amber-500' : 'bg-blue-600'
                                          }`}
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                      <p className="text-[11px] text-slate-500">Due {formatGrievanceDate(g.dueDate)}</p>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top text-slate-700">{g.assignedTo}</td>
                          <td className="max-w-[280px] px-4 py-3 align-top text-slate-700">
                            <p className="line-clamp-2">
                              {tab === 'resolved'
                                ? g.resolutionSummary || g.subject
                                : g.subject}
                            </p>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-slate-50">
                            <td colSpan={6} className="px-4 py-4">
                              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-slate-600">
                                    Description
                                  </p>
                                  <p className="mt-1 text-sm text-slate-700">{g.description}</p>
                                  {g.rightsCited.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                      {g.rightsCited.map((r) => (
                                        <StatusBadge key={r} tone="neutral" size="sm">
                                          {r}
                                        </StatusBadge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-slate-600">
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
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      icon={<FileText />}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setLetterGrievance(g);
                                      }}
                                    >
                                      2-Day Acknowledgment Letter
                                    </Button>
                                    {isOpenGrievance(g) && (
                                      <Button
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          advanceStatus(g.id);
                                        }}
                                      >
                                        Advance status
                                        <ArrowRight className="h-4 w-4" aria-hidden />
                                      </Button>
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
          </Card>
        </div>

        <aside className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Client Rights" icon={<Shield />} />
            <CardBody>
              <ul className="space-y-2.5 text-sm text-slate-700">
                {[
                  'Right to file without fear of retaliation',
                  'Acknowledged within 24 hours',
                  `Resolution required within ${targetDays} business days per CARF Section 1.I`,
                  'External review escalation options',
                ].map((line) => (
                  <li key={line} className="flex gap-2">
                    <CheckCircle2 size={16} aria-hidden className="mt-0.5 shrink-0 text-emerald-600" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Client Rights Officer" />
            <CardBody>
              {meta.officer.name ? (
                <>
                  <p className="text-base font-semibold text-slate-900">{meta.officer.name}</p>
                  {meta.officer.title && <p className="text-sm text-slate-500">{meta.officer.title}</p>}
                </>
              ) : (
                <p className="text-sm text-slate-500">
                  Set your Client Rights Office contact in settings.
                </p>
              )}
              {(meta.officer.phone || meta.officer.email) && (
                <div className="mt-3 space-y-1.5 text-sm text-slate-600">
                  {meta.officer.phone && (
                    <p className="inline-flex items-center gap-2">
                      <Phone size={14} aria-hidden className="text-slate-500" />
                      {meta.officer.phone}
                    </p>
                  )}
                  {meta.officer.email && (
                    <p className="flex items-center gap-2 break-all">
                      <Mail size={14} aria-hidden className="shrink-0 text-slate-500" />
                      {meta.officer.email}
                    </p>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Category Breakdown"
              description={`Last 12 months — ${items.length} total grievances`}
            />
            <CardBody>
              <div className="space-y-3">
                {categoryBreakdown.length === 0 && (
                  <p className="text-xs text-slate-500">No grievances recorded yet.</p>
                )}
                {categoryBreakdown.map((row) => (
                  <div key={row.category}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-medium text-slate-700">{row.category}</span>
                      <span className="font-semibold text-slate-500">{row.pct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cx('h-full rounded-full', CATEGORY_BAR_CLASS[row.category] ?? 'bg-slate-400')}
                        style={{ width: `${Math.max(row.pct, 4)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-slate-500">
                CARF 1.I requires annual trend analysis. Next review:{' '}
                <span className="font-semibold text-slate-600">
                  {meta.nextTrendReview ? formatGrievanceDate(meta.nextTrendReview) : '—'}
                </span>
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="grievance-new-title"
            className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl sm:rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <h2 id="grievance-new-title" className="text-base font-semibold text-slate-900">Log New Grievance</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Opens a CARF-tracked complaint for acknowledgment within 24 hours
                </p>
              </div>
              <IconButton label="Close" className="h-10 w-10 shrink-0 md:h-8 md:w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-700" icon={<X className="h-[18px] w-[18px]" />} onClick={() => setShowModal(false)} />
            </div>
            <div className="space-y-4 px-5 py-5">
              <FormField label="Subject">
                <input
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  className={inputClasses}
                  placeholder="Brief summary of the complaint"
                />
              </FormField>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Category">
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value as GrievanceCategory })
                    }
                    className={inputClasses}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Priority">
                  <select
                    value={form.priority}
                    onChange={(e) =>
                      setForm({ ...form, priority: e.target.value as GrievancePriority })
                    }
                    className={inputClasses}
                  >
                    <option value="critical">Critical</option>
                    <option value="standard">Standard</option>
                    <option value="low">Low</option>
                  </select>
                </FormField>
                <FormField label="Client">
                  <input
                    value={form.clientInitials}
                    onChange={(e) => setForm({ ...form, clientInitials: e.target.value })}
                    placeholder="e.g. Jane D."
                    className={inputClasses}
                  />
                </FormField>
                <FormField label="Assigned to">
                  <input
                    value={form.assignedTo}
                    onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
                    className={inputClasses}
                  />
                </FormField>
              </div>
              <FormField label="Description">
                <textarea
                  rows={4}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={cx(inputClasses, 'resize-y')}
                  placeholder="What happened, who was involved…"
                />
              </FormField>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3">
              <Button variant="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button icon={<Plus />} onClick={submitGrievance}>
                Submit grievance
              </Button>
            </div>
          </div>
        </div>
      )}

      {letterGrievance && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="grievance-letter-title"
            className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-t-2xl sm:rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="shrink-0 text-blue-600" size={20} aria-hidden />
                <h3 id="grievance-letter-title" className="text-base font-semibold text-slate-900">2-Business-Day Acknowledgment Letter</h3>
              </div>
              <IconButton label="Close" className="h-10 w-10 shrink-0 md:h-8 md:w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-700" icon={<X className="h-[18px] w-[18px]" />} onClick={() => setLetterGrievance(null)} />
            </div>

            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-5 font-serif text-sm text-slate-800">
              <div className="border-b border-slate-200 pb-3 text-center">
                <h4 className="font-sans text-base font-semibold tracking-wide text-slate-900">
                  {orgName ? orgName.toUpperCase() : 'PRACTICE NAME NOT SET (Practice settings › Profile)'}
                </h4>
                {accreditation && (
                  <p className="font-sans text-xs text-slate-500">{accreditation}-Accredited Outpatient Mental Health Clinic</p>
                )}
                <p className="mt-0.5 font-sans text-xs text-slate-500">Date: {todayIso()}</p>
              </div>
              <p>Dear Client{letterGrievance.clientInitials ? ` (${letterGrievance.clientInitials})` : ''},</p>
              <p className="leading-relaxed">
                Thank you for bringing your concerns to our attention. This letter serves as formal acknowledgment that {orgName || 'our practice'} received your grievance ({letterGrievance.id}) on <strong className="font-sans font-semibold">{formatGrievanceDate(letterGrievance.receivedAt || letterGrievance.submittedAt)}</strong> regarding: &ldquo;{letterGrievance.subject}&rdquo;.
              </p>
              <p className="leading-relaxed">
                In compliance with {accreditation === 'CARF' ? 'CARF Standard 1.I and ' : ''}Maryland OMHC regulations, your complaint has been assigned to <strong className="font-sans font-semibold">{officerName}</strong>{meta.officer.title ? ` (${meta.officer.title})` : ''} for independent investigation. A formal written determination will be issued within {targetDays} business days (target deadline: <strong className="font-sans font-semibold">{formatGrievanceDate(letterGrievance.dueDate)}</strong>).
              </p>
              <p className="text-xs italic leading-relaxed text-slate-600">
                {orgName || 'Our practice'} strictly prohibits any form of retaliation against clients who file grievances. Your care and services remain completely uncompromised.
              </p>
              <div className="pt-2 font-sans text-xs text-slate-700">
                <p className="font-semibold">{officerName}</p>
                {meta.officer.title && <p>{meta.officer.title}</p>}
                {officerContact && <p>{officerContact}</p>}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" icon={<Printer />} onClick={() => window.print()}>
                Print Letter
              </Button>
              {letterGrievance.status === 'submitted' && (
                <Button
                  size="sm"
                  onClick={() => {
                    advanceStatus(letterGrievance.id);
                    setLetterGrievance(null);
                  }}
                >
                  Mark Acknowledged &amp; Advance
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setLetterGrievance(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
