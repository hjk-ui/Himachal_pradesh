'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowRight, CalendarDays, ClipboardList, FileText, BarChart3,
  PenLine, Shield, Pill, Bot, CheckCircle2, Lock, Video,
  Users, DollarSign, XCircle, Plus, Microscope, Target, MessageSquare,
  Globe, UserCircle, Briefcase, GraduationCap, Megaphone,
} from 'lucide-react';
import { useMessages } from '@/features/messages';
import { EmptyState } from '@/components/clinic/ui';
import type { Appointment } from '@/features/appointments';
import {
  consentsExpiring,
  formatCents,
  pendingEligibility,
  relativeTime,
  staffProductivity,
  tasksOf,
  useRoleHomeFeed,
  type HomeTask,
  type RoleHomeFeed,
} from '@/features/dashboard/hooks/useRoleHomeFeed';
import { TherapistHome } from '@/features/dashboard/components/TherapistHome';
import { TodayPanel } from '@/components/dashboard/TodayPanel';
import { PersonalizeHomeWidgets } from '@/features/dashboard/components/PersonalizeHomeWidgets';
import { useModuleList } from '@/lib/modules/useModuleList';
import type { StaffRole } from '@/types/roles';
import { OfficeOpsPanel } from '@/components/office/OfficeOpsPanel';
import { FrontDeskHuddlePanel } from '@/components/front-desk/FrontDeskHuddlePanel';

const SEV: Record<string, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-green-100 text-green-700 border-green-200',
};

function StatCard({ icon, label, value, sub, border = 'border-slate-200', accent = 'text-slate-900', iconBg = 'bg-slate-100', iconColor = 'text-slate-600' }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  border?: string; accent?: string; iconBg?: string; iconColor?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-white px-4 py-3 shadow-sm sm:px-5 sm:py-3.5 ${border}`}>
      <div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-xl ${iconBg} ${iconColor}`}>
        {icon}
      </div>
      <p className={`text-2xl font-extrabold tracking-tight ${accent}`}>{value}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-700">{label}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-400">{sub}</p> : null}
    </div>
  );
}

function SectionCard({ title, href, linkLabel = 'View all', children }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
        <h2 className="min-w-0 truncate text-base font-bold text-slate-900">{title}</h2>
        {href ? (
          <Link
            href={href}
            className="shrink-0 text-xs font-semibold text-[#6868D0] hover:underline"
          >
            {linkLabel}
          </Link>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function QuickActionBar({ actions }: { actions: { label: string; icon: React.ReactNode; href: string; color?: string }[] }) {
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end sm:gap-3">
      {actions.map((a, i) => (
        <Link
          key={i}
          href={a.href}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-[0.98]"
          style={{ background: a.color || 'linear-gradient(135deg, #6868D0, #8891ff)' }}
        >
          {a.icon}
          <span>{a.label}</span>
        </Link>
      ))}
    </div>
  );
}

type VisitStatus = 'scheduled' | 'checked-in' | 'in-session' | 'completed' | 'no-show' | 'cancelled' | 'late-cancel';
type NoteStatus = 'not-started' | 'ai-draft' | 'in-progress' | 'signed';

function NoteBadgeIcon({ status }: { status: NoteStatus }) {
  if (status === 'not-started') return <AlertTriangle size={12} />;
  if (status === 'ai-draft') return <Bot size={12} />;
  if (status === 'in-progress') return <PenLine size={12} />;
  return <Lock size={12} />;
}

const VISIT_DOT: Record<VisitStatus, string> = {
  scheduled: '#9CA3AF', 'checked-in': '#3B82F6', 'in-session': '#10B981', completed: '#7C3AED', 'no-show': '#F59E0B', cancelled: '#EF4444', 'late-cancel': '#F97316',
};
const VISIT_LABEL: Record<VisitStatus, string> = {
  scheduled: 'Scheduled', 'checked-in': 'Checked In', 'in-session': 'In Session', completed: 'Seen', 'no-show': 'No-Show', cancelled: 'Cancelled', 'late-cancel': 'Late Cancel',
};
const VISIT_BADGE: Record<VisitStatus, string> = {
  scheduled: 'bg-gray-100 text-gray-600', 'checked-in': 'bg-blue-100 text-blue-700', 'in-session': 'bg-green-100 text-green-700',
  completed: 'bg-[#EEF0FE] text-[#6868D0]', 'no-show': 'bg-amber-100 text-amber-700', cancelled: 'bg-red-100 text-red-600', 'late-cancel': 'bg-orange-100 text-orange-700',
};
const NOTE_BADGE: Record<NoteStatus, { cls: string; label: string }> = {
  'not-started': { cls: 'bg-amber-50 text-amber-700', label: 'Note Due' },
  'ai-draft':    { cls: 'bg-purple-50 text-[#6868D0]', label: 'AI Draft' },
  'in-progress': { cls: 'bg-blue-50 text-blue-700', label: 'In Progress' },
  signed:        { cls: 'bg-green-50 text-green-700', label: 'Signed' },
};

function EmptyRows({ title }: { title: string }) {
  return <EmptyState title={title} description="Nothing here yet — this list fills from live clinic data." />;
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

function asVisit(status: Appointment['status']): VisitStatus {
  if (
    status === 'scheduled' ||
    status === 'checked-in' ||
    status === 'in-session' ||
    status === 'completed' ||
    status === 'no-show' ||
    status === 'cancelled' ||
    status === 'late-cancel'
  ) {
    return status;
  }
  return 'scheduled';
}

function claimTone(status: string) {
  const s = status.toLowerCase();
  if (s === 'paid') return SEV.low;
  if (s === 'denied') return SEV.high;
  return SEV.medium;
}

function UnreviewedRiskAlertStrip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-300 bg-red-50/90 px-4 py-3 text-red-900 shadow-sm sm:px-5">
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
          <span className="text-sm font-bold text-red-900">
            {count} High-Severity Risk Alert{count > 1 ? 's' : ''} Require Immediate Review
          </span>
          <span className="rounded-full bg-red-200/80 px-2.5 py-0.5 text-[11px] font-semibold text-red-800">
            Suicidal Ideation / Crisis Escalation Active
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
  );
}

function TherapistDashboard({ greeting, name }: { greeting: string; name: string }) {
  const feed = useRoleHomeFeed();
  const [assessmentDue] = useModuleList<AssessmentDueItem>('assessment-due', []);
  const unsigned = tasksOf(feed, ['unsigned_note', 'missing_note']);
  const plans = tasksOf(feed, ['expiring_treatment_plan']);
  const remaining = feed.todayAppts.filter(
    (a) => a.status === 'scheduled' || a.status === 'checked-in' || a.status === 'in-session'
  ).length;
  const overdueNotes = unsigned.filter((t) => (t.daysUntil ?? 1) < 0 || t.priority === 'urgent').length;
  const overdueAssessments = assessmentDue.filter(
    (a) => a.overdue || a.dueLabel.toLowerCase() === 'today'
  ).length;

  if (feed.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Loading dashboard…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {greeting}, {name}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">Here&apos;s what needs your attention today</p>
        </div>
        <QuickActionBar
          actions={[
            { label: 'New Note', icon: <FileText size={15} />, href: '/dashboard/ehr/notes', color: 'linear-gradient(135deg, #5C2D91, #7B4DB5)' },
            { label: 'New Treatment Plan', icon: <ClipboardList size={15} />, href: '/dashboard/ehr/treatment-plans', color: 'linear-gradient(135deg, #5C2D91, #7B4DB5)' },
            { label: 'Run Assessment', icon: <BarChart3 size={15} />, href: '/dashboard/ehr/assessments', color: 'linear-gradient(135deg, #5C2D91, #7B4DB5)' },
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TherapistStatCard
          icon={<CalendarDays size={18} />}
          label="Today's Sessions"
          value={String(feed.todayAppts.length)}
          sub={`${remaining} remaining`}
          tone="teal"
        />
        <TherapistStatCard
          icon={<PenLine size={18} />}
          label="Unsigned Notes"
          value={String(unsigned.length)}
          sub={`${overdueNotes} overdue`}
          tone="red"
        />
        <TherapistStatCard
          icon={<ClipboardList size={18} />}
          label="Plans Expiring Soon"
          value={String(plans.length)}
          sub="Within 30 days"
          tone="amber"
        />
        <TherapistStatCard
          icon={<BarChart3 size={18} />}
          label="Assessments Due"
          value={String(assessmentDue.length)}
          sub={`${overdueAssessments} overdue`}
          tone="purple"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Risk Alerts" href="/dashboard/alerts">
          {feed.alerts.length === 0 ? (
            <EmptyRows title="No risk alerts" />
          ) : (
            <div className="divide-y divide-gray-50">
              {feed.alerts.slice(0, 8).map((a) => (
                <Link
                  key={a.id}
                  href={a.clientId ? `/dashboard/clients/${a.clientId}` : '/dashboard/alerts'}
                  className="block border-l-4 border-transparent p-4 transition-all hover:border-red-300 hover:bg-gray-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EEF0FE] text-sm font-bold text-purple-600">
                      {(a.clientName || '?')[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">{a.clientName}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${SEV[a.severity] || SEV.medium}`}>
                          {a.severity}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{a.type}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                        <AlertTriangle size={11} className="shrink-0" />
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
              <EmptyRows title="No appointments today" />
            ) : (
              <AppointmentRows feed={feed} appointments={feed.todayAppts} />
            )}
          </SectionCard>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Notes Needing Signature" href="/dashboard/ehr/notes">
          {unsigned.length === 0 ? (
            <EmptyRows title="No unsigned notes" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                    <th className="px-5 py-3 text-left">Client</th>
                    <th className="px-5 py-3 text-left">Date / Type</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {unsigned.map((n) => {
                    const overdue = (n.daysUntil ?? 1) < 0 || n.priority === 'urgent';
                    return (
                      <tr key={n.taskId} className="hover:bg-gray-50">
                        <td className="px-5 py-3 text-sm font-semibold text-slate-900">
                          {n.clientName || '—'}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500">
                          {n.dueDate || n.description || n.title}
                          <br />
                          <span className="font-semibold text-slate-700">
                            {(n.type === 'unsigned_note' ? 'SOAP' : n.type).replaceAll('_', ' ')}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              overdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {overdue ? 'Overdue' : 'Due today'}
                          </span>
                        </td>
                        <td className="px-5 py-3">
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
            <EmptyRows title="No assessments due" />
          ) : (
            <div className="divide-y divide-gray-50">
              {assessmentDue.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-4 hover:bg-gray-50">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-50 text-sm font-bold text-purple-600">
                    {(item.clientName || '?')[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {item.clientId ? (
                        <Link href={`/dashboard/clients/${item.clientId}`} className="hover:text-purple-600">
                          {item.clientName}
                        </Link>
                      ) : (
                        item.clientName
                      )}
                    </p>
                    <p className="text-xs text-slate-500">{item.tool}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
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

      <SectionCard title="Treatment Plans Due for Review" href="/dashboard/ehr/treatment-plans">
        {plans.length === 0 ? <EmptyRows title="No treatment plans due" /> : <TaskPlanTable tasks={plans} />}
      </SectionCard>
    </div>
  );
}

type AssessmentDueItem = {
  id: string;
  clientId?: string;
  clientName: string;
  tool: string;
  dueLabel: string;
  overdue?: boolean;
};

function TherapistStatCard({
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
    teal: { border: 'border-teal-200', accent: 'text-teal-700', iconBg: 'bg-teal-50', iconColor: 'text-teal-600' },
    red: { border: 'border-red-200', accent: 'text-red-700', iconBg: 'bg-red-50', iconColor: 'text-red-600' },
    amber: { border: 'border-amber-200', accent: 'text-amber-700', iconBg: 'bg-amber-50', iconColor: 'text-amber-600' },
    purple: { border: 'border-purple-200', accent: 'text-purple-700', iconBg: 'bg-purple-50', iconColor: 'text-purple-600' },
  }[tone];

  return (
    <div className={`rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5 ${styles.border}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${styles.iconBg} ${styles.iconColor}`}>
          {icon}
        </div>
        <p className={`text-3xl font-extrabold tracking-tight ${styles.accent}`}>{value}</p>
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-700">{label}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-400">{sub}</p> : null}
    </div>
  );
}

function TaskPlanTable({ tasks }: { tasks: HomeTask[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
            <th className="px-5 py-3 text-left">Client</th>
            <th className="px-5 py-3 text-left">Primary Diagnosis</th>
            <th className="px-5 py-3 text-left">Review Date</th>
            <th className="px-5 py-3 text-left">Days Left</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {tasks.map((p) => (
            <tr key={p.taskId} className="hover:bg-gray-50">
              <td className="px-5 py-3 text-sm font-semibold text-slate-900">{p.clientName || '—'}</td>
              <td className="px-5 py-3 text-xs text-slate-600">
                <span className="block font-semibold text-slate-800">{p.title}</span>
                {p.description && p.description !== p.title ? p.description : null}
              </td>
              <td className="px-5 py-3 text-sm text-slate-600">
                {p.dueDate
                  ? new Date(p.dueDate + 'T12:00:00').toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : '—'}
              </td>
              <td className="px-5 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    (p.daysUntil ?? 99) <= 7 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {p.daysUntil ?? '—'}d
                </span>
              </td>
              <td className="px-5 py-3">
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
  );
}

function AppointmentRows({ feed, appointments, compact }: { feed: RoleHomeFeed; appointments: Appointment[]; compact?: boolean }) {
  return (
    <div className="divide-y divide-gray-50">
      {appointments.map((a) => {
        const visitStatus = asVisit(a.status);
        const noteStatus = noteStatusFor(a, feed);
        const showNote =
          !compact &&
          (visitStatus === 'completed' || visitStatus === 'in-session' || noteStatus !== 'not-started');
        return (
          <div key={a.id} className="flex items-center gap-3 p-4 hover:bg-gray-50">
            <div className="w-16 shrink-0 text-center">
              <p className="text-sm font-bold text-slate-900">{a.startTime}</p>
              {a.isVirtual ? (
                compact ? (
                  <span className="text-xs text-teal-600">Virtual</span>
                ) : (
                  <span className="flex items-center justify-center gap-0.5 text-xs text-teal-600">
                    <Video size={10} /> Virtual
                  </span>
                )
              ) : null}
            </div>
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: VISIT_DOT[visitStatus] }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">
                {a.clientId ? (
                  <Link href={`/dashboard/clients/${a.clientId}`} className="hover:text-purple-600">
                    {a.clientName}
                  </Link>
                ) : (
                  a.clientName
                )}
              </p>
              <p className="text-xs text-slate-500">{a.type}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${VISIT_BADGE[visitStatus]}`}>
              {VISIT_LABEL[visitStatus]}
            </span>
            {showNote ? (
              <span
                className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${NOTE_BADGE[noteStatus].cls}`}
              >
                <NoteBadgeIcon status={noteStatus} /> {NOTE_BADGE[noteStatus].label}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PRPDashboard({ greeting, name }: { greeting: string; name: string }) {
  const feed = useRoleHomeFeed();
  const visits = feed.todayAppts.filter((a) => a.type.toLowerCase().includes('prp'));
  const notesDue = tasksOf(feed, ['unsigned_note', 'missing_note']);
  const done = visits.filter((v) => v.status === 'completed').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting}, {name}</h1>
          <p className="text-gray-500 text-sm mt-1">PRP client visits and rehabilitation tracking</p>
        </div>
        <QuickActionBar actions={[
          { label: 'New Service Note', icon: <FileText size={15} />, href: '/dashboard/ehr/notes', color: 'linear-gradient(135deg, #00695C, #00897B)' },
          { label: 'Rehab Plans', icon: <ClipboardList size={15} />, href: '/dashboard/ehr/treatment-plans', color: 'linear-gradient(135deg, #00695C, #00897B)' },
          { label: 'PRP Program', icon: <Target size={15} />, href: '/dashboard/prp', color: 'linear-gradient(135deg, #00695C, #00897B)' },
        ]} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Users size={18} />} label="Assigned Clients" value={String(feed.clients.length)} sub={feed.clients.length > 12 ? `Showing 12 of ${feed.clients.length}` : 'Active cases'} border="border-teal-200" accent="text-teal-700" iconBg="bg-teal-100" iconColor="text-teal-700" />
        <StatCard icon={<CalendarDays size={18} />} label="Today's PRP Visits" value={String(visits.length)} sub={`${done} completed`} border="border-[#C7CBF5]" accent="text-[#6868D0]" iconBg="bg-[#EEF0FE]" iconColor="text-[#6868D0]" />
        <StatCard icon={<FileText size={18} />} label="Service Notes Due" value={String(notesDue.length)} sub="From To-Do" border="border-red-200" accent="text-red-700" iconBg="bg-red-100" iconColor="text-red-700" />
        <StatCard icon={<Target size={18} />} label="Open tasks" value={String(feed.tasks.length)} sub="From To-Do" border="border-green-200" accent="text-green-700" iconBg="bg-green-100" iconColor="text-green-700" />
      </div>

      <PersonalizeHomeWidgets />

      <div className="grid lg:grid-cols-2 gap-6">
        <SectionCard title="Today's Visit Schedule" href="/dashboard/appointments">
          {visits.length === 0 ? <EmptyRows title="No visits today" /> : (
            <div className="divide-y divide-gray-50">
              {visits.map((v) => (
                <div key={v.id} className={`p-4 flex items-center gap-4 hover:bg-gray-50 ${v.status === 'completed' ? 'opacity-50' : ''}`}>
                  <div className="w-16 text-center shrink-0">
                    <p className="text-sm font-bold text-gray-900">{v.startTime}</p>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">{v.clientName}</p>
                    <p className="text-xs text-gray-500">{v.type}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-semibold ${v.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-teal-100 text-teal-700'}`}>
                    {v.status === 'completed' ? 'Done' : 'Upcoming'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Notes Needing Follow-up" href="/dashboard/prp">
          {notesDue.length === 0 ? <EmptyRows title="No notes due" /> : (
            <div className="divide-y divide-gray-50">
              {notesDue.map((c) => (
                <div key={c.taskId} className="p-4 flex items-center gap-4 hover:bg-gray-50">
                  <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-sm font-bold text-teal-700">{(c.clientName || '?')[0]}</div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">{c.clientName || '—'}</p>
                    <p className="text-xs text-gray-500">{c.title}</p>
                  </div>
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">Note Due</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="All Assigned PRP Clients" href="/dashboard/prp">
        {feed.clients.length === 0 ? <EmptyRows title="No assigned clients" /> : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
              <th className="text-left px-5 py-3">Client</th>
              <th className="text-left px-5 py-3">Today</th>
              <th className="text-left px-5 py-3">Note Status</th>
              <th className="px-5 py-3" />
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {feed.clients.slice(0, 12).map((c) => {
                const todayCount = visits.filter((v) => v.clientName === c.name).length;
                const due = notesDue.some((t) => t.clientName === c.name);
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center text-xs font-bold text-teal-700">{(c.name || '?')[0]}</div>
                        <span className="text-sm font-semibold text-gray-900">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">{todayCount} visits</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${due ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {due ? 'Due' : 'Up to date'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Link href="/dashboard/ehr/notes" className="text-xs text-[#6868D0] hover:underline font-semibold">Write Note &rarr;</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function PsychDashboard({ greeting, name, role }: { greeting: string; name: string; role: StaffRole }) {
  const feed = useRoleHomeFeed();
  const { threads } = useMessages();
  const isNP = role === 'NP';
  const psychAppts = feed.todayAppts.filter((appointment) => /psych|med|eval/i.test(appointment.type));
  const shownVisits = psychAppts.length ? psychAppts : feed.todayAppts;
  const unsigned = feed.tasks.filter((task) => task.type === 'unsigned_note' || task.type === 'missing_note');
  const plans = feed.tasks.filter((task) => task.type === 'expiring_treatment_plan');
  const unreviewedHigh = feed.alerts.filter((a) => a.severity === 'high' && !a.reviewed).length;

  return (
    <div className="space-y-6">
      <UnreviewedRiskAlertStrip count={unreviewedHigh} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting}, {name}</h1>
          <p className="text-gray-500 text-sm mt-1">Medication management and psychiatric follow-ups</p>
        </div>
        <QuickActionBar actions={[
          { label: isNP ? 'New Prescription' : 'New Prescription', icon: <Pill size={15} />, href: '/dashboard/ehr/prescriptions', color: 'linear-gradient(135deg, #1565C0, #1976D2)' },
          { label: 'Medication Review', icon: <Microscope size={15} />, href: '/dashboard/ehr/prescriptions', color: 'linear-gradient(135deg, #1565C0, #1976D2)' },
          { label: 'New Note', icon: <FileText size={15} />, href: '/dashboard/ehr/notes', color: 'linear-gradient(135deg, #1565C0, #1976D2)' },
        ]} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<CalendarDays size={18} />} label="Today's Appointments" value={String(shownVisits.length)} sub={`${psychAppts.length} med / psych visits`} border="border-blue-200" accent="text-blue-700" iconBg="bg-blue-100" iconColor="text-blue-700" />
        <StatCard icon={<ClipboardList size={18} />} label="Unsigned notes" value={String(unsigned.length)} sub={`${plans.length} plans due in 30 days`} border="border-amber-200" accent="text-amber-700" iconBg="bg-amber-100" iconColor="text-amber-700" />
        <StatCard icon={<Pill size={18} />} label="Client messages" value={String(threads.length)} sub="From your caseload" border="border-blue-200" accent="text-blue-700" iconBg="bg-blue-100" iconColor="text-blue-700" />
        <StatCard icon={<AlertTriangle size={18} />} label="Risk alerts" value={String(feed.alerts.length)} sub="Live chart alerts" border="border-red-200" accent="text-red-700" iconBg="bg-red-100" iconColor="text-red-700" />
      </div>

      <PersonalizeHomeWidgets />

      <div className="grid lg:grid-cols-2 gap-6">
        <SectionCard title="Refill Requests" href="/dashboard/ehr/prescriptions" linkLabel="Manage all">
          <EmptyRows title="No refill requests" />
        </SectionCard>

        <SectionCard title="Today's Schedule" href="/dashboard/appointments">
          {shownVisits.length === 0 ? <EmptyRows title="No appointments today" /> : (
            <AppointmentRows feed={feed} appointments={shownVisits} compact />
          )}
        </SectionCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <SectionCard title="Side Effect Alerts" href="/dashboard/ehr/prescriptions">
          <div className="p-8 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
            <CheckCircle2 size={24} className="text-gray-300" />
            No side effect alerts at this time
          </div>
        </SectionCard>

        <SectionCard title="Active Medications — Follow-up Due" href="/dashboard/ehr/prescriptions">
          <EmptyRows title="No medications to review" />
        </SectionCard>
      </div>
    </div>
  );
}

function CrisisCallButton() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function createCall() {
    setBusy(true);
    setMessage('');
    const response = await fetch('/api/crisis/episodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: 'Check Caller',
        callerName: 'Check Caller',
        priority: 2,
        status: 'open',
      }),
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? 'Crisis call recorded.' : data.error || 'Crisis call was not recorded.');
    setBusy(false);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">Crisis calls</h2>
      <p className="mt-1 text-sm text-slate-600">Record the call here. The crisis board stays with the crisis team.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void createCall()}
        className="mt-3 rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        Log a crisis call
      </button>
      {message ? <p className="mt-2 text-sm text-slate-700">{message}</p> : null}
    </section>
  );
}

function OfficeDashboard({ greeting, name }: { greeting: string; name: string }) {
  const feed = useRoleHomeFeed();
  const [location, setLocation] = useState('all');
  const rawElig = pendingEligibility(feed);
  const rawConsents = consentsExpiring(feed);

  const elig = rawElig;
  const consents = rawConsents;
  const locations = [...new Set(feed.clients.map((client) => client.locationName).filter(Boolean))] as string[];
  const allowedIds = new Set(
    feed.clients.filter((client) => location === 'all' || client.locationName === location).map((client) => client.id)
  );
  const appts = feed.todayAppts.filter((appointment) => location === 'all' || allowedIds.has(appointment.clientId));

  const displayName = name;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting}, {displayName}</h1>
          <p className="text-gray-500 text-sm mt-1">Scheduling, intake, eligibility, and consents</p>
          <label className="mt-2 block text-xs font-semibold text-slate-600">
            Location
            <select className="ml-2 rounded-lg border border-slate-300 px-2 py-1 text-sm" value={location} onChange={(event) => setLocation(event.target.value)}>
              <option value="all">All locations</option>
              {locations.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>
        <QuickActionBar actions={[
          { label: 'Schedule Appt', icon: <CalendarDays size={15} />, href: '/dashboard/appointments', color: 'linear-gradient(135deg, #37474F, #546E7A)' },
          { label: 'Check Eligibility', icon: <Shield size={15} />, href: '/dashboard/ehr/eligibility', color: 'linear-gradient(135deg, #37474F, #546E7A)' },
          { label: 'Send Consent', icon: <PenLine size={15} />, href: '/dashboard/ehr/consents', color: 'linear-gradient(135deg, #37474F, #546E7A)' },
        ]} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<CalendarDays size={18} />} label="Today's Appointments" value={String(appts.length)} sub="All providers" border="border-gray-200" accent="text-gray-700" iconBg="bg-gray-100" iconColor="text-gray-600" />
        <StatCard icon={<UserCircle size={18} />} label="New Clients This Week" value={String(feed.clients.filter((c) => {
          const created = Date.parse((c as { createdAt?: string }).createdAt || '');
          return Number.isFinite(created) && Date.now() - created < 7 * 86_400_000;
        }).length)} sub="From the live roster" border="border-blue-200" accent="text-blue-700" iconBg="bg-blue-100" iconColor="text-blue-700" />
        <StatCard icon={<Shield size={18} />} label="Pending Eligibility" value={String(rawElig.length)} sub="Needs verification" border="border-amber-200" accent="text-amber-700" iconBg="bg-amber-100" iconColor="text-amber-700" />
        <StatCard icon={<PenLine size={18} />} label="Consents Expiring" value={String(rawConsents.length)} sub="Within 30 days" border="border-red-200" accent="text-red-700" iconBg="bg-red-100" iconColor="text-red-700" />
      </div>

      <CrisisCallButton />

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">Front-desk huddle</h2>
        <p className="mt-1 text-sm text-slate-600">
          {appts.filter((appointment) => appointment.status !== 'completed' && appointment.status !== 'cancelled').length} visits still open today · {rawElig.length} eligibility checks pending · {rawConsents.length} consents expiring within 30 days.
        </p>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <SectionCard title="Eligibility Verification Needed" href="/dashboard/ehr/eligibility">
          <div className="divide-y divide-gray-50">
            {elig.map((e) => (
              <div key={e.id} className="p-4 flex items-center gap-4 hover:bg-gray-50">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-700">{(e.clientName || '?')[0]}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{e.clientName}</p>
                  <p className="text-xs text-gray-500">{e.payerName} &middot; DOS {e.dos}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${e.status === 'ERROR' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                  {e.status === 'ERROR' ? 'Failed' : 'Pending'}
                </span>
                <Link href="/dashboard/ehr/eligibility" className="text-xs text-[#6868D0] hover:underline font-semibold shrink-0">Verify &rarr;</Link>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Consents Expiring Soon" href="/dashboard/ehr/consents">
          <div className="divide-y divide-gray-50">
            {consents.map((c) => (
              <div key={c.id} className="p-4 flex items-center gap-4 hover:bg-gray-50">
                <div className="w-8 h-8 rounded-full bg-[#EEF0FE] flex items-center justify-center text-sm font-bold text-[#6868D0]">{(c.clientName || '?')[0]}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{c.clientName}</p>
                  <p className="text-xs text-gray-500 truncate">{c.type}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Expires {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}</p>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${c.days <= 7 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                  {c.days}d
                </span>
                <Link href="/dashboard/ehr/consents" className="text-xs text-[#6868D0] hover:underline font-semibold shrink-0">Renew &rarr;</Link>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Today's Full Schedule" href="/dashboard/appointments">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
              <th className="text-left px-5 py-3">Time</th>
              <th className="text-left px-5 py-3">Client</th>
              <th className="text-left px-5 py-3">Type</th>
              <th className="text-left px-5 py-3">Format</th>
              <th className="px-5 py-3">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {appts.map((a) => {
                const visitStatus = asVisit(a.status);
                const noteStatus = noteStatusFor(a, feed);
                return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-sm font-bold text-gray-900">{a.startTime}</td>
                    <td className="px-5 py-3 text-sm font-semibold text-gray-900">{a.clientName}</td>
                    <td className="px-5 py-3 text-xs text-gray-500">{a.type}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${a.isVirtual ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-600'}`}>
                        {a.isVirtual ? 'Virtual' : 'In-Person'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: VISIT_DOT[visitStatus] }} />
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${VISIT_BADGE[visitStatus]}`}>{VISIT_LABEL[visitStatus]}</span>
                        {(visitStatus === 'completed' || visitStatus === 'in-session') && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold flex items-center ${NOTE_BADGE[noteStatus].cls}`}>
                            <NoteBadgeIcon status={noteStatus} />
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function BillingDashboard({ greeting, name }: { greeting: string; name: string }) {
  const feed = useRoleHomeFeed();
  const rawPending = feed.claims.filter((c) => c.status === 'DRAFT' || c.status === 'READY' || c.status === 'SUBMITTED');
  const rawDenied = feed.claims.filter((c) => c.status === 'DENIED');
  const rawPaid = feed.claims.filter((c) => c.status === 'PAID');
  const rawElig = pendingEligibility(feed);

  const claims = [...rawPending, ...rawDenied];
  const elig = rawElig;

  const displayName = name;

  const claimsCount = String(feed.claims.length);
  const pendingSub = `${rawPending.length} pending`;
  const deniedCount = String(rawDenied.length);
  const paidCountStr =
    rawPaid.length > 0
      ? formatCents(rawPaid.reduce((s, c) => s + (c.amountCents || 0), 0))
      : formatCents(0);
  const collectionsStr = formatCents(feed.paymentsCents);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting}, {displayName}</h1>
          <p className="text-gray-500 text-sm mt-1">Claims, insurance, and revenue management</p>
        </div>
        <QuickActionBar actions={[
          { label: 'New Claim', icon: <Plus size={15} />, href: '/dashboard/billing', color: 'linear-gradient(135deg, #F57F17, #F9A825)' },
          { label: 'Run Eligibility', icon: <Shield size={15} />, href: '/dashboard/ehr/eligibility', color: 'linear-gradient(135deg, #F57F17, #F9A825)' },
          { label: 'View Denials', icon: <XCircle size={15} />, href: '/dashboard/billing/denials', color: 'linear-gradient(135deg, #F57F17, #F9A825)' },
        ]} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<ClipboardList size={18} />} label="Claims This Week" value={claimsCount} sub={pendingSub} border="border-amber-200" accent="text-amber-700" iconBg="bg-amber-100" iconColor="text-amber-700" />
        <StatCard icon={<XCircle size={18} />} label="Denied Claims" value={deniedCount} sub="Action required" border="border-red-200" accent="text-red-700" iconBg="bg-red-100" iconColor="text-red-700" />
        <StatCard icon={<CheckCircle2 size={18} />} label="Paid This Week" value={paidCountStr} sub="From the live ledger" border="border-green-200" accent="text-green-700" iconBg="bg-green-100" iconColor="text-green-700" />
        <StatCard icon={<BarChart3 size={18} />} label="Collections MTD" value={collectionsStr} sub="Posted payments" border="border-blue-200" accent="text-blue-700" iconBg="bg-blue-100" iconColor="text-blue-700" />
      </div>

      <SectionCard title="Claims Needing Action" href="/dashboard/billing">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
              <th className="text-left px-5 py-3">Client Name</th>
              <th className="text-left px-5 py-3">CPT Code</th>
              <th className="text-left px-5 py-3">Diagnosis</th>
              <th className="text-left px-5 py-3">Date of Service</th>
              <th className="text-left px-5 py-3">Payer</th>
              <th className="text-left px-5 py-3">Amount</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="px-5 py-3">Action</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {claims.slice(0, 12).map((c) => {
                const isPaid = c.status === 'PAID';
                const isDenied = c.status === 'DENIED';
                const statusBadgeCls = isPaid
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : isDenied
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200';
                const statusLabel = isPaid ? 'Approved' : isDenied ? 'Denied' : 'Pending';

                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-sm font-semibold text-gray-900">{c.clientName}</td>
                    <td className="px-5 py-3 text-xs font-mono font-bold text-gray-700">{c.cptCode}</td>
                    <td className="px-5 py-3 text-xs font-mono text-gray-600">{c.submissionData?.diagnosisCodes?.join(', ') || '—'}</td>
                    <td className="px-5 py-3 text-xs text-gray-500">{c.serviceDate ? new Date(c.serviceDate).toLocaleDateString() : '—'}</td>
                    <td className="px-5 py-3 text-xs text-gray-600 font-medium">{c.payer || '—'}</td>
                    <td className="px-5 py-3 text-sm font-bold text-gray-900">{formatCents(c.amountCents)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusBadgeCls}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={isDenied ? '/dashboard/billing/denials' : '/dashboard/billing'}
                        className={`text-xs font-semibold hover:underline ${isDenied ? 'text-rose-600 font-bold' : 'text-[#6868D0]'}`}
                      >
                        {isDenied ? 'Appeal →' : 'View →'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Eligibility Verification Queue" href="/dashboard/ehr/eligibility">
        <div className="divide-y divide-gray-50">
          {elig.map((e) => (
            <div key={e.id} className="p-4 flex items-center gap-4 hover:bg-gray-50">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{e.clientName}</p>
                <p className="text-xs text-gray-500">{e.payerName} &middot; DOS {e.dos}</p>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${e.status === 'ERROR' ? SEV.high : SEV.medium}`}>
                {e.status === 'ERROR' ? 'Failed' : 'Pending'}
              </span>
              <Link href="/dashboard/ehr/eligibility" className="text-xs text-[#6868D0] hover:underline font-semibold shrink-0">Verify &rarr;</Link>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

function HRDashboard({ greeting, name }: { greeting: string; name: string }) {
  const feed = useRoleHomeFeed();
  const activeStaff = feed.staff.filter((s) => s.status !== 'DEACTIVATED');
  const expiring = feed.credentials.filter((c) => c.daysUntilExpiry <= 90);
  const training = feed.credentials.filter((c) => c.credentialType === 'CEU' && c.daysUntilExpiry <= 90);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting}, {name}</h1>
          <p className="text-gray-500 text-sm mt-1">Staff management, credentialing, and training</p>
        </div>
        <QuickActionBar actions={[
          { label: 'View Staff', icon: <Users size={15} />, href: '/dashboard/hr', color: 'linear-gradient(135deg, #880E4F, #AD1457)' },
          { label: 'Credentialing', icon: <Shield size={15} />, href: '/dashboard/hr/credentialing', color: 'linear-gradient(135deg, #880E4F, #AD1457)' },
          { label: 'Add Training', icon: <GraduationCap size={15} />, href: '/dashboard/hr/training', color: 'linear-gradient(135deg, #880E4F, #AD1457)' },
        ]} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Users size={18} />} label="Total Staff" value={String(feed.staff.length)} sub={`${activeStaff.length} active`} border="border-pink-200" accent="text-pink-700" iconBg="bg-pink-100" iconColor="text-pink-700" />
        <StatCard icon={<Briefcase size={18} />} label="Licenses Expiring" value={String(expiring.length)} sub="Within 90 days" border="border-amber-200" accent="text-amber-700" iconBg="bg-amber-100" iconColor="text-amber-700" />
        <StatCard icon={<GraduationCap size={18} />} label="CEUs due" value={String(training.length)} sub="Credential CEUs" border="border-red-200" accent="text-red-700" iconBg="bg-red-100" iconColor="text-red-700" />
        <StatCard icon={<Megaphone size={18} />} label="Open Positions" value="—" sub="Open the jobs board" border="border-[#C7CBF5]" accent="text-[#6868D0]" iconBg="bg-[#EEF0FE]" iconColor="text-[#6868D0]" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <SectionCard title="Credentials Expiring" href="/dashboard/hr/credentialing">
          {expiring.length === 0 ? <EmptyRows title="No credentials expiring soon" /> : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead><tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                <th className="text-left px-5 py-3">Staff Member</th>
                <th className="text-left px-5 py-3">Credential</th>
                <th className="text-left px-5 py-3">Expires</th>
                <th className="text-left px-5 py-3">Days Left</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {expiring.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-sm font-semibold text-gray-900">{c.staffName}</td>
                    <td className="px-5 py-3 text-xs font-semibold text-gray-600">{c.title}</td>
                    <td className="px-5 py-3 text-xs text-gray-500">{new Date(c.expiresAt).toLocaleDateString()}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.daysUntilExpiry <= 30 ? 'bg-red-100 text-red-700' : c.daysUntilExpiry <= 60 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                        {c.daysUntilExpiry}d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Training & CEUs Due" href="/dashboard/hr/training">
          {training.length === 0 ? <EmptyRows title="No training tracker items" /> : (
            <div className="divide-y divide-gray-50">
              {training.map((t) => (
                <div key={t.id} className="p-4 flex items-center gap-4 hover:bg-gray-50">
                  <div className="w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center text-sm font-bold text-pink-700">{(t.staffName || '?')[0]}</div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">{t.staffName}</p>
                    <p className="text-xs text-gray-500">{t.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Due {new Date(t.expiresAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${t.daysUntilExpiry < 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {t.daysUntilExpiry < 0 ? 'Overdue' : 'Due Soon'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function AdminDashboard({ greeting, name }: { greeting: string; name: string }) {
  const feed = useRoleHomeFeed();
  const prod = staffProductivity(feed);
  const highAlerts = feed.alerts.filter((a) => a.severity === 'high').length;
  const unreviewedHigh = feed.alerts.filter((a) => a.severity === 'high' && !a.reviewed).length;
  const escalated = feed.tasks.filter((task) => /escalat/i.test(task.title)).length;
  const clinicians = new Set(feed.todayAppts.map((a) => a.clinicianName).filter(Boolean)).size;

  return (
    <div className="space-y-4 sm:space-y-6">
      <UnreviewedRiskAlertStrip count={unreviewedHigh} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">
            {greeting}, {name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Practice overview — staff, clients, billing, compliance
            {escalated ? ` · ${escalated} unsigned note${escalated === 1 ? '' : 's'} escalated past 7 days` : ''}
          </p>
        </div>
        <QuickActionBar
          actions={[
            { label: 'AI Insights', icon: <Bot size={15} />, href: '/dashboard/ai-insights' },
            { label: 'Reports', icon: <BarChart3 size={15} />, href: '/dashboard/reports' },
            { label: 'Compliance', icon: <Lock size={15} />, href: '/dashboard/admin' },
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
        <StatCard
          icon={<Users size={18} />}
          label="Active Clients"
          value={String(feed.activeClients || feed.clients.length)}
          sub={`${feed.staff.length} staff`}
          border="border-[#C7CBF5]"
          accent="text-[#6868D0]"
          iconBg="bg-[#EEF0FE]"
          iconColor="text-[#6868D0]"
        />
        <StatCard
          icon={<CalendarDays size={18} />}
          label="Sessions Today"
          value={String(feed.todayAppts.length)}
          sub={`Across ${clinicians} clinicians`}
          border="border-teal-200"
          accent="text-teal-700"
          iconBg="bg-teal-100"
          iconColor="text-teal-700"
        />
        <StatCard
          icon={<DollarSign size={18} />}
          label="Revenue MTD"
          value={formatCents(feed.paymentsCents)}
          sub="From payments ledger"
          border="border-green-200"
          accent="text-green-700"
          iconBg="bg-green-100"
          iconColor="text-green-700"
        />
        <StatCard
          icon={<AlertTriangle size={18} />}
          label="Open Alerts"
          value={String(feed.alerts.length)}
          sub={`${highAlerts} high severity`}
          border="border-red-200"
          accent="text-red-700"
          iconBg="bg-red-100"
          iconColor="text-red-700"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:gap-6">
        <SectionCard title="Risk Alerts" href="/dashboard/alerts">
          {feed.alerts.length === 0 ? (
            <EmptyRows title="No risk alerts" />
          ) : (
            <div className="divide-y divide-slate-50">
              {feed.alerts.slice(0, 8).map((a) => (
                <Link
                  key={a.id}
                  href="/dashboard/alerts"
                  className="block border-l-4 border-transparent p-4 transition-all hover:border-red-300 hover:bg-slate-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EEF0FE] text-sm font-bold text-[#6868D0]">
                      {(a.clientName || '?')[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">{a.clientName}</p>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${SEV[a.severity] || SEV.medium}`}
                        >
                          {a.severity}
                        </span>
                      </div>
                      <p className="truncate text-xs text-slate-500">{a.type}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{relativeTime(a.createdAt)}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <div className="min-w-0 lg:col-span-2">
          <SectionCard title="Billing Snapshot" href="/dashboard/billing">
            {feed.claims.length === 0 ? (
              <EmptyRows title="No claims yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-3 text-left sm:px-5">Client</th>
                      <th className="px-4 py-3 text-left sm:px-5">CPT</th>
                      <th className="px-4 py-3 text-left sm:px-5">Payer</th>
                      <th className="px-4 py-3 text-left sm:px-5">Amount</th>
                      <th className="px-4 py-3 text-left sm:px-5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {feed.claims.slice(0, 8).map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="max-w-[140px] truncate px-4 py-3 font-semibold text-slate-900 sm:px-5">
                          {c.clientName}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600 sm:px-5">{c.cptCode}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 sm:px-5">{c.payer || '—'}</td>
                        <td className="px-4 py-3 font-bold text-slate-900 sm:px-5">
                          {formatCents(c.amountCents)}
                        </td>
                        <td className="px-4 py-3 sm:px-5">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${claimTone(c.status)}`}
                          >
                            {c.status.toLowerCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard title="Staff Productivity — Today" href="/dashboard/analytics/productivity">
        {prod.length === 0 ? (
          <EmptyRows title="No sessions today" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 text-left sm:px-5">Staff Member</th>
                  <th className="px-4 py-3 text-left sm:px-5">Role</th>
                  <th className="px-4 py-3 text-left sm:px-5">Sessions</th>
                  <th className="px-4 py-3 text-left sm:px-5">Notes Written</th>
                  <th className="px-4 py-3 text-left sm:px-5">Unsigned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {prod.map((s) => (
                  <tr key={s.name} className="hover:bg-slate-50">
                    <td className="max-w-[160px] truncate px-4 py-3 font-semibold text-slate-900 sm:px-5">
                      {s.name}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 sm:px-5">{s.role}</td>
                    <td className="px-4 py-3 text-slate-700 sm:px-5">{s.sessions}</td>
                    <td className="px-4 py-3 text-slate-700 sm:px-5">{s.notes}</td>
                    <td className="px-4 py-3 sm:px-5">
                      {s.unsigned > 0 ? (
                        <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                          {s.unsigned}
                        </span>
                      ) : (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-100">
                          <CheckCircle2 size={12} className="text-green-600" />
                        </span>
                      )}
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

function ClinicalSupportDashboard({ greeting, name, role }: { greeting: string; name: string; role: StaffRole }) {
  const feed = useRoleHomeFeed();
  const isCaseManager = role === 'CASE_MANAGER';
  const appts = feed.todayAppts;
  const unreviewedHigh = feed.alerts.filter((a) => a.severity === 'high' && !a.reviewed).length;

  return (
    <div className="space-y-6">
      {isCaseManager ? <UnreviewedRiskAlertStrip count={unreviewedHigh} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting}, {name}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {isCaseManager ? 'Care coordination and client support' : 'Peer support and community outreach'}
          </p>
        </div>
        <QuickActionBar actions={[
          { label: 'Messages', icon: <MessageSquare size={15} />, href: '/dashboard/messages', color: 'linear-gradient(135deg, #E65100, #F4511E)' },
          { label: 'Community Events', icon: <Globe size={15} />, href: '/dashboard/community', color: 'linear-gradient(135deg, #E65100, #F4511E)' },
          { label: 'Appointments', icon: <CalendarDays size={15} />, href: '/dashboard/appointments', color: 'linear-gradient(135deg, #E65100, #F4511E)' },
        ]} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Users size={18} />} label="Assigned Clients" value={String(feed.clients.length)} sub="Active cases" border="border-orange-200" accent="text-orange-700" iconBg="bg-orange-100" iconColor="text-orange-700" />
        <StatCard icon={<CalendarDays size={18} />} label="Today's Contacts" value={String(appts.length)} sub="Scheduled" border="border-[#C7CBF5]" accent="text-[#6868D0]" iconBg="bg-[#EEF0FE]" iconColor="text-[#6868D0]" />
        <StatCard icon={<MessageSquare size={18} />} label="Open follow-ups" value={String(feed.tasks.length)} sub="From To-Do" border="border-amber-200" accent="text-amber-700" iconBg="bg-amber-100" iconColor="text-amber-700" />
        <StatCard icon={<Globe size={18} />} label={isCaseManager ? 'Open alerts' : 'Community'} value={isCaseManager ? String(feed.alerts.length) : '—'} sub={isCaseManager ? 'Risk queue' : 'Outreach'} border="border-teal-200" accent="text-teal-700" iconBg="bg-teal-100" iconColor="text-teal-700" />
      </div>

      <PersonalizeHomeWidgets />

      <div className="grid lg:grid-cols-2 gap-6">
        <SectionCard title="Today's Schedule" href="/dashboard/appointments">
          {appts.length === 0 ? <EmptyRows title="No contacts today" /> : (
            <div className="divide-y divide-gray-50">
              {appts.slice(0, 8).map((a) => {
                const visitStatus = asVisit(a.status);
                return (
                  <div key={a.id} className="p-4 flex items-center gap-3 hover:bg-gray-50">
                    <div className="w-14 text-center shrink-0">
                      <p className="text-sm font-bold text-gray-900">{a.startTime}</p>
                    </div>
                    <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: VISIT_DOT[visitStatus] }} />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-900">{a.clientName}</p>
                      <p className="text-xs text-gray-500">{a.type || (isCaseManager ? 'Care Coordination' : 'Peer Support Session')}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-semibold shrink-0 ${VISIT_BADGE[visitStatus]}`}>{VISIT_LABEL[visitStatus]}</span>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        {isCaseManager ? (
        <SectionCard title="Risk Alerts" href="/dashboard/alerts">
          {feed.alerts.length === 0 ? <EmptyRows title="No risk alerts" /> : (
            <div className="divide-y divide-gray-50">
              {feed.alerts.slice(0, 8).map((a) => (
                <div key={a.id} className="p-4 hover:bg-gray-50 cursor-pointer border-l-4 border-transparent hover:border-red-300 transition-all">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-sm font-bold text-orange-700 shrink-0">{(a.clientName || '?')[0]}</div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className="text-sm font-semibold text-gray-900">{a.clientName}</p>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${SEV[a.severity] || SEV.medium}`}>{a.severity}</span>
                      </div>
                      <p className="text-xs text-gray-500">{a.type}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{relativeTime(a.createdAt)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
        ) : (
        <SectionCard title="Assigned Clients" href="/dashboard/clients">
          {feed.clients.length === 0 ? <EmptyRows title="No assigned clients" /> : (
            <div className="divide-y divide-gray-50">
              {feed.clients.slice(0, 8).map((c) => (
                <Link key={c.id} href={`/dashboard/clients/${c.id}`} className="p-4 flex items-center gap-3 hover:bg-gray-50">
                  <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-sm font-bold text-orange-700 shrink-0">{(c.name || '?')[0]}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                    <p className="text-xs text-gray-500">Safety flag: {c.risk || 'low'}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
        )}
      </div>
    </div>
  );
}

function RoleHomeShell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export type RoleHomeProps = { greeting: string; name: string; role: StaffRole };

export function TherapistRoleHome({ greeting, name }: Omit<RoleHomeProps, 'role'>) {
  return (
    <RoleHomeShell>
      <TherapistHome greeting={greeting} name={name} />
    </RoleHomeShell>
  );
}
export function PsychRoleHome({ greeting, name, role = 'PSYCHIATRIST' }: RoleHomeProps) {
  return (
    <RoleHomeShell>
      <div className="mb-6">
        <TodayPanel />
      </div>
      <PsychDashboard greeting={greeting} name={name} role={role} />
    </RoleHomeShell>
  );
}
export function PRPRoleHome({ greeting, name }: Omit<RoleHomeProps, 'role'>) {
  return (
    <RoleHomeShell>
      <PRPDashboard greeting={greeting} name={name} />
    </RoleHomeShell>
  );
}
export function ClinicalSupportRoleHome({ greeting, name, role = 'CASE_MANAGER' }: RoleHomeProps) {
  return (
    <RoleHomeShell>
      <ClinicalSupportDashboard greeting={greeting} name={name} role={role} />
    </RoleHomeShell>
  );
}
export function OfficeRoleHome({ greeting, name }: Omit<RoleHomeProps, 'role'>) {
  return (
    <RoleHomeShell>
      <OfficeOpsPanel />
      <FrontDeskHuddlePanel />
      <OfficeDashboard greeting={greeting} name={name} />
    </RoleHomeShell>
  );
}
export function BillingRoleHome({ greeting, name }: Omit<RoleHomeProps, 'role'>) {
  return (
    <RoleHomeShell>
      <BillingDashboard greeting={greeting} name={name} />
    </RoleHomeShell>
  );
}
export function HRRoleHome({ greeting, name }: Omit<RoleHomeProps, 'role'>) {
  return (
    <RoleHomeShell>
      <HRDashboard greeting={greeting} name={name} />
    </RoleHomeShell>
  );
}
export function AdminRoleHome({ greeting, name }: Omit<RoleHomeProps, 'role'>) {
  return (
    <RoleHomeShell>
      <AdminDashboard greeting={greeting} name={name} />
    </RoleHomeShell>
  );
}
