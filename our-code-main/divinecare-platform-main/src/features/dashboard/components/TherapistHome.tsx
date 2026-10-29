'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  CalendarDays,
  ClipboardList,
  FileText,
  Lock,
  MessageSquare,
  PenLine,
  Shield,
  Video,
} from 'lucide-react';
import { EmptyState } from '@/components/clinic/ui';
import type { Appointment } from '@/features/appointments';
import {
  relativeTime,
  tasksOf,
  useRoleHomeFeed,
  type HomeTask,
  type RoleHomeFeed,
} from '@/features/dashboard/hooks/useRoleHomeFeed';
import { useMessages } from '@/features/messages';
import { useModuleList } from '@/lib/modules/useModuleList';
import { PersonalizeHomeWidgets } from '@/features/dashboard/components/PersonalizeHomeWidgets';
import { TodayPanel } from '@/components/dashboard/TodayPanel';

type VisitStatus = Appointment['status'];
type NoteStatus = Appointment['noteStatus'];

type AssessmentDueItem = {
  id: string;
  clientId?: string;
  clientName: string;
  tool: string;
  dueLabel: string;
  overdue?: boolean;
};

const SEV: Record<string, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-green-100 text-green-700 border-green-200',
};

const VISIT_DOT: Record<string, string> = {
  scheduled: '#9CA3AF',
  'checked-in': '#3B82F6',
  'in-session': '#10B981',
  completed: '#7C3AED',
  'no-show': '#F59E0B',
  cancelled: '#EF4444',
  'late-cancel': '#F97316',
};

const VISIT_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  'checked-in': 'Checked In',
  'in-session': 'In Session',
  completed: 'Seen',
  'no-show': 'No-Show',
  cancelled: 'Cancelled',
  'late-cancel': 'Late Cancel',
};

const VISIT_BADGE: Record<string, string> = {
  scheduled: 'bg-gray-100 text-gray-600',
  'checked-in': 'bg-blue-100 text-blue-700',
  'in-session': 'bg-green-100 text-green-700',
  completed: 'bg-[#EEF0FE] text-[#5C2D91]',
  'no-show': 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-600',
  'late-cancel': 'bg-orange-100 text-orange-700',
};

const NOTE_BADGE: Record<NoteStatus, { cls: string; label: string }> = {
  'not-started': { cls: 'bg-amber-50 text-amber-700', label: 'Note Due' },
  'ai-draft': { cls: 'bg-purple-50 text-[#5C2D91]', label: 'AI Draft' },
  'in-progress': { cls: 'bg-blue-50 text-blue-700', label: 'In Progress' },
  signed: { cls: 'bg-green-50 text-green-700', label: 'Signed' },
};

const ALERT_TYPE_LABEL: Record<string, string> = {
  crisis_keywords: 'Crisis keyword detected',
  low_mood: 'Low mood 3+ days',
  high_stress: 'High stress',
};

function shortClientName(name: string | null | undefined) {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  if (/^[A-Z]\.?$/i.test(last) || last.length <= 2) return name;
  return `${parts[0]} ${last[0]}.`;
}

function formatTime12h(value: string) {
  // Accept "09:00", "9:00", "14:30"
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return value;
  let h = Number(m[1]);
  const min = m[2];
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${suffix}`;
}

function alertTypeLabel(type: string, stress?: number) {
  if (type === 'high_stress') {
    return `High stress (${stress ?? 9}/10)`;
  }
  return ALERT_TYPE_LABEL[type] || type.replaceAll('_', ' ');
}

function NoteBadgeIcon({ status }: { status: NoteStatus }) {
  if (status === 'not-started') return <AlertTriangle size={12} />;
  if (status === 'ai-draft') return <Bot size={12} />;
  if (status === 'in-progress') return <PenLine size={12} />;
  return <Lock size={12} />;
}

function SectionCard({
  title,
  href,
  linkLabel = 'View all',
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <h2 className="min-w-0 truncate text-base font-bold text-slate-900">{title}</h2>
        {href ? (
          <Link href={href} className="shrink-0 text-xs font-semibold text-purple-600 hover:underline">
            {linkLabel}
          </Link>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: 'teal' | 'red' | 'amber' | 'purple';
}) {
  const styles = {
    teal: {
      border: 'border-teal-100',
      accent: 'text-teal-600',
      iconBg: 'bg-teal-50',
      iconColor: 'text-teal-600',
    },
    red: {
      border: 'border-red-100',
      accent: 'text-red-600',
      iconBg: 'bg-red-50',
      iconColor: 'text-red-500',
    },
    amber: {
      border: 'border-amber-100',
      accent: 'text-amber-500',
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-500',
    },
    purple: {
      border: 'border-purple-100',
      accent: 'text-purple-600',
      iconBg: 'bg-purple-50',
      iconColor: 'text-purple-600',
    },
  }[tone];

  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm ${styles.border}`}>
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-xl ${styles.iconBg} ${styles.iconColor}`}
        >
          {icon}
        </div>
        <p className={`text-3xl font-extrabold tracking-tight ${styles.accent}`}>{value}</p>
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-800">{label}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-400">{sub}</p> : null}
    </div>
  );
}

function noteStatusFor(appt: Appointment, feed: RoleHomeFeed): NoteStatus {
  if (appt.noteStatus) return appt.noteStatus;
  const due = feed.tasks.some(
    (t) =>
      (t.type === 'unsigned_note' || t.type === 'missing_note') &&
      t.clientName === appt.clientName
  );
  if (due) return 'not-started';
  if (appt.status === 'completed') return 'signed';
  return 'not-started';
}

function parseNoteRow(task: HomeTask) {
  const raw = task.dueDate || task.description || '';
  // "Today · 10:00 AM SOAP" or "Yesterday · 2:00 PM DAP"
  const soap = /\bSOAP\b/i.test(raw) || /\bSOAP\b/i.test(task.description || '');
  const dap = /\bDAP\b/i.test(raw) || /\bDAP\b/i.test(task.description || '');
  const noteType = dap ? 'DAP' : soap ? 'SOAP' : 'SOAP';
  const datePart = raw
    .replace(/\bSOAP\b/gi, '')
    .replace(/\bDAP\b/gi, '')
    .replace(/\s*·\s*/g, ' ')
    .trim();
  return { datePart: datePart || task.title, noteType };
}

export function TherapistHome({ greeting, name }: { greeting: string; name: string }) {
  const feed = useRoleHomeFeed();
  const { threads } = useMessages();
  const [assessmentDue] = useModuleList<AssessmentDueItem>('assessment-due', []);
  const unsigned = tasksOf(feed, ['unsigned_note', 'missing_note']);
  const plans = tasksOf(feed, ['expiring_treatment_plan']);
  const scheduleRows = feed.todayAppts.slice(0, 5);
  const remaining = feed.todayAppts.filter((a) => a.status === 'scheduled').length;
  const overdueNotes = unsigned.filter((t) => (t.daysUntil ?? 1) < 0 || t.priority === 'urgent').length;
  const overdueAssessments = assessmentDue.filter(
    (a) => a.overdue || a.dueLabel.toLowerCase() === 'today'
  ).length;

  const unreviewedHighAlerts = feed.alerts.filter((a) => a.severity === 'high' && !a.reviewed);
  const recentThreads = threads.slice(0, 3);
  const unreadTotal = threads.reduce((acc, t) => acc + (t.unreadCount || 0), 0);

  if (feed.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Loading dashboard…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Unreviewed High-Severity Risk Alert Strip */}
      {unreviewedHighAlerts.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-300 bg-red-50/90 px-4 py-3 text-red-900 shadow-sm sm:px-5">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
              <span className="text-sm font-bold text-red-900">
                {unreviewedHighAlerts.length} High-Severity Risk Alert{unreviewedHighAlerts.length > 1 ? 's' : ''} Require Immediate Review
              </span>
            </div>
          </div>
          <Link
            href="/dashboard/alerts"
            className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-red-700 active:scale-[0.98]"
          >
            Review Alerts Now <ArrowRight size={13} />
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {greeting}, {name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Here&apos;s what needs your attention today</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {[
            { label: 'New Appointment', icon: <CalendarDays size={15} />, href: '/dashboard/appointments' },
            { label: 'New Note', icon: <FileText size={15} />, href: '/dashboard/ehr/notes' },
            { label: 'Check Eligibility', icon: <Shield size={15} />, href: '/dashboard/ehr/eligibility' },
            {
              label: 'New Treatment Plan',
              icon: <ClipboardList size={15} />,
              href: '/dashboard/ehr/treatment-plans',
            },
          ].map((a) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #5C2D91, #7B4DB5)' }}
            >
              {a.icon}
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      <TodayPanel />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<CalendarDays size={18} />}
          label="Today's Sessions"
          value={String(feed.todayAppts.length)}
          sub={`${remaining} remaining`}
          tone="teal"
        />
        <StatCard
          icon={<PenLine size={18} />}
          label="Unsigned Notes"
          value={String(unsigned.length)}
          sub={`${overdueNotes} overdue`}
          tone="red"
        />
        <StatCard
          icon={<ClipboardList size={18} />}
          label="Plans Expiring Soon"
          value={String(plans.length)}
          sub="Within 30 days"
          tone="amber"
        />
        <StatCard
          icon={<BarChart3 size={18} />}
          label="Assessments Due"
          value={String(assessmentDue.length)}
          sub={`${overdueAssessments} overdue`}
          tone="purple"
        />
      </div>

      <PersonalizeHomeWidgets />

      {/* Risk + Schedule */}
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Risk Alerts" href="/dashboard/alerts">
          {feed.alerts.length === 0 ? (
            <EmptyState title="No risk alerts" description="Unreviewed alerts will appear here." />
          ) : (
            <div className="divide-y divide-gray-50">
              {feed.alerts.slice(0, 3).map((a) => (
                <Link
                  key={a.id}
                  href={a.clientId ? `/dashboard/clients/${a.clientId}` : '/dashboard/alerts'}
                  className={`block border-l-4 p-4 transition hover:bg-gray-50 ${
                    a.severity === 'high' ? 'border-red-400' : 'border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-50 text-sm font-bold text-purple-600">
                      {shortClientName(a.clientName)[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {shortClientName(a.clientName)}
                        </p>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${SEV[a.severity] || SEV.medium}`}
                        >
                          {a.severity}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{alertTypeLabel(a.type, a.stress)}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {relativeTime(a.createdAt)} · Mood {a.mood}/10
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <div className="lg:col-span-2">
          <SectionCard title="Today's Schedule" href="/dashboard/appointments" linkLabel="Manage">
            {feed.todayAppts.length === 0 ? (
              <EmptyState
                title="No appointments today"
                description="Today's caseload will show here when scheduled."
              />
            ) : (
              <div className="divide-y divide-gray-50">
                {scheduleRows.map((a) => {
                  const noteStatus = noteStatusFor(a, feed);
                  const showNote =
                    a.status === 'completed' ||
                    a.status === 'in-session' ||
                    noteStatus === 'ai-draft' ||
                    noteStatus === 'signed';
                  return (
                    <div key={a.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50">
                      <div className="w-[4.5rem] shrink-0">
                        <p className="text-sm font-bold text-slate-900">{formatTime12h(a.startTime)}</p>
                        {a.isVirtual ? (
                          <span className="mt-0.5 flex items-center gap-0.5 text-[11px] font-medium text-teal-600">
                            <Video size={10} /> Virtual
                          </span>
                        ) : null}
                      </div>
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: VISIT_DOT[a.status] || VISIT_DOT.scheduled }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          <Link
                            href={`/dashboard/clients/${a.clientId}`}
                            className="hover:text-purple-600"
                          >
                            {shortClientName(a.clientName)}
                          </Link>
                        </p>
                        <p className="text-xs text-slate-500">{a.type}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${VISIT_BADGE[a.status]}`}
                      >
                        {VISIT_LABEL[a.status] || a.status}
                      </span>
                      {showNote ? (
                        <span
                          className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${NOTE_BADGE[noteStatus].cls}`}
                        >
                          <NoteBadgeIcon status={noteStatus} /> {NOTE_BADGE[noteStatus].label}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Inbox Preview + Notes + Assessments */}
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title={unreadTotal > 0 ? `Inbox (${unreadTotal} unread)` : 'Client Messages'}
          href="/dashboard/messages"
          linkLabel="Open Inbox"
        >
          {recentThreads.length === 0 ? (
            <EmptyState
              title="No client messages"
              description="Secure messages with clients will appear here."
            />
          ) : (
            <div className="divide-y divide-gray-50">
              {recentThreads.map((thread) => (
                <Link
                  key={thread.id}
                  href={`/dashboard/messages?client=${thread.clientId}`}
                  className="block p-4 transition hover:bg-gray-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-50 text-sm font-bold text-purple-600">
                      {shortClientName(thread.clientName)[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {shortClientName(thread.clientName)}
                        </p>
                        {thread.unreadCount > 0 ? (
                          <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-[#5C2D91]">
                            {thread.unreadCount} new
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            {thread.lastMessageTime || 'Recent'}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-500">
                        {thread.lastMessage || 'No message preview'}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                          {thread.topic || 'clinical'}
                        </span>
                        {thread.risk === 'high' ? (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                            High Risk
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Notes Needing Signature" href="/dashboard/ehr/notes">
          {unsigned.length === 0 ? (
            <EmptyState title="No unsigned notes" description="Draft notes awaiting signature show here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3 text-left">Client</th>
                    <th className="px-5 py-3 text-left">Date / Type</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {unsigned.map((n) => {
                    const overdue = (n.daysUntil ?? 1) < 0 || n.priority === 'urgent';
                    const row = parseNoteRow(n);
                    return (
                      <tr key={n.taskId} className="hover:bg-gray-50">
                        <td className="px-5 py-3.5 text-sm font-semibold text-slate-900">
                          {shortClientName(n.clientName)}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-500">
                          {row.datePart}
                          <br />
                          <span className="font-semibold text-slate-700">{row.noteType}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              overdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {overdue ? 'Overdue' : 'Due today'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Link
                            href={n.actionHref || '/dashboard/ehr/notes'}
                            className="text-xs font-semibold text-purple-600 hover:underline"
                          >
                            Sign →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Assessments Due" href="/dashboard/ehr/assessments">
          {assessmentDue.length === 0 ? (
            <EmptyState title="No assessments due" description="Queued screens will appear here." />
          ) : (
            <div className="divide-y divide-gray-50">
              {assessmentDue.map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-50 text-sm font-bold text-purple-600">
                    {shortClientName(item.clientName)[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {item.clientId ? (
                        <Link href={`/dashboard/clients/${item.clientId}`} className="hover:text-purple-600">
                          {shortClientName(item.clientName)}
                        </Link>
                      ) : (
                        shortClientName(item.clientName)
                      )}
                    </p>
                    <p className="text-xs text-slate-500">{item.tool}</p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      item.overdue || item.dueLabel.toLowerCase() === 'today'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {item.dueLabel}
                  </span>
                  <Link
                    href="/dashboard/ehr/assessments"
                    className="shrink-0 text-xs font-semibold text-purple-600 hover:underline"
                  >
                    Administer →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Treatment plans */}
      <SectionCard title="Treatment Plans Due for Review" href="/dashboard/ehr/treatment-plans">
        {plans.length === 0 ? (
          <EmptyState
            title="No treatment plans due"
            description="Plans nearing review will list here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 text-left">Client</th>
                  <th className="px-5 py-3 text-left">Primary Diagnosis</th>
                  <th className="px-5 py-3 text-left">Review Date</th>
                  <th className="px-5 py-3 text-left">Days Left</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {plans.map((p) => (
                  <tr key={p.taskId} className="hover:bg-gray-50">
                    <td className="px-5 py-3.5 text-sm font-semibold text-slate-900">
                      {shortClientName(p.clientName)}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-600">
                      <span className="block font-semibold text-slate-800">{p.title}</span>
                      {p.description && p.description !== p.title ? p.description : null}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-600">
                      {p.dueDate
                        ? new Date(p.dueDate + 'T12:00:00').toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          (p.daysUntil ?? 99) <= 7
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {p.daysUntil ?? '—'}d
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        href={p.actionHref || '/dashboard/ehr/treatment-plans'}
                        className="text-xs font-semibold text-purple-600 hover:underline"
                      >
                        Review →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
