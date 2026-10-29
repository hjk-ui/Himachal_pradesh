'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  FileText,
  CreditCard,
  ShieldCheck,
  Activity,
  Users,
  ChevronRight,
  EyeOff,
  ClipboardList,
  AlertTriangle,
  Clock3,
  CheckCircle2,
  ListTodo,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';

type TaskType =
  | 'unsigned_note'
  | 'expiring_treatment_plan'
  | 'missing_note'
  | 'overdue_assessment'
  | 'follow_up_due'
  | 'no_show'
  | 'claim_ready'
  | 'pa_expiring'
  | 'pa_units'
  | 'intake_incomplete'
  | 'assessment_due'
  | 'credential_expiring'
  | 'outstanding_copay'
  | 'waitlist_waiting'
  | 'risk_alert'
  | 'consent_pending';

type TaskPriority = 'urgent' | 'normal' | 'low';

interface Task {
  taskId: string;
  type: TaskType;
  priority: TaskPriority;
  title: string;
  description: string;
  clientName?: string;
  dueDate?: string;
  daysUntil?: number;
  actionLabel: string;
  actionHref: string;
}

const DISMISS_KEY = 'altrixs.tasks.dismissed.v1';
const DISMISS_MS = 24 * 60 * 60 * 1000;

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unsigned_note,missing_note', label: 'Notes' },
  { value: 'expiring_treatment_plan', label: 'Treatment Plans' },
  { value: 'pa_expiring,pa_units', label: 'Prior Auths' },
  { value: 'claim_ready,outstanding_copay', label: 'Billing' },
  { value: 'assessment_due,overdue_assessment', label: 'Assessments' },
  { value: 'intake_incomplete', label: 'Intake' },
  { value: 'credential_expiring', label: 'Credentials' },
];

const PRIORITY_FILTERS: { value: 'all' | TaskPriority; label: string }[] = [
  { value: 'all', label: 'All Priority' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

const FALLBACK_META: TaskType = 'unsigned_note';

const TYPE_META: Record<
  TaskType,
  { icon: React.ReactNode; label: string; iconBg: string; iconColor: string }
> = {
  unsigned_note: {
    icon: <FileText size={16} />,
    label: 'Unsigned Note',
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-600',
  },
  missing_note: {
    icon: <FileText size={16} />,
    label: 'Missing Note',
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-600',
  },
  overdue_assessment: {
    icon: <Activity size={16} />,
    label: 'Assessment',
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-600',
  },
  assessment_due: {
    icon: <Activity size={16} />,
    label: 'Assessment',
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-600',
  },
  follow_up_due: {
    icon: <ListTodo size={16} />,
    label: 'Follow-up',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  no_show: {
    icon: <Clock3 size={16} />,
    label: 'No-Show',
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
  },
  expiring_treatment_plan: {
    icon: <ClipboardList size={16} />,
    label: 'Treatment Plan',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  pa_expiring: {
    icon: <ShieldCheck size={16} />,
    label: 'Prior Auth',
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
  },
  pa_units: {
    icon: <ShieldCheck size={16} />,
    label: 'Prior Auth',
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
  },
  claim_ready: {
    icon: <CreditCard size={16} />,
    label: 'Billing',
    iconBg: 'bg-sky-100',
    iconColor: 'text-sky-600',
  },
  outstanding_copay: {
    icon: <CreditCard size={16} />,
    label: 'Co-Pay',
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-500',
  },
  intake_incomplete: {
    icon: <Users size={16} />,
    label: 'Intake',
    iconBg: 'bg-teal-100',
    iconColor: 'text-teal-600',
  },
  credential_expiring: {
    icon: <ShieldCheck size={16} />,
    label: 'Credential',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  waitlist_waiting: {
    icon: <Users size={16} />,
    label: 'Waitlist',
    iconBg: 'bg-teal-100',
    iconColor: 'text-teal-600',
  },
  risk_alert: {
    icon: <AlertTriangle size={16} />,
    label: 'Risk Alert',
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-600',
  },
  consent_pending: {
    icon: <ClipboardList size={16} />,
    label: 'Consent',
    iconBg: 'bg-indigo-100',
    iconColor: 'text-indigo-600',
  },
};

function dueChip(daysUntil?: number) {
  if (daysUntil === undefined) return null;
  if (daysUntil <= 0) return { text: 'Today', className: 'text-rose-600 font-semibold' };
  if (daysUntil === 1) return { text: 'Tomorrow', className: 'text-rose-600 font-semibold' };
  if (daysUntil <= 7) return { text: `${daysUntil}d`, className: 'text-amber-600 font-semibold' };
  if (daysUntil <= 14) return { text: `${daysUntil}d`, className: 'text-orange-500 font-medium' };
  return { text: `${daysUntil}d`, className: 'text-slate-400 font-medium' };
}

function readDismissed(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    const fresh: Record<string, number> = {};
    for (const [id, until] of Object.entries(parsed)) {
      if (typeof until === 'number' && until > now) fresh[id] = until;
    }
    return fresh;
  } catch {
    return {};
  }
}

function writeDismissed(map: Record<string, number>) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-10 shrink-0 items-center rounded-full px-3 py-1 text-xs font-semibold tracking-tight transition active:scale-[0.98] sm:min-h-11 sm:text-[13px] ${
        active
          ? 'bg-[#6868D0] text-white'
          : 'border border-slate-200 bg-white text-slate-600 hover:border-[#C7CBF5] hover:text-[#6868D0]'
      }`}
    >
      {children}
    </button>
  );
}

function TaskCard({
  task,
  onDismiss,
}: {
  task: Task;
  onDismiss: (id: string) => void;
}) {
  const meta = TYPE_META[task.type] ?? TYPE_META[FALLBACK_META];
  const due = dueChip(task.daysUntil);

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.iconBg} ${meta.iconColor}`}
        >
          {meta.icon}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-slate-900">{task.title}</h3>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              {meta.label}
            </span>
          </div>
          <p className="mt-0.5 text-sm leading-snug text-slate-500">{task.description}</p>
          {task.clientName ? (
            <p className="mt-1 text-sm font-semibold text-[#6868D0]">{task.clientName}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 pt-2 sm:flex-col sm:items-end sm:gap-1 sm:border-t-0 sm:pt-0">
          {due ? (
            <span className={`text-xs sm:text-[13px] ${due.className}`}>{due.text}</span>
          ) : null}
          <div className="ml-auto flex items-center gap-0.5 sm:ml-0">
            <Link
              href={task.actionHref}
              className="inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-sm font-semibold text-[#6868D0] hover:bg-slate-50"
            >
              {task.actionLabel}
              <ChevronRight size={15} />
            </Link>
            <button
              type="button"
              title="Hide for 24 hours"
              aria-label="Hide task for 24 hours"
              onClick={() => onDismiss(task.taskId)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-50 hover:text-slate-500"
            >
              <EyeOff size={15} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function PrioritySection({
  label,
  tone,
  tasks,
  onDismiss,
}: {
  label: string;
  tone: 'urgent' | 'normal' | 'low';
  tasks: Task[];
  onDismiss: (id: string) => void;
}) {
  if (tasks.length === 0) return null;
  const toneClass =
    tone === 'urgent'
      ? 'bg-rose-50 text-rose-600 ring-rose-100'
      : tone === 'normal'
        ? 'bg-amber-50 text-amber-700 ring-amber-100'
        : 'bg-slate-100 text-slate-500 ring-slate-200';

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-center sm:justify-start">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ring-1 ${toneClass}`}
        >
          {label} · {tasks.length}
        </span>
      </div>
      <div className="space-y-2.5">
        {tasks.map((task) => (
          <TaskCard key={task.taskId} task={task} onDismiss={onDismiss} />
        ))}
      </div>
    </section>
  );
}

const MY_PATIENTS_KEY = 'altrixs.tasks.myPatientsOnly.v1';

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const [typeFilter, setTypeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | TaskPriority>('all');
  const [currentTime, setCurrentTime] = useState(Date.now);
  const [myPatientsOnly, setMyPatientsOnly] = useState(true);
  const [hiddenOtherCount, setHiddenOtherCount] = useState(0);

  useEffect(() => {
    setDismissed(readDismissed());
    try {
      const stored = localStorage.getItem(MY_PATIENTS_KEY);
      if (stored === '0') setMyPatientsOnly(false);
      if (stored === '1') setMyPatientsOnly(true);
    } catch {
      /* ignore */
    }
    apiJson<{ success: true; tasks: Task[]; otherHidden?: number }>('/api/tasks')
      .then((data) => {
        setTasks(data.tasks);
        setHiddenOtherCount(data.otherHidden || 0);
      })
      .catch((err: Error) => setError(err.message || 'Could not load tasks'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const dismiss = (taskId: string) => {
    setDismissed((prev) => {
      const next = { ...prev, [taskId]: Date.now() + DISMISS_MS };
      writeDismissed(next);
      return next;
    });
  };

  const restoreDismissed = () => {
    setDismissed({});
    writeDismissed({});
  };

  const openTasks = useMemo(
    () => tasks.filter((t) => !dismissed[t.taskId] || dismissed[t.taskId]! <= currentTime),
    [tasks, dismissed, currentTime]
  );

  const filteredOpen = useMemo(
    () =>
      openTasks.filter((t) => {
        if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
        if (typeFilter !== 'all' && !typeFilter.split(',').includes(t.type)) return false;
        return true;
      }),
    [openTasks, typeFilter, priorityFilter]
  );

  const visible = useMemo(() => {
    if (!myPatientsOnly) return filteredOpen;
    return filteredOpen.filter((t) => Boolean(t.clientName));
  }, [filteredOpen, myPatientsOnly]);

  useEffect(() => {
    if (!myPatientsOnly) {
      setHiddenOtherCount(0);
      return;
    }
    setHiddenOtherCount(filteredOpen.filter((t) => !t.clientName).length);
  }, [filteredOpen, myPatientsOnly]);

  useEffect(() => {
    try {
      localStorage.setItem(MY_PATIENTS_KEY, myPatientsOnly ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [myPatientsOnly]);

  const urgentCount = openTasks.filter((t) => t.priority === 'urgent').length;
  const dismissedCount = Object.keys(dismissed).filter((id) => (dismissed[id] ?? 0) > currentTime).length;

  const urgentTasks = visible.filter((t) => t.priority === 'urgent');
  const normalTasks = visible.filter((t) => t.priority === 'normal');
  const lowTasks = visible.filter((t) => t.priority === 'low');

  return (
    <div className="mx-auto w-full max-w-6xl space-y-3">
      <header className="text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[1.65rem]">
            My To-Do
          </h1>
          {urgentCount > 0 ? (
            <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white">
              {urgentCount} urgent
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-sm text-slate-500">
          Your patients and the tasks routed to you. Prior authorizations go to billing and the front
          office; treatment plan reviews to the plan owner and supervisor
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:px-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                checked={myPatientsOnly}
                onChange={(e) => setMyPatientsOnly(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              My patients only
              {hiddenOtherCount > 0 ? (
                <span className="text-slate-400">({hiddenOtherCount} other task(s) hidden)</span>
              ) : null}
            </label>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Filter
            </span>
            {dismissedCount > 0 ? (
              <button
                type="button"
                onClick={restoreDismissed}
                className="text-xs font-medium text-[#6868D0] hover:underline"
                title="Tasks you hid with the eye icon come back here"
              >
                Show {dismissedCount} hidden task{dismissedCount === 1 ? '' : 's'}
              </button>
            ) : null}
          </div>
          <div className="flex w-full gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:justify-center [&::-webkit-scrollbar]:hidden">
            {TYPE_FILTERS.map((f) => (
              <FilterChip
                key={f.value}
                active={typeFilter === f.value}
                onClick={() => setTypeFilter(f.value)}
              >
                {f.label}
              </FilterChip>
            ))}
          </div>
          <div className="flex w-full gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:justify-center [&::-webkit-scrollbar]:hidden">
            {PRIORITY_FILTERS.map((f) => (
              <FilterChip
                key={f.value}
                active={priorityFilter === f.value}
                onClick={() => setPriorityFilter(f.value)}
              >
                {f.label}
              </FilterChip>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-center text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="py-12 text-center text-sm text-slate-500">Loading tasks…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center">
          <CheckCircle2 size={28} className="mx-auto text-emerald-600" />
          <p className="mt-2 text-sm font-semibold text-slate-900">All caught up</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            No tasks for these filters. Notes, plans, auths, claims, intake, and credentials show here
            when they need action.
          </p>
          {dismissedCount > 0 ? (
            <button
              type="button"
              onClick={restoreDismissed}
              className="mt-3 text-sm font-semibold text-[#6868D0] hover:underline"
            >
              Show {dismissedCount} hidden task{dismissedCount === 1 ? '' : 's'}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <PrioritySection
            label="Urgent"
            tone="urgent"
            tasks={urgentTasks}
            onDismiss={dismiss}
          />
          <PrioritySection
            label="Normal"
            tone="normal"
            tasks={normalTasks}
            onDismiss={dismiss}
          />
          <PrioritySection
            label="Low Priority"
            tone="low"
            tasks={lowTasks}
            onDismiss={dismiss}
          />
        </div>
      )}

      <p className="text-center text-xs leading-relaxed text-slate-400">
        Tasks come from your live caseload. The eye icon hides a task for 24 hours — use{' '}
        <span className="font-medium text-slate-500">Show hidden</span> to bring it back.
      </p>
    </div>
  );
}
