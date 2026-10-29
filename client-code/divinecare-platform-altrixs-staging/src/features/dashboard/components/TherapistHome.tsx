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
  PenLine,
  Shield,
  Video,
} from 'lucide-react';
import { EmptyState, LoadingState, PageHeader, StatCard as UiStatCard, StatusBadge, buttonClasses, cx, type Tone } from '@/components/ui';
import { FOCUS_RING } from '@/components/ui/tokens';
import type { Appointment } from '@/features/appointments';
import { practiceZoneLabel } from '@/lib/time/practiceTime';
import { AppointmentLabelChip } from '@/components/scheduling/AppointmentLabelChip';
import {
  feedCount,
  relativeTime,
  tasksOf,
  useRoleHomeFeed,
  type HomeTask,
  type RoleHomeFeed,
} from '@/features/dashboard/hooks/useRoleHomeFeed';
import { useMessages } from '@/features/messages';
import { CaseloadHealthPanel, HomeTileCard } from '@/features/dashboard/components/HomeWidgets';
import { useDashboardHome } from '@/features/dashboard/hooks/useDashboardHome';
import { PreVisitBriefButton } from '@/components/ai/PreVisitBriefButton';
import { StartVisitButton } from '@/components/visits/StartVisitButton';
import { MyNotesQueue } from '@/components/notes/MyNotesQueue';
import { TodayPanel } from '@/features/dashboard/components/TodayPanel';

type NoteStatus = Appointment['noteStatus'];

const SEV: Record<string, Tone> = {
  high: 'danger',
  medium: 'warning',
  low: 'success',
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

const VISIT_TONE: Record<string, Tone> = {
  scheduled: 'neutral',
  'checked-in': 'info',
  'in-session': 'brand',
  completed: 'success',
  'no-show': 'warning',
  cancelled: 'danger',
  'late-cancel': 'warning',
};

const NOTE_BADGE: Record<NoteStatus, { tone: Tone; label: string }> = {
  'not-started': { tone: 'warning', label: 'Note Due' },
  'ai-draft': { tone: 'brand', label: 'AI Draft' },
  'in-progress': { tone: 'info', label: 'In Progress' },
  signed: { tone: 'success', label: 'Signed' },
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
    return typeof stress === 'number' ? `High stress (${stress}/10)` : 'High stress';
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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
        <h2 className="min-w-0 truncate text-sm font-semibold text-slate-900">{title}</h2>
        {href ? (
          <Link href={href} className={cx("shrink-0 rounded text-xs font-semibold text-blue-700 hover:underline", FOCUS_RING)}>
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
  href,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: 'teal' | 'red' | 'amber' | 'purple';
  /** List the number comes from */
  href?: string;
  /** Data source, shown on hover */
  title?: string;
}) {
  const toneMap: Record<typeof tone, Tone> = { teal: 'info', red: 'danger', amber: 'warning', purple: 'brand' };
  return (
    <div title={title} className="min-w-0">
      <UiStatCard icon={icon} label={label} value={value} hint={sub} href={href} tone={toneMap[tone]} className="h-full" />
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
  // Never assume "signed": only the server-derived note status (linked signed note) says so.
  return 'not-started';
}

function parseNoteRow(task: HomeTask) {
  const raw = task.dueDate || task.description || '';
  // "Today · 10:00 AM SOAP" or "Yesterday · 2:00 PM DAP"
  const soap = /\bSOAP\b/i.test(raw) || /\bSOAP\b/i.test(task.description || '');
  const dap = /\bDAP\b/i.test(raw) || /\bDAP\b/i.test(task.description || '');
  // Only a format named on the task; never an assumed SOAP.
  const noteType = dap ? 'DAP' : soap ? 'SOAP' : '';
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
  const home = useDashboardHome();
  // PHQ-9 / GAD-7 due comes from the server caseload aggregate (no scored measure in 90 days)
  const measurementTile = home.data?.caseloadHealth?.tiles.find((t) => t.key === 'measurement_due') ?? null;
  const unsigned = tasksOf(feed, ['unsigned_note', 'missing_note']);
  const plans = tasksOf(feed, ['expiring_treatment_plan']);
  // No-shows (own visits) still waiting for the No-Show note: outreach + risk review
  const noShows = tasksOf(feed, ['no_show']);
  // Every visit today: the schedule is where "Start visit" lives (no hidden sixth session)
  const scheduleRows = feed.todayAppts;
  // Cancelled visits are not sessions
  const sessionsToday = feed.todayAppts.filter((a) => a.status !== 'cancelled');
  const remaining = feed.todayAppts.filter((a) => a.status === 'scheduled' || a.status === 'checked-in').length;
  // Past the practice sign deadline (task daysUntil is measured to the deadline)
  const overdueNotes = unsigned.filter((t) => (t.daysUntil ?? 0) < 0).length;

  const unreviewedHighAlerts = feed.alerts.filter((a) => a.severity === 'high' && !a.reviewed);
  // The alerts' recorded types, not a fixed "Suicidal Ideation / Crisis Escalation" label.
  const highAlertTypes = [
    ...new Set(
      unreviewedHighAlerts
        .map((a) => String(a.type || '').replace(/_/g, ' ').trim())
        .filter(Boolean)
        .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    ),
  ];
  const recentThreads = threads.slice(0, 3);
  const unreadTotal = threads.reduce((acc, t) => acc + (t.unreadCount || 0), 0);

  if (feed.loading) {
    return <LoadingState label="Loading dashboard…" className="min-h-[40vh]" />;
  }

  return (
    <div className="space-y-6">
      {/* Top Unreviewed High-Severity Risk Alert Strip */}
      {unreviewedHighAlerts.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-600" />
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle aria-hidden className="h-5 w-5 shrink-0 text-rose-700" />
              <span className="text-sm font-semibold text-rose-900">
                {unreviewedHighAlerts.length} High-Severity Risk Alert{unreviewedHighAlerts.length > 1 ? 's Require' : ' Requires'} Immediate Review
              </span>
              {highAlertTypes.length > 0 && (
                <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-rose-800 ring-1 ring-inset ring-rose-200">
                  {highAlertTypes.slice(0, 3).join(' / ')}
                  {highAlertTypes.length > 3 ? ` +${highAlertTypes.length - 3} more` : ''}
                </span>
              )}
            </div>
          </div>
          <Link
            href="/dashboard/alerts"
            className={buttonClasses({ variant: 'danger', size: 'sm' })}
          >
            Review Alerts Now <ArrowRight aria-hidden size={14} />
          </Link>
        </div>
      )}

      {/* Header */}
      <PageHeader
        title={<>{greeting}, {name}</>}
        description={<>Here&apos;s what needs your attention today</>}
        actions={<>
          {[
            { label: 'New Appointment', icon: <CalendarDays size={15} />, href: '/dashboard/appointments?new=1' },
            { label: 'My Notes', icon: <FileText size={15} />, href: '/dashboard/ehr/notes' },
            { label: 'Check Eligibility', icon: <Shield size={15} />, href: '/dashboard/ehr/eligibility' },
            {
              label: 'Treatment Plans',
              icon: <ClipboardList size={15} />,
              href: '/dashboard/ehr/treatment-plans',
            },
          ].map((a, i) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className={buttonClasses({ variant: i === 0 ? 'primary' : 'secondary' })}
            >
              {a.icon}
              {a.label}
            </Link>
          ))}
        </>}
      />

      {/* Today: visits timeline, status lights, one next action each (GET /api/dashboard/today) */}
      <TodayPanel />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<CalendarDays size={18} />}
          label="Today's Sessions"
          value={feedCount(feed, 'appointments', sessionsToday.length)}
          sub={`${remaining} remaining`}
          tone="teal"
          href="/dashboard/appointments"
          title="Your caseload's appointments today on the practice clock (cancelled visits excluded)."
        />
        <StatCard
          icon={<PenLine size={18} />}
          label="Unsigned Notes"
          value={feedCount(feed, 'tasks', feed.unsignedNoteCount ?? unsigned.length)}
          sub={`${overdueNotes} overdue`}
          tone="red"
          href="/dashboard/ehr/notes?tab=drafts"
          title="Your unsigned notes; overdue = past the practice sign deadline."
        />
        <StatCard
          icon={<ClipboardList size={18} />}
          label="Plans Expiring Soon"
          value={feedCount(feed, 'tasks', plans.length)}
          sub="Review due within 45 days"
          tone="amber"
          href="/dashboard/ehr/treatment-plans"
          title="Active treatment plans whose review date is within 45 days (or past), for your clients."
        />
        {measurementTile ? (
          // Clinicians cannot open Population health: the measurement-based care page lists who is due
          <HomeTileCard tile={{ ...measurementTile, href: measurementTile.href ?? '/dashboard/mbc' }} icon={<BarChart3 size={18} />} />
        ) : null}
      </div>

      <MyNotesQueue />

      <CaseloadHealthPanel />

      {/* Risk + Schedule */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SectionCard title="Risk Alerts" href="/dashboard/alerts">
          {feed.alerts.length === 0 ? (
            <EmptyState title="No risk alerts" description="Unreviewed alerts will appear here." />
          ) : (
            <div className="divide-y divide-slate-100">
              {feed.alerts.slice(0, 3).map((a) => (
                <Link
                  key={a.id}
                  href={a.clientId ? `/dashboard/clients/${a.clientId}` : '/dashboard/alerts'}
                  className={`block border-l-4 p-4 transition hover:bg-slate-50 ${
                    a.severity === 'high' ? 'border-rose-400' : 'border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                      {shortClientName(a.clientName)[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {shortClientName(a.clientName)}
                        </p>
                        <StatusBadge tone={SEV[a.severity] || SEV.medium} className="shrink-0">
                          {a.severity}
                        </StatusBadge>
                      </div>
                      <p className="text-xs text-slate-500">{alertTypeLabel(a.type, a.stress)}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {relativeTime(a.createdAt)}{typeof a.mood === 'number' ? ` · Mood ${a.mood}/10` : ''}
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
              <div className="divide-y divide-slate-100">
                {scheduleRows.map((a) => {
                  const noteStatus = noteStatusFor(a, feed);
                  const showNote =
                    a.status === 'completed' ||
                    a.status === 'in-session' ||
                    noteStatus === 'ai-draft' ||
                    noteStatus === 'signed';
                  return (
                    <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 hover:bg-slate-50 sm:flex-nowrap sm:px-5">
                      <div className="w-[4.5rem] shrink-0">
                        <p className="text-sm font-semibold text-slate-900">
                          {formatTime12h(a.startTime)}{' '}
                          <span className="text-[11px] font-medium text-slate-500">{practiceZoneLabel(a.timeZone ?? feed.timeZone)}</span>
                        </p>
                        {a.isVirtual ? (
                          <span className="mt-0.5 flex items-center gap-0.5 text-[11px] font-medium text-sky-700">
                            <Video aria-hidden size={12} /> Virtual
                          </span>
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          <Link
                            href={`/dashboard/clients/${a.clientId}`}
                            className="hover:text-blue-700 hover:underline"
                          >
                            {shortClientName(a.clientName)}
                          </Link>
                        </p>
                        <p className="text-xs text-slate-500">{a.type}</p>
                      {a.label ? <AppointmentLabelChip label={a.label} size="xs" className="mt-0.5" /> : null}
                      </div>
                      <StatusBadge tone={VISIT_TONE[a.status] || 'neutral'} dot className="shrink-0">
                        {VISIT_LABEL[a.status] || a.status}
                      </StatusBadge>
                      {a.status !== 'cancelled' && a.status !== 'no-show' ? <PreVisitBriefButton clientId={a.clientId} clientLabel={shortClientName(a.clientName)} /> : null}
                      <StartVisitButton
                        appointment={{ ...a, timeZone: a.timeZone ?? feed.timeZone, noteStatus }}
                        size="xs"
                      />
                      {showNote ? (
                        <StatusBadge tone={NOTE_BADGE[noteStatus].tone} icon={<NoteBadgeIcon status={noteStatus} />} className="shrink-0">
                          {NOTE_BADGE[noteStatus].label}
                        </StatusBadge>
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
            <div className="divide-y divide-slate-100">
              {recentThreads.map((thread) => (
                <Link
                  key={thread.id}
                  href={`/dashboard/messages?client=${thread.clientId}`}
                  className="block p-4 transition hover:bg-slate-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                      {shortClientName(thread.clientName)[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {shortClientName(thread.clientName)}
                        </p>
                        {thread.unreadCount > 0 ? (
                          <StatusBadge tone="brand" className="shrink-0">
                            {thread.unreadCount} new
                          </StatusBadge>
                        ) : (
                          <span className="text-[11px] text-slate-500">
                            {thread.lastMessageTime || 'Recent'}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-500">
                        {thread.lastMessage || 'No message preview'}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <StatusBadge size="sm">
                          {thread.topic || 'clinical'}
                        </StatusBadge>
                        {thread.risk === 'high' ? (
                          <StatusBadge tone="danger" size="sm">
                            High Risk
                          </StatusBadge>
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
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th scope="col" className="px-5 py-3 text-left">Client</th>
                    <th scope="col" className="px-5 py-3 text-left">Date / Type</th>
                    <th scope="col" className="px-5 py-3 text-left">Status</th>
                    <th scope="col" className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {unsigned.map((n) => {
                    const overdue = (n.daysUntil ?? 0) < 0;
                    const row = parseNoteRow(n);
                    return (
                      <tr key={n.taskId} className="hover:bg-slate-50">
                        <td className="px-5 py-3.5 text-sm font-semibold text-slate-900">
                          {shortClientName(n.clientName)}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-500">
                          {row.datePart}
                          <br />
                          <span className="font-semibold text-slate-700">{row.noteType}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <StatusBadge tone={
                              overdue ? 'danger' : 'warning'
                            }>
                            {n.type === 'missing_note' ? 'No note yet' : overdue ? 'Overdue' : 'Unsigned'}
                          </StatusBadge>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Link
                            href={n.actionHref || '/dashboard/ehr/notes'}
                            className="text-xs font-semibold text-blue-700 hover:underline"
                          >
                            {n.type === 'missing_note' ? 'Write note' : 'Open & sign'} <ArrowRight aria-hidden size={12} className="inline" />
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
      </div>

      {/* No-show outreach */}
      {noShows.length > 0 ? (
        <SectionCard title="No-shows to follow up" href="/dashboard/appointments">
          <div className="divide-y divide-slate-100">
            {noShows.slice(0, 6).map((t) => (
              <div key={t.taskId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{shortClientName(t.clientName)}</p>
                  <p className="text-xs text-slate-500">{t.description}</p>
                </div>
                <Link href={t.actionHref} className="shrink-0 text-xs font-semibold text-blue-700 hover:underline">
                  {t.actionLabel} <ArrowRight aria-hidden size={12} className="inline" />
                </Link>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

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
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th scope="col" className="px-5 py-3 text-left">Client</th>
                  <th scope="col" className="px-5 py-3 text-left">Plan</th>
                  <th scope="col" className="px-5 py-3 text-left">Review Date</th>
                  <th scope="col" className="px-5 py-3 text-left">Days Left</th>
                  <th scope="col" className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plans.map((p) => (
                  <tr key={p.taskId} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5 text-sm font-semibold text-slate-900">
                      {shortClientName(p.clientName)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-600">
                      {p.description || p.title}
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
                      <StatusBadge tone={
                          (p.daysUntil ?? 99) <= 7
                            ? 'danger'
                            : 'warning'
                        }>
                        {p.daysUntil ?? '—'}d
                      </StatusBadge>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        href={p.actionHref || '/dashboard/ehr/treatment-plans'}
                        className="text-xs font-semibold text-blue-700 hover:underline"
                      >
                        Review <ArrowRight aria-hidden size={12} className="inline" />
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
