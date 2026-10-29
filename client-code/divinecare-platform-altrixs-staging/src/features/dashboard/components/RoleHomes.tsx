'use client';

import Link from 'next/link';
import {
  AlertTriangle, ArrowRight, CalendarDays, ClipboardList, FileText, BarChart3,
  PenLine, Shield, Pill, Bot, CheckCircle2, Lock, Video,
  Users, DollarSign, XCircle, Plus, Microscope, Target, MessageSquare,
  Globe, UserCircle, Briefcase, GraduationCap, Megaphone,
} from 'lucide-react';
import { Card, CardHeader, EmptyState, PageHeader, StatCard as UiStatCard, LoadingState, StatusBadge, buttonClasses, cx, type Tone } from '@/components/ui';
import { FOCUS_RING } from '@/components/ui/tokens';
import type { Appointment } from '@/features/appointments';
import type { ScheduleRow } from '@/lib/dashboard/todaySchedule';
import { formatWallClock, practiceZoneLabel } from '@/lib/time/practiceTime';
import { AppointmentLabelChip } from '@/components/scheduling/AppointmentLabelChip';
import {
  consentsExpiring,
  feedCount,
  formatCents,
  pendingEligibility,
  relativeTime,
  tasksOf,
  useRoleHomeFeed,
  type RoleHomeFeed,
} from '@/features/dashboard/hooks/useRoleHomeFeed';
import { TherapistHome } from '@/features/dashboard/components/TherapistHome';
import { CaseloadHealthPanel, CounterTiles, HomeTileCard } from '@/features/dashboard/components/HomeWidgets';
import { useDashboardHome } from '@/features/dashboard/hooks/useDashboardHome';
import type { StaffRole } from '@/types/roles';
import { PreVisitBriefButton } from '@/components/ai/PreVisitBriefButton';
import { StartVisitButton } from '@/components/visits/StartVisitButton';
import { MyNotesQueue } from '@/components/notes/MyNotesQueue';
import { TodayPanel } from '@/features/dashboard/components/TodayPanel';
import { useAuth } from '@/features/auth';
import { ownScheduleRows } from '@/lib/dashboard/ownSchedule';
import { OfficeOperationsPanel } from '@/components/frontOffice/OfficeOperationsPanel';
import { FrontDeskHuddle } from '@/components/frontOffice/FrontDeskHuddle';

const SEV: Record<string, Tone> = {
  high: 'danger',
  medium: 'warning',
  low: 'success',
};

function StatCard({ icon, label, value, sub, href, title, tone = 'neutral' }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  /** List the number comes from */
  href?: string;
  /** Data source, shown on hover */
  title?: string;
  tone?: Tone;
}) {
  return (
    <div title={title} className="min-w-0">
      <UiStatCard icon={icon} label={label} value={value} hint={sub} href={href} tone={tone} className="h-full" />
    </div>
  );
}

function SectionCard({ title, href, linkLabel = 'View all', children }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={title}
        actions={href ? (
          <Link href={href} className={cx('shrink-0 rounded text-xs font-semibold text-blue-700 hover:underline', FOCUS_RING)}>
            {linkLabel}
          </Link>
        ) : null}
      />
      {children}
    </Card>
  );
}

function QuickActionBar({ actions }: { actions: { label: string; icon: React.ReactNode; href: string }[] }) {
  return (
    <>
      {actions.map((a, i) => (
        <Link
          key={i}
          href={a.href}
          className={buttonClasses({ variant: i === actions.length - 1 ? 'primary' : 'secondary' })}
        >
          {a.icon}
          <span>{a.label}</span>
        </Link>
      ))}
    </>
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

const VISIT_LABEL: Record<VisitStatus, string> = {
  scheduled: 'Scheduled', 'checked-in': 'Checked In', 'in-session': 'In Session', completed: 'Seen', 'no-show': 'No-Show', cancelled: 'Cancelled', 'late-cancel': 'Late Cancel',
};
const VISIT_TONE: Record<VisitStatus, Tone> = {
  scheduled: 'neutral', 'checked-in': 'info', 'in-session': 'brand',
  completed: 'success', 'no-show': 'warning', cancelled: 'danger', 'late-cancel': 'warning',
};
const NOTE_BADGE: Record<NoteStatus, { tone: Tone; label: string }> = {
  'not-started': { tone: 'warning', label: 'Note Due' },
  'ai-draft':    { tone: 'brand', label: 'AI Draft' },
  'in-progress': { tone: 'info', label: 'In Progress' },
  signed:        { tone: 'success', label: 'Signed' },
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
  // Never assume "signed": only the server-derived note status (linked signed note) says so.
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

/** Distinct types of the unreviewed high-severity alerts, as recorded (e.g. "Suicidal ideation"). */
function highAlertTypes(feed: RoleHomeFeed): string[] {
  const types = feed.alerts
    .filter((a) => a.severity === 'high' && !a.reviewed)
    .map((a) => String(a.type || '').replace(/_/g, ' ').trim())
    .filter(Boolean)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
  return [...new Set(types)];
}

function UnreviewedRiskAlertStrip({ count, types }: { count: number; types: string[] }) {
  if (count <= 0) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900 sm:px-5">
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-600" />
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle aria-hidden className="h-5 w-5 shrink-0 text-rose-700" />
          <span className="text-sm font-semibold text-rose-900">
            {count} High-Severity Risk Alert{count > 1 ? 's Require' : ' Requires'} Immediate Review
          </span>
          {types.length > 0 && (
            <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-rose-800 ring-1 ring-inset ring-rose-200">
              {types.slice(0, 3).join(' / ')}
              {types.length > 3 ? ` +${types.length - 3} more` : ''}
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
  );
}

function AppointmentRows({ feed, appointments, compact }: { feed: RoleHomeFeed; appointments: Appointment[]; compact?: boolean }) {
  return (
    <div className="divide-y divide-slate-100">
      {appointments.map((a) => {
        const visitStatus = asVisit(a.status);
        const noteStatus = noteStatusFor(a, feed);
        const showNote =
          !compact &&
          (visitStatus === 'completed' || visitStatus === 'in-session' || noteStatus !== 'not-started');
        return (
          <div key={a.id} className="flex flex-wrap items-center gap-3 p-4 hover:bg-slate-50 sm:flex-nowrap">
            <div className="w-16 shrink-0 text-center">
              <p className="text-sm font-semibold text-slate-900">{formatWallClock(a.startTime)} <span className="text-[11px] font-medium text-slate-500">{practiceZoneLabel(a.timeZone ?? feed.timeZone)}</span></p>
              {a.isVirtual ? (
                compact ? (
                  <span className="text-xs text-sky-700">Virtual</span>
                ) : (
                  <span className="flex items-center justify-center gap-0.5 text-xs text-sky-700">
                    <Video aria-hidden size={12} /> Virtual
                  </span>
                )
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">
                {a.clientId ? (
                  <Link href={`/dashboard/clients/${a.clientId}`} className="hover:text-blue-700 hover:underline">
                    {a.clientName}
                  </Link>
                ) : (
                  a.clientName
                )}
              </p>
              <p className="text-xs text-slate-500">{a.type}</p>
                      {a.label ? <AppointmentLabelChip label={a.label} size="xs" className="mt-0.5" /> : null}
            </div>
            <StatusBadge tone={VISIT_TONE[visitStatus]} dot className="shrink-0">
              {VISIT_LABEL[visitStatus]}
            </StatusBadge>
            {visitStatus !== 'cancelled' && visitStatus !== 'no-show' ? <PreVisitBriefButton clientId={a.clientId} clientLabel={a.clientName} /> : null}
            <StartVisitButton appointment={{ ...a, timeZone: a.timeZone ?? feed.timeZone, noteStatus }} size="xs" />
            {showNote ? (
              <StatusBadge tone={NOTE_BADGE[noteStatus].tone} icon={<NoteBadgeIcon status={noteStatus} />} className="shrink-0">
                {NOTE_BADGE[noteStatus].label}
              </StatusBadge>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PRPDashboard({ greeting, name }: { greeting: string; name: string }) {
  const feed = useRoleHomeFeed();
  const kept = feed.todayAppts.filter((a) => a.status !== 'cancelled');
  const prpVisits = kept.filter((a) => a.type.toLowerCase().includes('prp'));
  const visits = prpVisits.length ? prpVisits : kept;
  const notesDue = tasksOf(feed, ['unsigned_note', 'missing_note']);
  const done = visits.filter((v) => v.status === 'completed').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>{greeting}, {name}</>}
        description="PRP client visits and rehabilitation tracking"
        actions={<QuickActionBar actions={[
          { label: 'New Service Note', icon: <FileText size={15} />, href: '/dashboard/ehr/notes' },
          { label: 'Rehab Plans', icon: <ClipboardList size={15} />, href: '/dashboard/ehr/treatment-plans' },
          { label: 'PRP Program', icon: <Target size={15} />, href: '/dashboard/prp' },
        ]} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Users size={18} />} label="Your caseload" value={feedCount(feed, 'activeClients', feed.activeClients)} sub="Active cases" href="/dashboard/clients" title="Server count of Active clients on your care team, same rule as the client list (not the length of a loaded list)." tone="info" />
        <StatCard icon={<CalendarDays size={18} />} label="Today's Visits" value={feedCount(feed, 'appointments', visits.length)} sub={`${done} completed`} href="/dashboard/appointments" title="Today's PRP visits for your caseload on the practice clock (all visits when none are typed PRP); cancelled excluded." tone="brand" />
        <StatCard icon={<FileText size={18} />} label="Service Notes Due" value={feedCount(feed, 'tasks', notesDue.length)} sub="From To-Do" href="/dashboard/ehr/notes" title="Unsigned and missing-note items on your To-Do list." tone="danger" />
        <StatCard icon={<Target size={18} />} label="Open tasks" value={feedCount(feed, 'tasks', feed.tasks.length)} sub="From To-Do" href="/dashboard/tasks" title="Everything on your To-Do list (GET /api/tasks)." tone="success" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CounterTiles
          keys={['prp_participants', 'prp_attendance_today', 'prp_no_attendance', 'prp_irp_due', 'prp_referrals_pending', 'prp_transitioning', 'sdoh_open']}
          icons={{ prp_participants: <Users size={18} />, prp_attendance_today: <CheckCircle2 size={18} />, prp_no_attendance: <AlertTriangle size={18} />, prp_irp_due: <ClipboardList size={18} />, prp_referrals_pending: <FileText size={18} />, prp_transitioning: <ArrowRight size={18} />, sdoh_open: <Globe size={18} /> }}
        />
      </div>

      <CaseloadHealthPanel />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Today's Visit Schedule" href="/dashboard/appointments">
          {visits.length === 0 ? <EmptyRows title="No visits today" /> : (
            <div className="divide-y divide-slate-100">
              {visits.map((v) => (
                <div key={v.id} className={`p-4 flex flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-4 hover:bg-slate-50 ${v.status === 'completed' ? 'opacity-50' : ''}`}>
                  <div className="w-16 text-center shrink-0">
                    <p className="text-sm font-semibold text-slate-900">{formatWallClock(v.startTime)} <span className="text-[11px] font-medium text-slate-500">{practiceZoneLabel(v.timeZone ?? feed.timeZone)}</span></p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{v.clientName}</p>
                    <p className="text-xs text-slate-500">{v.type}</p>
                  </div>
                  <StatusBadge className="shrink-0" tone={v.status === 'completed' ? 'success' : 'info'}>
                    {v.status === 'completed' ? 'Done' : 'Upcoming'}
                  </StatusBadge>
                  <StartVisitButton appointment={{ ...v, timeZone: v.timeZone ?? feed.timeZone, noteStatus: noteStatusFor(v, feed) }} size="xs" />
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Notes Needing Follow-up" href="/dashboard/prp">
          {notesDue.length === 0 ? <EmptyRows title="No notes due" /> : (
            <div className="divide-y divide-slate-100">
              {notesDue.map((c) => (
                <div key={c.taskId} className="p-4 flex items-center gap-3 sm:gap-4 hover:bg-slate-50">
                  <div className="w-8 h-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-sm font-semibold text-slate-700">{(c.clientName || '?')[0]}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{c.clientName || '—'}</p>
                    <p className="text-xs text-slate-500">{c.title}</p>
                  </div>
                  <StatusBadge className="shrink-0" tone="danger">Note Due</StatusBadge>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title={`Assigned Clients${feed.activeClients > 12 ? ` (12 of ${feed.activeClients.toLocaleString('en-US')})` : ''}`} href="/dashboard/clients">
        {feed.clients.length === 0 ? <EmptyRows title="No assigned clients" /> : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <th scope="col" className="text-left px-5 py-3">Client</th>
              <th scope="col" className="text-left px-5 py-3">Today</th>
              <th scope="col" className="text-left px-5 py-3">Note Status</th>
              <th scope="col" className="px-5 py-3" />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {feed.clients.slice(0, 12).map((c) => {
                const todayCount = visits.filter((v) => v.clientName === c.name).length;
                const due = notesDue.some((t) => t.clientName === c.name);
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-700">{(c.name || '?')[0]}</div>
                        <span className="text-sm font-semibold text-slate-900">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">{todayCount} visits</td>
                    <td className="px-5 py-3">
                      <StatusBadge tone={due ? 'danger' : 'success'}>
                        {due ? 'Due' : 'Up to date'}
                      </StatusBadge>
                    </td>
                    <td className="px-5 py-3">
                      <Link href={`/dashboard/ehr/notes?clientId=${encodeURIComponent(c.id)}`} className="text-xs text-blue-700 hover:underline font-semibold">Write Note <ArrowRight aria-hidden size={12} className="inline" /></Link>
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

function PsychDashboard({ greeting, name }: { greeting: string; name: string; role: StaffRole }) {
  const feed = useRoleHomeFeed();
  // role: PSYCHIATRIST or NP (same home; the Medical Director flag widens chart scope, not this list)
  const home = useDashboardHome();
  const healthTile = (key: string) => home.data?.caseloadHealth?.tiles.find((t) => t.key === key) ?? null;
  const rxTile = healthTile('rx_requests');
  const labTile = healthTile('lab_results');
  const { user } = useAuth();
  // The prescriber's own visits (care-team scope also returns the therapists' visits for shared clients)
  const psychAppts = ownScheduleRows(feed.todayAppts.filter((a) => a.status !== 'cancelled'), user?.id ?? null);
  const evals = psychAppts.filter((a) => /psychiatric|medication|med mgmt|med review|re-?eval/i.test(a.type)).length;
  const unreviewedHigh = feed.alerts.filter((a) => a.severity === 'high' && !a.reviewed).length;

  return (
    <div className="space-y-6">
      <UnreviewedRiskAlertStrip count={unreviewedHigh} types={highAlertTypes(feed)} />
      <PageHeader
        title={<>{greeting}, {name}</>}
        description="Medication management and psychiatric follow-ups"
        actions={<QuickActionBar actions={[
          { label: 'Prescriptions & renewals', icon: <Pill size={15} />, href: '/dashboard/ehr/prescriptions' },
          { label: 'Lab results to review', icon: <Microscope size={15} />, href: '/dashboard/inbox?section=lab_results' },
          { label: 'My Notes', icon: <FileText size={15} />, href: '/dashboard/ehr/notes' },
        ]} />}
      />

      {/* Today: the prescriber's own visits, status lights, one next action each */}
      <TodayPanel />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<CalendarDays size={18} />} label="Today's Appointments" value={feedCount(feed, 'appointments', psychAppts.length)} sub={`${evals} med / psych visits`} href="/dashboard/appointments" title="Your own appointments today on the practice clock (cancelled visits excluded)." tone="brand" />
        {rxTile ? <HomeTileCard tile={rxTile} icon={<ClipboardList size={18} />} /> : null}
        <CounterTiles keys={['active_medications']} icons={{ active_medications: <Pill size={18} /> }} />
        {labTile ? <HomeTileCard tile={labTile} icon={<Microscope size={18} />} /> : null}
      </div>

      <SectionCard title="Today's Schedule" href="/dashboard/appointments">
        {psychAppts.length === 0 ? <EmptyRows title="No appointments today" /> : (
          <AppointmentRows feed={feed} appointments={psychAppts} />
        )}
      </SectionCard>

      <MyNotesQueue title="My documentation and co-signatures" />

      <CaseloadHealthPanel title="Clinical Caseload Health" />
    </div>
  );
}

function OfficeDashboard({ greeting, name }: { greeting: string; name: string }) {
  const feed = useRoleHomeFeed();
  const rawElig = pendingEligibility(feed);
  const rawConsents = consentsExpiring(feed);

  const elig = rawElig;
  const consents = rawConsents;
  // Today's counts come from the server practice-day window (same rows as the schedule below)
  const schedule = useDashboardHome().data?.schedule ?? null;

  const displayName = name;

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>{greeting}, {displayName}</>}
        description="Scheduling, intake, eligibility, and consents"
        actions={<QuickActionBar actions={[
          { label: 'Schedule Appt', icon: <CalendarDays size={15} />, href: '/dashboard/appointments' },
          { label: 'Check Eligibility', icon: <Shield size={15} />, href: '/dashboard/ehr/eligibility' },
          { label: 'Send Consent', icon: <PenLine size={15} />, href: '/dashboard/ehr/consents' },
        ]} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<CalendarDays size={18} />} label="Today's Appointments" value={schedule ? String(schedule.counts.total) : '—'} sub={schedule ? `${schedule.counts.remaining} remaining · ${schedule.counts.checkedIn} checked in` : 'All providers'} href="/dashboard/appointments" title="Non-cancelled appointments starting today (practice midnight to midnight), every clinician or the selected location." tone="neutral" />
        <CounterTiles keys={['new_clients_7d']} icons={{ new_clients_7d: <UserCircle size={18} /> }} />
        <StatCard icon={<Shield size={18} />} label="Pending Eligibility" value={feedCount(feed, 'eligibility', rawElig.length)} sub="Needs verification" href="/dashboard/ehr/eligibility" title="Eligibility checks in Pending or Error status." tone="warning" />
        <StatCard icon={<PenLine size={18} />} label="Consents Expiring" value={feedCount(feed, 'consents', rawConsents.length)} sub="Within 30 days" href="/dashboard/ehr/consents" title="Signed consents with an expiry date within the next 30 days (or already past)." tone="danger" />
      </div>

      {/* Operations: readiness by location, exceptions queue, waitlist fill, notes past due, staff invites */}
      <OfficeOperationsPanel />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Eligibility Verification Needed" href="/dashboard/ehr/eligibility">
          {elig.length === 0 ? <EmptyRows title="No eligibility checks pending" /> : (
          <div className="divide-y divide-slate-100">
            {elig.map((e) => (
              <div key={e.id} className="p-4 flex items-center gap-3 sm:gap-4 hover:bg-slate-50">
                <div className="w-8 h-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-sm font-semibold text-slate-700">{(e.clientName || '?')[0]}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{e.clientName}</p>
                  <p className="text-xs text-slate-500 truncate">{e.payerName} &middot; DOS {e.dos}</p>
                </div>
                <StatusBadge tone={e.status === 'ERROR' ? 'danger' : 'warning'} className="shrink-0">
                  {e.status === 'ERROR' ? 'Failed' : 'Pending'}
                </StatusBadge>
                <Link href="/dashboard/ehr/eligibility" className="text-xs text-blue-700 hover:underline font-semibold shrink-0">Verify <ArrowRight aria-hidden size={12} className="inline" /></Link>
              </div>
            ))}
          </div>
          )}
        </SectionCard>

        <SectionCard title="Consents Expiring Soon" href="/dashboard/ehr/consents">
          {consents.length === 0 ? <EmptyRows title="No consents expiring soon" /> : (
          <div className="divide-y divide-slate-100">
            {consents.map((c) => (
              <div key={c.id} className="p-4 flex items-center gap-3 sm:gap-4 hover:bg-slate-50">
                <div className="w-8 h-8 shrink-0 rounded-full bg-blue-50 flex items-center justify-center text-sm font-semibold text-blue-700">{(c.clientName || '?')[0]}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{c.clientName}</p>
                  <p className="text-xs text-slate-500 truncate">{c.type}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Expires {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}</p>
                </div>
                <StatusBadge tone={c.days <= 7 ? 'danger' : 'warning'} className="shrink-0">
                  {c.days}d
                </StatusBadge>
                <Link href="/dashboard/ehr/consents" className="text-xs text-blue-700 hover:underline font-semibold shrink-0">Renew <ArrowRight aria-hidden size={12} className="inline" /></Link>
              </div>
            ))}
          </div>
          )}
        </SectionCard>
      </div>

      {/* Same huddle as the front desk: every visit today / tomorrow with its readiness checks */}
      <FrontDeskHuddle title="Front desk huddle (all front-office work)" />
    </div>
  );
}

function BillingDashboard({ greeting, name }: { greeting: string; name: string }) {
  const feed = useRoleHomeFeed();
  const rawElig = pendingEligibility(feed);

  // Needs action = not yet final: draft / ready to submit / denied. Paid, accepted and submitted
  // claims are waiting on the payer, not on staff.
  const claims = feed.claims.filter((c) => ['DRAFT', 'READY', 'DENIED'].includes(String(c.status)));
  const elig = rawElig;

  const displayName = name;

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>{greeting}, {displayName}</>}
        description="Claims, insurance, and revenue management"
        actions={<QuickActionBar actions={[
          { label: 'New Claim', icon: <Plus size={15} />, href: '/dashboard/billing' },
          { label: 'Run Eligibility', icon: <Shield size={15} />, href: '/dashboard/ehr/eligibility' },
          { label: 'View Denials', icon: <XCircle size={15} />, href: '/dashboard/billing/denials' },
        ]} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Server counts with real date windows (claims list below is a preview, not the denominator) */}
        <CounterTiles
          keys={['claims_7d', 'claims_denied', 'paid_7d', 'collections_mtd']}
          icons={{
            claims_7d: <ClipboardList size={18} />,
            claims_denied: <XCircle size={18} />,
            paid_7d: <CheckCircle2 size={18} />,
            collections_mtd: <BarChart3 size={18} />,
          }}
        />
      </div>

      <SectionCard title="Claims Needing Action" href="/dashboard/billing">
        {feed.failed.includes('claims') ? (
          <EmptyState title="Claims could not load" description="Reload the page to try again." />
        ) : claims.length === 0 ? <EmptyRows title="No claims need action" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <th scope="col" className="text-left px-5 py-3">Client Name</th>
              <th scope="col" className="text-left px-5 py-3">CPT Code</th>
              <th scope="col" className="text-left px-5 py-3">Date of Service</th>
              <th scope="col" className="text-left px-5 py-3">Payer</th>
              <th scope="col" className="text-left px-5 py-3">Amount</th>
              <th scope="col" className="text-left px-5 py-3">Status</th>
              <th scope="col" className="px-5 py-3">Action</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {claims.slice(0, 12).map((c) => {
                const isDenied = c.status === 'DENIED';
                const statusBadgeCls: Tone = isDenied ? 'danger' : 'warning';
                // The claim's real status (Draft / Ready / Denied), not a collapsed "Pending".
                const statusLabel = String(c.status).charAt(0) + String(c.status).slice(1).toLowerCase();

                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm font-semibold text-slate-900">{c.clientName}</td>
                    <td className="px-5 py-3 text-xs font-mono font-bold text-slate-700">{c.cptCode}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{c.serviceDate ? new Date(c.serviceDate).toLocaleDateString() : '—'}</td>
                    <td className="px-5 py-3 text-xs text-slate-600 font-medium">{c.payer || '—'}</td>
                    <td className="px-5 py-3 text-sm font-bold text-slate-900">{formatCents(c.amountCents)}</td>
                    <td className="px-5 py-3">
                      <StatusBadge tone={statusBadgeCls}>
                        {statusLabel}
                      </StatusBadge>
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={isDenied ? '/dashboard/billing/denials' : '/dashboard/billing'}
                        className={`text-xs font-semibold hover:underline ${isDenied ? 'text-rose-700' : 'text-blue-700'}`}
                      >
                        {isDenied ? 'Appeal' : 'View'} <ArrowRight aria-hidden size={12} className="inline" />
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

      <SectionCard title="Eligibility Verification Queue" href="/dashboard/ehr/eligibility">
        {elig.length === 0 ? <EmptyRows title="No eligibility checks pending" /> : (
        <div className="divide-y divide-slate-100">
          {elig.map((e) => (
            <div key={e.id} className="p-4 flex items-center gap-3 sm:gap-4 hover:bg-slate-50">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{e.clientName}</p>
                <p className="text-xs text-slate-500 truncate">{e.payerName} &middot; DOS {e.dos}</p>
              </div>
              <StatusBadge tone={e.status === 'ERROR' ? SEV.high : SEV.medium} className="shrink-0">
                {e.status === 'ERROR' ? 'Failed' : 'Pending'}
              </StatusBadge>
              <Link href="/dashboard/ehr/eligibility" className="text-xs text-blue-700 hover:underline font-semibold shrink-0">Verify <ArrowRight aria-hidden size={12} className="inline" /></Link>
            </div>
          ))}
        </div>
        )}
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
      <PageHeader
        title={<>{greeting}, {name}</>}
        description="Staff management, credentialing, and training"
        actions={<QuickActionBar actions={[
          { label: 'View Staff', icon: <Users size={15} />, href: '/dashboard/hr' },
          { label: 'Credentialing', icon: <Shield size={15} />, href: '/dashboard/hr/credentialing' },
          { label: 'Add Training', icon: <GraduationCap size={15} />, href: '/dashboard/hr/training' },
        ]} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Users size={18} />} label="Total Staff" value={feedCount(feed, 'staff', feed.staff.length)} sub={`${activeStaff.length} active`} href="/dashboard/hr" title="Staff accounts in this organization (staff directory)." tone="brand" />
        <StatCard icon={<Briefcase size={18} />} label="Licenses Expiring" value={feedCount(feed, 'credentials', expiring.length)} sub="Within 90 days" href="/dashboard/hr/credentialing" title="Staff credentials expiring within 90 days (or already expired)." tone="warning" />
        <StatCard icon={<GraduationCap size={18} />} label="CEUs due" value={feedCount(feed, 'credentials', training.length)} sub="Credential CEUs" href="/dashboard/hr/training" title="CEU credentials due within 90 days." tone="danger" />
        <CounterTiles keys={['job_requisitions']} icons={{ job_requisitions: <Megaphone size={18} /> }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Credentials Expiring" href="/dashboard/hr/credentialing">
          {expiring.length === 0 ? <EmptyRows title="No credentials expiring soon" /> : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th scope="col" className="text-left px-5 py-3">Staff Member</th>
                <th scope="col" className="text-left px-5 py-3">Credential</th>
                <th scope="col" className="text-left px-5 py-3">Expires</th>
                <th scope="col" className="text-left px-5 py-3">Days Left</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {expiring.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm font-semibold text-slate-900">{c.staffName}</td>
                    <td className="px-5 py-3 text-xs font-semibold text-slate-600">{c.title}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{new Date(c.expiresAt).toLocaleDateString()}</td>
                    <td className="px-5 py-3">
                      <StatusBadge tone={c.daysUntilExpiry <= 30 ? 'danger' : c.daysUntilExpiry <= 60 ? 'warning' : 'success'}>
                        {c.daysUntilExpiry}d
                      </StatusBadge>
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
            <div className="divide-y divide-slate-100">
              {training.map((t) => (
                <div key={t.id} className="p-4 flex items-center gap-3 sm:gap-4 hover:bg-slate-50">
                  <div className="w-8 h-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-sm font-semibold text-slate-700">{(t.staffName || '?')[0]}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{t.staffName}</p>
                    <p className="text-xs text-slate-500">{t.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">Due {new Date(t.expiresAt).toLocaleDateString()}</p>
                  </div>
                  <StatusBadge className="shrink-0" tone={t.daysUntilExpiry < 0 ? 'danger' : 'warning'}>
                    {t.daysUntilExpiry < 0 ? 'Overdue' : 'Due Soon'}
                  </StatusBadge>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/**
 * Staff Productivity rows: staff directory + today's schedule (practice day) + unsigned notes per
 * author from the server. Nothing is attributed to "Unassigned" that the data does not say.
 */
function staffProductivityRows(
  feed: RoleHomeFeed,
  rows: ScheduleRow[],
  unsigned: { clinicianId: string; name: string; unsigned: number; overdue7d?: number }[] | null
) {
  const map = new Map<string, { name: string; role: string; sessions: number; notes: number; unsigned: number; overdue7d: number }>();
  const keyOf = (id: string | null | undefined, name: string | null | undefined) => id || `name:${(name || '').trim().toLowerCase()}`;
  for (const s of feed.staff) {
    if (s.status === 'DEACTIVATED') continue;
    const name = s.name?.trim() || s.email.trim();
    if (!name) continue;
    map.set(keyOf(s.id, name), { name, role: String(s.role).replace(/_/g, ' '), sessions: 0, notes: 0, unsigned: 0, overdue7d: 0 });
  }
  for (const a of rows) {
    const k = a.clinicianId || a.clinicianName ? keyOf(a.clinicianId, a.clinicianName) : 'unassigned';
    const row = map.get(k) ?? { name: a.clinicianName?.trim() || 'Unassigned', role: 'Staff', sessions: 0, notes: 0, unsigned: 0, overdue7d: 0 };
    row.sessions += 1;
    if (a.status === 'completed') row.notes += 1;
    map.set(k, row);
  }
  for (const u of unsigned ?? []) {
    const row = map.get(u.clinicianId) ?? { name: u.name, role: 'Staff', sessions: 0, notes: 0, unsigned: 0, overdue7d: 0 };
    row.unsigned = u.unsigned;
    row.overdue7d = u.overdue7d ?? 0;
    map.set(u.clinicianId, row);
  }
  return [...map.values()].sort((a, b) => b.sessions - a.sessions || b.unsigned - a.unsigned || a.name.localeCompare(b.name));
}

function AdminDashboard({ greeting, name }: { greeting: string; name: string }) {
  const feed = useRoleHomeFeed();
  const home = useDashboardHome();
  const schedule = home.data?.schedule ?? null;
  const prod = staffProductivityRows(feed, schedule?.rows ?? [], home.data?.staffUnsigned ?? null);
  const unreviewedHigh = feed.alerts.filter((a) => a.severity === 'high' && !a.reviewed).length;
  const clinicians = new Set((schedule?.rows ?? []).map((a) => a.clinicianId || a.clinicianName).filter(Boolean)).size;

  return (
    <div className="space-y-4 sm:space-y-6">
      <UnreviewedRiskAlertStrip count={unreviewedHigh} types={highAlertTypes(feed)} />
      <PageHeader
        title={<>{greeting}, {name}</>}
        description="Practice overview — staff, clients, billing, compliance"
        actions={<QuickActionBar
          actions={[
            { label: 'Clinical Insights', icon: <Bot size={15} />, href: '/dashboard/ai-insights' },
            { label: 'Reports', icon: <BarChart3 size={15} />, href: '/dashboard/reports' },
            { label: 'Compliance', icon: <Lock size={15} />, href: '/dashboard/compliance' },
          ]}
        />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CounterTiles keys={['active_clients']} icons={{ active_clients: <Users size={18} /> }} />
        <StatCard
          icon={<CalendarDays size={18} />}
          label="Sessions Today"
          value={schedule ? String(schedule.counts.total) : '—'}
          sub={schedule ? `Across ${clinicians} clinicians · ${schedule.counts.completed} completed` : undefined}
          href="/dashboard/appointments"
          title="Non-cancelled appointments starting today on the practice clock, every clinician (or the selected location)." tone="info"
        />
        <CounterTiles keys={['collections_mtd', 'open_alerts']} icons={{ collections_mtd: <DollarSign size={18} />, open_alerts: <AlertTriangle size={18} /> }} />
      </div>

      <CaseloadHealthPanel />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:gap-6">
        <SectionCard title="Risk Alerts" href="/dashboard/alerts">
          {feed.alerts.length === 0 ? (
            <EmptyRows title="No risk alerts" />
          ) : (
            <div className="divide-y divide-slate-100">
              {feed.alerts.slice(0, 8).map((a) => (
                <Link
                  key={a.id}
                  href="/dashboard/alerts"
                  className="block border-l-4 border-transparent p-4 transition-all hover:border-rose-300 hover:bg-slate-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                      {(a.clientName || '?')[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">{a.clientName}</p>
                        <StatusBadge tone={SEV[a.severity] || SEV.medium} className="shrink-0">
                          {a.severity}
                        </StatusBadge>
                      </div>
                      <p className="truncate text-xs text-slate-500">{a.type}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{relativeTime(a.createdAt)}</p>
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
                    <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th scope="col" className="px-4 py-3 text-left sm:px-5">Client</th>
                      <th scope="col" className="px-4 py-3 text-left sm:px-5">CPT</th>
                      <th scope="col" className="px-4 py-3 text-left sm:px-5">Payer</th>
                      <th scope="col" className="px-4 py-3 text-left sm:px-5">Amount</th>
                      <th scope="col" className="px-4 py-3 text-left sm:px-5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
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
                          <StatusBadge tone={claimTone(c.status)}>
                            {c.status.toLowerCase()}
                          </StatusBadge>
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
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th scope="col" className="px-4 py-3 text-left sm:px-5">Staff Member</th>
                  <th scope="col" className="px-4 py-3 text-left sm:px-5">Role</th>
                  <th scope="col" className="px-4 py-3 text-left sm:px-5">Sessions</th>
                  <th scope="col" className="px-4 py-3 text-left sm:px-5" title="Today's appointments with status Completed">Completed</th>
                  <th scope="col" className="px-4 py-3 text-left sm:px-5" title="Progress notes this person wrote that are still unsigned past the practice signing deadline (all dates)">Unsigned notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
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
                        <StatusBadge tone="danger">
                          {s.unsigned}
                        </StatusBadge>
                      ) : null}
                      {s.overdue7d > 0 ? (
                        <span
                          className="ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200"
                          title="Unsigned more than 7 days past the signing deadline (escalated)"
                        >
                          {s.overdue7d} &gt; 7 days
                        </span>
                      ) : null}
                      {s.unsigned > 0 ? null : (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100">
                          <CheckCircle2 size={12} className="text-emerald-600" />
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
  const appts = feed.todayAppts.filter((a) => a.status !== 'cancelled');
  const unreviewedHigh = feed.alerts.filter((a) => a.severity === 'high' && !a.reviewed).length;

  return (
    <div className="space-y-6">
      <UnreviewedRiskAlertStrip count={unreviewedHigh} types={highAlertTypes(feed)} />
      <PageHeader
        title={<>{greeting}, {name}</>}
        description={<>{isCaseManager ? 'Care coordination and client support' : 'Peer support and community outreach'}</>}
        actions={<QuickActionBar actions={[
          { label: 'Messages', icon: <MessageSquare size={15} />, href: '/dashboard/messages' },
          { label: 'Community Events', icon: <Globe size={15} />, href: '/dashboard/community' },
          { label: 'Appointments', icon: <CalendarDays size={15} />, href: '/dashboard/appointments' },
        ]} />}
      />

      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${isCaseManager ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <StatCard icon={<Users size={18} />} label="Your caseload" value={feedCount(feed, 'activeClients', feed.activeClients)} sub="Active cases" href="/dashboard/clients" title="Server count of Active clients on your care team, same rule as the client list (not the length of a loaded list)." tone="warning" />
        <StatCard icon={<CalendarDays size={18} />} label="Today's Contacts" value={feedCount(feed, 'appointments', appts.length)} sub="Scheduled today" href="/dashboard/appointments" title="Your caseload's appointments today on the practice clock (cancelled visits excluded)." tone="brand" />
        <StatCard icon={<MessageSquare size={18} />} label="Open follow-ups" value={feedCount(feed, 'tasks', feed.tasks.length)} sub="From To-Do" href="/dashboard/tasks" title="Everything on your To-Do list (GET /api/tasks)." tone="warning" />
        {/* Peer support has no alerts access; the old "Community —" placeholder tile is gone */}
        {isCaseManager ? <CounterTiles keys={['open_alerts']} icons={{ open_alerts: <AlertTriangle size={18} /> }} /> : null}
      </div>

      {isCaseManager ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CounterTiles keys={['plan_reviews_due', 'sdoh_open']} icons={{ plan_reviews_due: <ClipboardList size={18} />, sdoh_open: <Globe size={18} /> }} />
        </div>
      ) : null}
      {/* Peer support: contacts, goals and placements are pending the /api/peer data work; only tiles with a real source are shown */}

      <CaseloadHealthPanel title={isCaseManager ? 'Caseload Health' : 'Outreach Caseload Health'} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Today's Schedule" href="/dashboard/appointments">
          {appts.length === 0 ? <EmptyRows title="No contacts today" /> : (
            <div className="divide-y divide-slate-100">
              {appts.slice(0, 8).map((a) => {
                const visitStatus = asVisit(a.status);
                return (
                  <div key={a.id} className="p-4 flex items-center gap-3 hover:bg-slate-50">
                    <div className="w-14 text-center shrink-0">
                      <p className="text-sm font-semibold text-slate-900">{formatWallClock(a.startTime)} <span className="text-[11px] font-medium text-slate-500">{practiceZoneLabel(a.timeZone ?? feed.timeZone)}</span></p>
                    </div>
                                        <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{a.clientName}</p>
                      <p className="text-xs text-slate-500">{a.type || (isCaseManager ? 'Care Coordination' : 'Peer Support Session')}</p>
                    </div>
                    <StatusBadge tone={VISIT_TONE[visitStatus]} dot className="shrink-0">{VISIT_LABEL[visitStatus]}</StatusBadge>
                    <StartVisitButton appointment={{ ...a, timeZone: a.timeZone ?? feed.timeZone, noteStatus: noteStatusFor(a, feed) }} size="xs" />
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        {isCaseManager ? (
        <SectionCard title="Risk Alerts" href="/dashboard/alerts">
          {feed.alerts.length === 0 ? <EmptyRows title="No risk alerts" /> : (
            <div className="divide-y divide-slate-100">
              {feed.alerts.slice(0, 8).map((a) => (
                <Link
                  key={a.id}
                  href={a.clientId ? `/dashboard/clients/${a.clientId}` : '/dashboard/alerts'}
                  className="block p-4 hover:bg-slate-50 border-l-4 border-transparent hover:border-rose-300 transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-sm font-semibold text-slate-700">{(a.clientName || '?')[0]}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className="text-sm font-semibold text-slate-900 truncate">{a.clientName}</p>
                        <StatusBadge className="shrink-0" tone={SEV[a.severity] || SEV.medium}>{a.severity}</StatusBadge>
                      </div>
                      <p className="text-xs text-slate-500">{a.type}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{relativeTime(a.createdAt)}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
        ) : (
        <SectionCard title="Assigned Clients" href="/dashboard/clients">
          {feed.clients.length === 0 ? <EmptyRows title="No assigned clients" /> : (
            <div className="divide-y divide-slate-100">
              {feed.clients.slice(0, 8).map((c) => (
                <Link key={c.id} href={`/dashboard/clients/${c.id}`} className="p-4 flex items-center gap-3 hover:bg-slate-50">
                  <div className="w-8 h-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-sm font-semibold text-slate-700 shrink-0">{(c.name || '?')[0]}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                    <p className="text-xs text-slate-500">Open chart</p>
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
  const feed = useRoleHomeFeed();
  if (feed.loading) {
    return <LoadingState label="Loading dashboard…" className="min-h-[40vh]" />;
  }
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
