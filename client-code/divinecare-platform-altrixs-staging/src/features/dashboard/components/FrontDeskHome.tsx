'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileCheck,
  ListOrdered,
  MessageSquare,
  Shield,
  Users,
} from 'lucide-react';
import { Badge, EmptyState } from '@/components/clinic/ui';
import { Alert, LoadingState, PageHeader, StatCard as UiStatCard, buttonClasses, type Tone } from '@/components/ui';
import { fetchWaitlist, type WaitlistEntry } from '@/features/waitlist/api';
import { FrontDeskHuddle } from '@/components/frontOffice/FrontDeskHuddle';
import { HomeTileCard, useCounter } from './HomeWidgets';
import { useDashboardHome } from '../hooks/useDashboardHome';

const QUICK_ACTIONS = [
  {
    href: '/dashboard/appointments?new=1',
    title: 'Schedule',
    desc: 'Book a new appointment',
    icon: Calendar,
  },
  {
    href: '/dashboard/clients/intake',
    title: 'Intake',
    desc: 'Start digital intake',
    icon: ClipboardList,
  },
  {
    href: '/dashboard/clients/waitlist',
    title: 'Waitlist',
    desc: 'Add or match clients',
    icon: ListOrdered,
  },
  {
    href: '/dashboard/clients',
    title: 'Clients',
    desc: 'Browse client roster',
    icon: Users,
  },
  {
    href: '/dashboard/messages',
    title: 'Messages',
    desc: 'Client conversations',
    icon: MessageSquare,
  },
  {
    href: '/dashboard/ehr/consents',
    title: 'Consents',
    desc: 'Missing, expiring, send packets',
    icon: FileCheck,
  },
  {
    href: '/dashboard/ehr/eligibility',
    title: 'Eligibility',
    desc: 'Verify coverage',
    icon: Shield,
  },
  {
    href: '/dashboard/appointments',
    title: 'Check-in',
    desc: "Today's arrival board",
    icon: CheckCircle2,
  },
] as const;

type Props = {
  firstName?: string | null;
};

function StatCard({
  icon,
  label,
  value,
  sub,
  href,
  title,
  border = 'border-slate-200',
  accent = 'text-slate-900',
  iconBg = 'bg-slate-100',
  iconColor = 'text-slate-600',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  /** List the number comes from */
  href?: string;
  /** Data source, shown on hover */
  title?: string;
  border?: string;
  accent?: string;
  iconBg?: string;
  iconColor?: string;
}) {
  const tone: Tone = /rose/.test(accent ?? '') ? 'danger' : /amber/.test(accent ?? '') ? 'warning' : /emerald/.test(accent ?? '') ? 'success' : /sky/.test(accent ?? '') ? 'info' : /blue/.test(accent ?? '') ? 'brand' : 'neutral';
  void border; void iconBg; void iconColor;
  return (
    <div title={title} className="min-w-0">
      <UiStatCard icon={icon} label={label} value={value} hint={sub} href={href} tone={tone} className="h-full" />
    </div>
  );
}

export function FrontDeskHome({ firstName }: Props) {
  const [greeting, setGreeting] = useState('Hello');
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [waitlistLoading, setWaitlistLoading] = useState(true);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  // Today's board + counts: server practice-day window (GET /api/dashboard/home), every clinician
  // or the sidebar location. Active clients: server count, not the length of a loaded list.
  const home = useDashboardHome();
  const schedule = home.data?.schedule ?? null;
  const activeClientsTile = useCounter('active_clients');
  const newClientsTile = useCounter('new_clients_7d');
  const loading = waitlistLoading && home.loading;
  const error = home.error && waitlistError ? home.error : null;

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWaitlistLoading(true);
    fetchWaitlist()
      .then((res) => {
        if (!cancelled) setWaitlist(res.entries);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setWaitlist([]);
          setWaitlistError(err instanceof Error ? err.message : 'Waitlist failed');
        }
      })
      .finally(() => {
        if (!cancelled) setWaitlistLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const waiting = waitlist.filter((e) => e.status === 'waiting');
  const urgentWaiting = waiting.filter(
    (e) => e.urgency === 'urgent' || e.urgency === 'crisis'
  );

  const displayName = firstName?.trim() || 'there';

  if (loading) {
    return <LoadingState label="Loading front desk…" className="min-h-[40vh]" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>{greeting}, {displayName}</>}
        description="Huddle, check-in, check-out and end of day"
        actions={<>
          {[
            {
              label: 'New Appointment',
              icon: <Calendar size={15} />,
              href: '/dashboard/appointments?new=1',
            },
            {
              label: 'Start Intake',
              icon: <ClipboardList size={15} />,
              href: '/dashboard/clients/intake',
            },
            {
              label: 'Check-in Board',
              icon: <CheckCircle2 size={15} />,
              href: '/dashboard/appointments',
            },
          ].map((a, i) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className={buttonClasses({ variant: i === 0 ? 'primary' : 'secondary' })}
            >
              {a.icon}
              <span>{a.label}</span>
            </Link>
          ))}
        </>}
      />

      {error && (
        <Alert tone="danger">{error}</Alert>
      )}

      {/* Huddle: today / prep tomorrow / end of day, every visit with its readiness checks */}
      <FrontDeskHuddle />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={<Calendar size={18} />}
          label="Today's Appointments"
          value={schedule ? String(schedule.counts.total) : '—'}
          sub={schedule ? `${schedule.counts.remaining} remaining` : undefined}
          href="/dashboard/appointments"
          title="Non-cancelled appointments starting today (practice midnight to midnight), every clinician or the selected location."
          border="border-slate-200"
          accent="text-slate-700"
          iconBg="bg-slate-100"
          iconColor="text-slate-600"
        />
        <StatCard
          icon={<CheckCircle2 size={18} />}
          label="Checked In"
          value={schedule ? String(schedule.counts.checkedIn) : '—'}
          sub={schedule ? `${schedule.counts.completed} completed · ${schedule.counts.noShow} no-show` : undefined}
          href="/dashboard/appointments"
          title="Today's appointments with status Checked in."
          border="border-blue-200"
          accent="text-blue-700"
          iconBg="bg-blue-100"
          iconColor="text-blue-700"
        />
        <StatCard
          icon={<ListOrdered size={18} />}
          label="Waitlist Waiting"
          value={waitlistError ? '—' : String(waiting.length)}
          sub={`${urgentWaiting.length} urgent`}
          href="/dashboard/clients/waitlist"
          title="Waitlist entries with status Waiting (urgent = urgent or crisis)."
          border="border-amber-200"
          accent="text-amber-700"
          iconBg="bg-amber-100"
          iconColor="text-amber-700"
        />
        {activeClientsTile ? <HomeTileCard tile={activeClientsTile} icon={<Users size={18} />} /> : null}
        {newClientsTile ? <HomeTileCard tile={newClientsTile} icon={<ClipboardList size={18} />} /> : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Quick actions</h2>
            <p className="mt-0.5 text-xs text-slate-500">Main front desk tasks</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href + action.title}
                href={action.href}
                className="group flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3.5 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <Icon size={16} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{action.title}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{action.desc}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>


      <div className="grid gap-6">

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Waitlist</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {waiting.length} waiting
                {urgentWaiting.length > 0 ? ` · ${urgentWaiting.length} urgent` : ''}
              </p>
            </div>
            <Link
              href="/dashboard/clients/waitlist"
              className="shrink-0 text-xs font-semibold text-blue-700 hover:underline"
            >
              Manage
            </Link>
          </div>
          {waiting.length === 0 ? (
            <EmptyState
              title="Waitlist is empty"
              description="Add a referral when someone is waiting for a clinician."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {waiting.slice(0, 6).map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 px-4 py-3.5 transition hover:bg-slate-50 sm:px-5">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                    <Clock size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{entry.name}</p>
                      <Badge tone={entry.urgency === 'routine' ? 'slate' : 'amber'}>
                        {entry.urgency}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {entry.specialty}
                      {entry.insurancePayer ? ` · ${entry.insurancePayer}` : ''} ·{' '}
                      {entry.daysWaiting}d waiting
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
