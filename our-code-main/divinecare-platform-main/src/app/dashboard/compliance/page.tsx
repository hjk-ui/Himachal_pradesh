'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  Building2,
  Calendar,
  CheckCircle2,
  CircleX,
  Clock,
  CreditCard,
  FileText,
  Lock,
  Plus,
  RefreshCw,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { useModuleList } from '@/lib/modules/useModuleList';
import {
  type Category,
  type ComplianceItem,
  type ComplianceMeta,
  type Frequency,
  type Priority,
  CATEGORIES,
  COMPLIANCE_META_SEED,
  daysUntil,
  effectiveStatus,
  formatDueDate,
  isOpenItem,
  monthKey,
  normalizeItem,
  todayIso,
} from '@/features/compliance/complianceCalendarData';

type TabKey = 'upcoming' | 'completed';

const PRIORITY_STYLE: Record<Priority, string> = {
  Critical: 'bg-red-600 text-white',
  High: 'bg-orange-500 text-white',
  Medium: 'bg-amber-100 text-amber-800',
  Low: 'bg-slate-100 text-slate-600',
};

const CATEGORY_UI: Record<
  Category,
  { text: string; bg: string; icon: typeof Lock }
> = {
  'HIPAA / Privacy': { text: 'text-red-700', bg: 'bg-red-50', icon: Lock },
  'Staff Credentials': { text: 'text-violet-700', bg: 'bg-violet-50', icon: User },
  CARF: { text: 'text-fuchsia-700', bg: 'bg-fuchsia-50', icon: Award },
  'Insurance/Payer': { text: 'text-emerald-700', bg: 'bg-emerald-50', icon: CreditCard },
  'State License': { text: 'text-blue-700', bg: 'bg-blue-50', icon: Building2 },
  'Quality Reporting': { text: 'text-teal-700', bg: 'bg-teal-50', icon: Sparkles },
  'Grant Reporting': { text: 'text-amber-700', bg: 'bg-amber-50', icon: FileText },
  'Federal Reporting': { text: 'text-orange-700', bg: 'bg-orange-50', icon: BarChart3 },
};

const emptyForm = {
  title: '',
  category: 'CARF' as Category,
  priority: 'High' as Priority,
  frequency: 'annually' as Frequency,
  dueDate: '',
  owner: '',
  description: '',
  contextNote: '',
};

function urgencyLabel(due: string, from = new Date()): { text: string; overdue: boolean } {
  const d = daysUntil(due, from);
  if (d < 0) return { text: `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue`, overdue: true };
  if (d === 0) return { text: 'Due today', overdue: false };
  return { text: `${d} day${d === 1 ? '' : 's'}`, overdue: false };
}

export default function ComplianceCalendarPage() {
  const [rawItems, setItems, { loading }] = useModuleList<ComplianceItem>('compliance-calendar', []);
  const [metaList] = useModuleList<ComplianceMeta>('compliance-meta', []);
  const [safetyPlans] = useModuleList<any>('ehr-safety-plans', []);
  const [trainingStaff] = useModuleList<any>('hr-training-staff', []);
  const [qiMeetings] = useModuleList<any>('qi-meetings', []);
  const [incidents] = useModuleList<any>('incidents', []);
  const [grievances] = useModuleList<any>('grievances', []);
  const [dischargeCases] = useModuleList<any>('ehr-discharge-cases', []);
  const [tab, setTab] = useState<TabKey>('upcoming');
  const [categoryFilter, setCategoryFilter] = useState<'all' | Category>('all');
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [completeNote, setCompleteNote] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const today = todayIso();
  const now = useMemo(() => new Date(`${today}T12:00:00`), [today]);

  const items = useMemo(() => rawItems.map(normalizeItem), [rawItems]);
  const meta: ComplianceMeta =
    metaList[0]?.version === 1 ? metaList[0] : COMPLIANCE_META_SEED;

  const openItems = useMemo(() => items.filter(isOpenItem), [items]);
  const completedItems = useMemo(
    () => items.filter((i) => i.status === 'completed'),
    [items]
  );

  const stats = useMemo(() => {
    const month = now.getMonth();
    const year = now.getFullYear();
    const dueThisMonth = openItems.filter((i) => {
      const d = new Date(`${i.dueDate}T12:00:00`);
      return d.getMonth() === month && d.getFullYear() === year;
    }).length;

    const end90 = new Date(now);
    end90.setDate(end90.getDate() + 90);
    const end90Iso = end90.toISOString().slice(0, 10);
    const due90 = openItems.filter((i) => i.dueDate >= today && i.dueDate <= end90Iso).length;
    const overdue = openItems.filter(
      (i) => i.status === 'overdue' || (i.priority === 'Critical' && daysUntil(i.dueDate, now) < 0)
    ).length;
    const openCarf = openItems.filter((i) => i.category === 'CARF').length;

    return {
      dueThisMonth,
      due90,
      overdue,
      completedYtd: meta.completedYtdTotal,
      openCarf,
      end90Label: formatDueDate(end90Iso),
      monthLabel: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    };
  }, [openItems, now, today, meta.completedYtdTotal]);

  const carfMetrics = useMemo(() => {
    // 1. Safety plans (20%)
    const validSafety = safetyPlans.length > 0
      ? Math.round((safetyPlans.filter((p: any) => !p.withoutPlan && !p.reviewDue).length / safetyPlans.length) * 100)
      : 85;

    // 2. Staff Training (20%)
    const allRequiredTrainings = trainingStaff.flatMap((s: any) =>
      (s.trainings || []).filter((t: any) => t.status !== 'not-required')
    );
    const validTraining = allRequiredTrainings.length > 0
      ? Math.round((allRequiredTrainings.filter((t: any) => t.status === 'complete').length / allRequiredTrainings.length) * 100)
      : 84;

    // 3. QI Meeting (15%)
    const hasQiMeeting = qiMeetings.length > 0;
    const qiScore = hasQiMeeting ? 100 : 0;

    // 4. No Overdue Critical Incidents (15%)
    const hasOverdueCritical = incidents.some(
      (i: any) =>
        (i.severity === 'critical' || i.severity === 'high') &&
        i.status === 'open' &&
        (Date.now() - new Date(i.createdAt || 0).getTime() > 48 * 3600 * 1000)
    );
    const incidentsScore = hasOverdueCritical ? 0 : 100;

    // 5. No Grievances > 10d (15%)
    const hasOverdueGrievance = grievances.some(
      (g: any) =>
        g.status === 'open' &&
        (Date.now() - new Date(g.filingDate || g.createdAt || 0).getTime() > 10 * 24 * 3600 * 1000)
    );
    const grievancesScore = hasOverdueGrievance ? 0 : 100;

    // 6. Discharge Follow-ups % (15%)
    const allMilestones = dischargeCases.flatMap((c: any) => c.milestones || []);
    const validDischarge = allMilestones.length > 0
      ? Math.round((allMilestones.filter((m: any) => m.completed).length / allMilestones.length) * 100)
      : 88;

    const overall = Math.round(
      (validSafety * 0.20) +
      (validTraining * 0.20) +
      (qiScore * 0.15) +
      (incidentsScore * 0.15) +
      (grievancesScore * 0.15) +
      (validDischarge * 0.15)
    );

    return {
      overall,
      factors: [
        { label: 'Safety Plans (20%)', score: validSafety, note: `${validSafety}% compliant` },
        { label: 'Staff Training (20%)', score: validTraining, note: `${validTraining}% completed` },
        { label: 'QI Meeting (15%)', score: qiScore, note: hasQiMeeting ? 'Conducted' : 'Missing' },
        { label: 'Critical Incidents (15%)', score: incidentsScore, note: hasOverdueCritical ? 'Overdue critical' : '0 overdue' },
        { label: 'Grievance <10d (15%)', score: grievancesScore, note: hasOverdueGrievance ? 'Overdue grievance' : '0 overdue' },
        { label: 'Discharge Follow-ups (15%)', score: validDischarge, note: `${validDischarge}% milestone rate` },
      ],
    };
  }, [safetyPlans, trainingStaff, qiMeetings, incidents, grievances, dischargeCases]);

  const filteredOpen = useMemo(() => {
    return openItems.filter((i) =>
      categoryFilter === 'all' ? true : i.category === categoryFilter
    );
  }, [openItems, categoryFilter]);

  const filteredCompleted = useMemo(() => {
    return completedItems
      .filter((i) => (categoryFilter === 'all' ? true : i.category === categoryFilter))
      .sort((a, b) => (b.completedAt || b.dueDate).localeCompare(a.completedAt || a.dueDate));
  }, [completedItems, categoryFilter]);

  /** Explicit overdue status OR critical past-due → OVERDUE section; rest by month */
  const overdueSection = useMemo(() => {
    return filteredOpen
      .filter(
        (i) =>
          i.status === 'overdue' ||
          (i.priority === 'Critical' && daysUntil(i.dueDate, now) < 0)
      )
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [filteredOpen, now]);

  const overdueIds = useMemo(() => new Set(overdueSection.map((i) => i.id)), [overdueSection]);

  const monthGroups = useMemo(() => {
    const rest = filteredOpen
      .filter((i) => !overdueIds.has(i.id))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const map = new Map<string, ComplianceItem[]>();
    for (const item of rest) {
      const key = monthKey(item.dueDate);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [filteredOpen, overdueIds]);

  function markComplete(id: string) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? {
              ...i,
              status: 'completed' as const,
              completedAt: todayIso(),
              completionNote: completeNote.trim() || i.completionNote,
            }
          : i
      )
    );
    setCompleteId(null);
    setCompleteNote('');
    setTab('completed');
  }

  function addItem() {
    if (!form.title.trim() || !form.dueDate) return;
    const past = form.dueDate < today;
    const next: ComplianceItem = {
      id: `cmp-${Date.now()}`,
      title: form.title.trim(),
      category: form.category,
      priority: form.priority,
      frequency: form.frequency,
      status: past && form.priority === 'Critical' ? 'overdue' : 'upcoming',
      dueDate: form.dueDate,
      owner: form.owner.trim() || 'Practice Director',
      description: form.description.trim(),
      contextNote: form.contextNote.trim() || undefined,
    };
    setItems((prev) => [next, ...prev]);
    setForm(emptyForm);
    setShowAdd(false);
    setTab('upcoming');
  }

  if (loading && items.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Compliance Calendar</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Regulatory deadlines, accreditation milestones, license renewals, and quality reporting
            requirements
          </p>
        </div>
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
          Loading compliance calendar…
        </p>
      </div>
    );
  }

  function ItemCard({ item, emphasizeOverdue }: { item: ComplianceItem; emphasizeOverdue?: boolean }) {
    const cat = CATEGORY_UI[item.category];
    const CatIcon = cat.icon;
    const open = completeId === item.id;
    const urg = urgencyLabel(item.dueDate, now);
    const isOver = emphasizeOverdue || effectiveStatus(item, now) === 'overdue';

    return (
      <div
        className={`rounded-2xl border bg-white p-5 shadow-sm ${
          isOver && emphasizeOverdue ? 'border-l-4 border-l-red-500 border-slate-200' : 'border-slate-200'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cat.bg} ${cat.text}`}
            >
              <CatIcon size={12} />
              {item.category}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PRIORITY_STYLE[item.priority]}`}>
              {item.priority}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              <RefreshCw size={11} />
              {item.frequency}
            </span>
            {isOver && emphasizeOverdue && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700 ring-1 ring-red-200">
                <AlertTriangle size={11} />
                OVERDUE
              </span>
            )}
          </div>

          {item.status !== 'completed' && (
            open ? (
              <button
                type="button"
                onClick={() => {
                  setCompleteId(null);
                  setCompleteNote('');
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                <CircleX size={14} />
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCompleteId(item.id);
                  setCompleteNote('');
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <CheckCircle2 size={14} className="text-emerald-600" />
                Mark Complete
              </button>
            )
          )}
        </div>

        <h3 className="mt-3 text-base font-bold text-slate-900">{item.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{item.description}</p>

        {item.contextNote && (
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
            {item.contextNote}
          </div>
        )}

        {item.status === 'completed' && item.completionNote && (
          <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2.5 text-sm text-emerald-800">
            {item.completionNote}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Calendar size={13} className="text-slate-400" />
            {formatDueDate(item.dueDate)}
          </span>
          {item.status !== 'completed' ? (
            <span
              className={`inline-flex items-center gap-1.5 font-semibold ${
                urg.overdue ? 'text-red-600' : 'text-slate-600'
              }`}
            >
              <Clock size={13} />
              {urg.text}
            </span>
          ) : (
            item.completedAt && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                <CheckCircle2 size={13} />
                Completed {formatDueDate(item.completedAt)}
              </span>
            )
          )}
          <span className="inline-flex items-center gap-1.5">
            <User size={13} className="text-slate-400" />
            {item.owner}
          </span>
        </div>

        {open && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            <div>
              <label className="text-xs font-semibold text-slate-500">Completion note (optional)</label>
              <textarea
                rows={2}
                value={completeNote}
                onChange={(e) => setCompleteNote(e.target.value)}
                placeholder="e.g. Submitted via BHSES portal. Confirmation #MD-2026-0814."
                className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => markComplete(item.id)}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                <CheckCircle2 size={16} />
                Confirm Complete
              </button>
              <button
                type="button"
                onClick={() => {
                  setCompleteId(null);
                  setCompleteNote('');
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Compliance Calendar</h1>
          <p className="mt-1 text-sm text-slate-500">
            Regulatory deadlines, accreditation milestones, license renewals, and quality reporting
            requirements
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          <Plus size={16} />
          Add Compliance Item
        </button>
      </div>

      {/* CARF readiness */}
      <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/80 to-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-100 text-violet-700">
              <Award size={22} />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900">CARF Accreditation Readiness</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Survey cycle ends March 2027 — {stats.openCarf} open CARF items
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-violet-700">{carfMetrics.overall}%</p>
            <p className="text-xs font-medium text-slate-500">Live CARF Readiness</p>
          </div>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-violet-100">
          <div
            className="h-full rounded-full bg-violet-600 transition-all"
            style={{ width: `${carfMetrics.overall}%` }}
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {carfMetrics.factors.map((d) => (
            <div key={d.label} className="rounded-xl border border-slate-100 bg-white/80 p-2.5">
              <div className="mb-1 flex justify-between text-xs">
                <span className="font-semibold text-slate-700">{d.label}</span>
                <span className={`font-bold ${d.score >= 80 ? 'text-emerald-700' : 'text-amber-700'}`}>{d.score}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${d.score >= 80 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${d.score}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-slate-500">{d.note}</p>
            </div>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Due This Month</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-sky-600">
              <Calendar size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{stats.dueThisMonth}</p>
          <p className="mt-1 text-xs text-slate-500">{stats.monthLabel}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Due Next 90 Days</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-600">
              <Clock size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{stats.due90}</p>
          <p className="mt-1 text-xs text-slate-500">Through {stats.end90Label}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Overdue</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-red-50 text-red-600">
              <AlertTriangle size={18} />
            </span>
          </div>
          <p className={`mt-2 text-3xl font-bold ${stats.overdue > 0 ? 'text-red-600' : 'text-slate-900'}`}>
            {stats.overdue}
          </p>
          <p className="mt-1 text-xs text-slate-500">Requires attention</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Completed YTD</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{stats.completedYtd}</p>
          <p className="mt-1 text-xs text-slate-500">Since Jan 1, 2026</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex w-fit gap-1 rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setTab('upcoming')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
            tab === 'upcoming' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
          }`}
        >
          Upcoming Deadlines
          <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
            {openItems.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab('completed')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
            tab === 'completed' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
          }`}
        >
          Completed
          <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
            {completedItems.length}
          </span>
        </button>
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCategoryFilter('all')}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
            categoryFilter === 'all'
              ? 'bg-slate-900 text-white'
              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          All Categories
        </button>
        {CATEGORIES.map((c) => {
          const ui = CATEGORY_UI[c];
          const Icon = ui.icon;
          const active = categoryFilter === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCategoryFilter(c)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                active
                  ? `${ui.bg} ${ui.text} ring-1 ring-current`
                  : `border border-slate-200 bg-white ${ui.text} hover:bg-slate-50`
              }`}
            >
              <Icon size={13} />
              {c}
            </button>
          );
        })}
      </div>

      {/* Lists */}
      {tab === 'upcoming' && (
        <div className="space-y-6">
          {overdueSection.length > 0 && (
            <section className="space-y-3">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-red-600">
                <AlertTriangle size={14} />
                Overdue
                <span className="font-medium normal-case text-red-500">
                  {overdueSection.length} item{overdueSection.length === 1 ? '' : 's'}
                </span>
              </h3>
              {overdueSection.map((item) => (
                <ItemCard key={item.id} item={item} emphasizeOverdue />
              ))}
            </section>
          )}

          {monthGroups.map(([label, group]) => (
            <section key={label} className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                {label}{' '}
                <span className="font-medium normal-case">
                  {group.length} item{group.length === 1 ? '' : 's'}
                </span>
              </h3>
              {group.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </section>
          ))}

          {overdueSection.length === 0 && monthGroups.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500">
              No upcoming deadlines for this filter.
            </div>
          )}
        </div>
      )}

      {tab === 'completed' && (
        <div className="space-y-3">
          {filteredCompleted.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500">
              No completed items for this filter.
            </div>
          )}
          {filteredCompleted.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Add Compliance Item</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Schedule a new regulatory, license, or reporting deadline
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
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
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="e.g. Annual policy attestation"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
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
                    onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {(['Critical', 'High', 'Medium', 'Low'] as Priority[]).map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Frequency</label>
                  <select
                    value={form.frequency}
                    onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {(['annually', 'quarterly', 'monthly', 'one-time', 'as-needed'] as Frequency[]).map(
                      (f) => (
                        <option key={f}>{f}</option>
                      )
                    )}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Due date</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-semibold uppercase text-slate-500">Owner</label>
                  <input
                    value={form.owner}
                    onChange={(e) => setForm({ ...form, owner: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="Assignee or department"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="mt-1 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">
                  Context note (optional)
                </label>
                <input
                  value={form.contextNote}
                  onChange={(e) => setForm({ ...form, contextNote: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="Extra requirements or prior completion notes"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                <Plus size={16} />
                Add item
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
