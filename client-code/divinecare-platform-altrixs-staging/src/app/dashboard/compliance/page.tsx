'use client';

import { useEffect, useMemo, useState } from 'react';
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
  Alert,
  Button,
  Card,
  EmptyState,
  FOCUS_RING,
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
import { apiJson } from '@/lib/api-client';
import { EMPTY_CARF_SCORECARD, type CarfScorecard } from '@/lib/compliance/carfScorecard';
import { completedInYear, isOverdueCalendarItem, practiceYear } from '@/lib/compliance/metrics';
import { practiceToday } from '@/lib/time/practiceTime';
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

export {
  COMPLIANCE_CALENDAR_SEED,
  COMPLIANCE_META_SEED,
} from '@/features/compliance/complianceCalendarData';

type TabKey = 'upcoming' | 'completed';

const PRIORITY_TONE: Record<Priority, Tone> = {
  Critical: 'danger',
  High: 'warning',
  Medium: 'info',
  Low: 'neutral',
};

// Categories are labels, not statuses: one neutral pill style, told apart by icon and text.
const CATEGORY_UI: Record<Category, { icon: typeof Lock }> = {
  'HIPAA / Privacy': { icon: Lock },
  'Staff Credentials': { icon: User },
  CARF: { icon: Award },
  'Insurance/Payer': { icon: CreditCard },
  'State License': { icon: Building2 },
  'Quality Reporting': { icon: Sparkles },
  'Grant Reporting': { icon: FileText },
  'Federal Reporting': { icon: BarChart3 },
};

const LABEL = 'mb-1.5 block text-sm font-medium text-slate-700';

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
  // CARF scorecard percentages come from the server: the page never reads safety plans, discharge
  // cases, incidents or grievances directly (HR / Office Manager may not read those records).
  const [carfMetrics, setCarfMetrics] = useState<CarfScorecard>(EMPTY_CARF_SCORECARD);
  const [carfError, setCarfError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiJson<{ success: true; scorecard: CarfScorecard }>('/api/compliance/scorecard')
      .then((res) => {
        if (!cancelled && res.scorecard) setCarfMetrics(res.scorecard);
      })
      .catch((err: unknown) => {
        // Scorecard shows "No data" (never a made-up score); the calendar below still works.
        if (!cancelled) setCarfError(err instanceof Error ? err.message : 'Could not load the scorecard');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [tab, setTab] = useState<TabKey>('upcoming');
  const [categoryFilter, setCategoryFilter] = useState<'all' | Category>('all');
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [completeNote, setCompleteNote] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const today = practiceToday();
  const now = useMemo(() => new Date(`${today}T12:00:00`), [today]);
  const year = practiceYear();

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
    // Overdue = any open item past its due date (not only Critical ones).
    const overdue = openItems.filter((i) => isOverdueCalendarItem(i, today)).length;
    const openCarf = openItems.filter((i) => i.category === 'CARF').length;

    return {
      dueThisMonth,
      due90,
      overdue,
      // Count of items actually completed this calendar year (practice time), not a stored total.
      completedYtd: completedInYear(items, year),
      openCarf,
      end90Label: formatDueDate(end90Iso),
      monthLabel: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    };
  }, [openItems, items, now, today, year]);


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
      .filter((i) => isOverdueCalendarItem(i, today))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [filteredOpen, today]);

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
              completedAt: practiceToday(),
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

  const header = (
    <PageHeader
      title="Compliance Calendar"
      description="Regulatory deadlines, accreditation milestones, license renewals, and quality reporting requirements"
      actions={
        <Button icon={<Plus />} onClick={() => setShowAdd(true)}>
          Add Compliance Item
        </Button>
      }
    />
  );

  if (loading && items.length === 0) {
    return (
      <Page>
        <PageHeader
          title="Compliance Calendar"
          description="Regulatory deadlines, accreditation milestones, license renewals, and quality reporting requirements"
        />
        <Card>
          <LoadingState label="Loading compliance calendar…" />
        </Card>
      </Page>
    );
  }

  function ItemCard({ item, emphasizeOverdue }: { item: ComplianceItem; emphasizeOverdue?: boolean }) {
    const cat = CATEGORY_UI[item.category];
    const CatIcon = cat.icon;
    const open = completeId === item.id;
    const urg = urgencyLabel(item.dueDate, now);
    const isOver = emphasizeOverdue || effectiveStatus(item, now) === 'overdue';

    return (
      <Card className={cx('p-5', isOver && emphasizeOverdue && 'border-l-4 border-l-rose-500')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <StatusBadge tone="neutral" icon={<CatIcon />}>
              {item.category}
            </StatusBadge>
            <StatusBadge tone={PRIORITY_TONE[item.priority]}>{item.priority}</StatusBadge>
            <StatusBadge tone="neutral" icon={<RefreshCw />}>
              {item.frequency}
            </StatusBadge>
            {isOver && emphasizeOverdue && (
              <StatusBadge tone="danger" icon={<AlertTriangle />}>
                Overdue
              </StatusBadge>
            )}
          </div>

          {item.status !== 'completed' && (
            open ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<CircleX />}
                onClick={() => {
                  setCompleteId(null);
                  setCompleteNote('');
                }}
              >
                Cancel
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                icon={<CheckCircle2 className="text-emerald-600" />}
                onClick={() => {
                  setCompleteId(item.id);
                  setCompleteNote('');
                }}
              >
                Mark Complete
              </Button>
            )
          )}
        </div>

        <h3 className="mt-3 text-base font-semibold text-slate-900">{item.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{item.description}</p>

        {item.contextNote && (
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
            {item.contextNote}
          </div>
        )}

        {item.status === 'completed' && item.completionNote && (
          <Alert tone="success" icon={false} className="mt-3">
            {item.completionNote}
          </Alert>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Calendar size={13} className="text-slate-400" aria-hidden />
            {formatDueDate(item.dueDate)}
          </span>
          {item.status !== 'completed' ? (
            <span
              className={`inline-flex items-center gap-1.5 font-semibold ${
                urg.overdue ? 'text-rose-700' : 'text-slate-600'
              }`}
            >
              <Clock size={13} aria-hidden />
              {urg.text}
            </span>
          ) : (
            item.completedAt && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                <CheckCircle2 size={13} aria-hidden />
                Completed {formatDueDate(item.completedAt)}
              </span>
            )
          )}
          <span className="inline-flex items-center gap-1.5">
            <User size={13} className="text-slate-400" aria-hidden />
            {item.owner}
          </span>
        </div>

        {open && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            <div>
              <label htmlFor={`complete-note-${item.id}`} className={LABEL}>
                Completion note (optional)
              </label>
              <textarea
                id={`complete-note-${item.id}`}
                rows={2}
                value={completeNote}
                onChange={(e) => setCompleteNote(e.target.value)}
                placeholder="e.g. Submitted via BHSES portal. Confirmation #MD-2026-0814."
                className={cx(inputClasses, 'resize-y')}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button icon={<CheckCircle2 />} onClick={() => markComplete(item.id)}>
                Confirm Complete
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setCompleteId(null);
                  setCompleteNote('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Page>
      {header}

      {/* CARF readiness */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200">
              <Award size={20} />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">CARF Accreditation Readiness</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {stats.openCarf} open CARF item{stats.openCarf === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="stat-number text-2xl font-semibold text-slate-900">
              {carfMetrics.overall === null ? 'No data' : `${carfMetrics.overall}%`}
            </p>
            <p className="text-xs font-medium text-slate-500">
              {carfError
                ? 'Scorecard could not load'
                : carfMetrics.overall === null
                  ? 'No source records yet'
                  : `Based on ${carfMetrics.factorsWithData} of ${carfMetrics.factors.length} factors with data`}
            </p>
          </div>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-600 transition-all"
            style={{ width: `${carfMetrics.overall ?? 0}%` }}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {carfMetrics.factors.map((d) => (
            <div key={d.label} className="rounded-lg bg-slate-50 p-3">
              <div className="mb-1 flex justify-between gap-2 text-xs">
                <span className="min-w-0 font-semibold text-slate-700">{d.label}</span>
                <span className={`font-semibold ${d.score === null ? 'text-slate-500' : d.score >= 80 ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {d.score === null ? 'No data' : `${d.score}%`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${d.score !== null && d.score >= 80 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${d.score ?? 0}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{d.note}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* KPIs */}
      <StatGrid columns={4}>
        <StatCard label="Due This Month" value={stats.dueThisMonth} hint={stats.monthLabel} icon={<Calendar />} tone="info" />
        <StatCard label="Due Next 90 Days" value={stats.due90} hint={`Through ${stats.end90Label}`} icon={<Clock />} tone="warning" />
        <StatCard
          label="Overdue"
          value={<span className={stats.overdue > 0 ? 'text-rose-700' : undefined}>{stats.overdue}</span>}
          hint="Requires attention"
          icon={<AlertTriangle />}
          tone="danger"
        />
        <StatCard label="Completed YTD" value={stats.completedYtd} hint={`Since Jan 1, ${year}`} icon={<CheckCircle2 />} tone="success" />
      </StatGrid>

      {/* Tabs */}
      <Tabs<TabKey>
        variant="pill"
        label="Compliance items"
        controlsPanels={false}
        value={tab}
        onChange={setTab}
        items={[
          { key: 'upcoming', label: 'Upcoming Deadlines', count: openItems.length, countTone: stats.overdue > 0 ? 'attention' : 'neutral' },
          { key: 'completed', label: 'Completed', count: completedItems.length },
        ]}
      />

      {/* Category filters */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        <button
          type="button"
          aria-pressed={categoryFilter === 'all'}
          onClick={() => setCategoryFilter('all')}
          className={cx(
            'rounded-full px-3.5 py-1.5 text-xs font-semibold transition',
            FOCUS_RING,
            categoryFilter === 'all'
              ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          )}
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
              aria-pressed={active}
              onClick={() => setCategoryFilter(c)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition',
                FOCUS_RING,
                active
                  ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              )}
            >
              <Icon size={13} aria-hidden />
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
              <h2 className="flex items-center gap-2 text-sm font-semibold text-rose-700">
                <AlertTriangle size={14} aria-hidden />
                Overdue
                <span className="font-medium text-slate-500">
                  {overdueSection.length} item{overdueSection.length === 1 ? '' : 's'}
                </span>
              </h2>
              {overdueSection.map((item) => (
                <ItemCard key={item.id} item={item} emphasizeOverdue />
              ))}
            </section>
          )}

          {monthGroups.map(([label, group]) => (
            <section key={label} className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">
                {label}{' '}
                <span className="font-medium text-slate-500">
                  {group.length} item{group.length === 1 ? '' : 's'}
                </span>
              </h2>
              {group.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </section>
          ))}

          {overdueSection.length === 0 && monthGroups.length === 0 && (
            <Card>
              <EmptyState
                icon={<Calendar />}
                title="No upcoming deadlines for this filter."
                description="Open deadlines appear here grouped by month. Choose another category or add a compliance item."
              />
            </Card>
          )}
        </div>
      )}

      {tab === 'completed' && (
        <div className="space-y-3">
          {filteredCompleted.length === 0 && (
            <Card>
              <EmptyState
                icon={<CheckCircle2 />}
                title="No completed items for this filter."
                description="Items you mark complete appear here, newest first."
              />
            </Card>
          )}
          {filteredCompleted.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-compliance-title"
            className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <h2 id="add-compliance-title" className="text-base font-semibold text-slate-900">Add Compliance Item</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Schedule a new regulatory, license, or reporting deadline
                </p>
              </div>
              <IconButton
                label="Close"
                icon={<X size={18} />}
                onClick={() => setShowAdd(false)}
                className="h-10 w-10 shrink-0 md:h-8 md:w-8 text-slate-500 hover:bg-slate-100"
              />
            </div>
            <div className="space-y-4 px-5 py-5">
              <div>
                <label htmlFor="cmp-title" className={LABEL}>Title</label>
                <input
                  id="cmp-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className={inputClasses}
                  placeholder="e.g. Annual policy attestation"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="cmp-category" className={LABEL}>Category</label>
                  <select
                    id="cmp-category"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
                    className={inputClasses}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="cmp-priority" className={LABEL}>Priority</label>
                  <select
                    id="cmp-priority"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
                    className={inputClasses}
                  >
                    {(['Critical', 'High', 'Medium', 'Low'] as Priority[]).map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="cmp-frequency" className={LABEL}>Frequency</label>
                  <select
                    id="cmp-frequency"
                    value={form.frequency}
                    onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}
                    className={inputClasses}
                  >
                    {(['annually', 'quarterly', 'monthly', 'one-time', 'as-needed'] as Frequency[]).map(
                      (f) => (
                        <option key={f}>{f}</option>
                      )
                    )}
                  </select>
                </div>
                <div>
                  <label htmlFor="cmp-due" className={LABEL}>Due date</label>
                  <input
                    id="cmp-due"
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                    className={inputClasses}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="cmp-owner" className={LABEL}>Owner</label>
                  <input
                    id="cmp-owner"
                    value={form.owner}
                    onChange={(e) => setForm({ ...form, owner: e.target.value })}
                    className={inputClasses}
                    placeholder="Assignee or department"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="cmp-description" className={LABEL}>Description</label>
                <textarea
                  id="cmp-description"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={cx(inputClasses, 'resize-y')}
                />
              </div>
              <div>
                <label htmlFor="cmp-context" className={LABEL}>
                  Context note (optional)
                </label>
                <input
                  id="cmp-context"
                  value={form.contextNote}
                  onChange={(e) => setForm({ ...form, contextNote: e.target.value })}
                  className={inputClasses}
                  placeholder="Extra requirements or prior completion notes"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3">
              <Button variant="secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button icon={<Plus />} onClick={addItem}>
                Add item
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
