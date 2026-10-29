'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { ClientAvatar } from '@/components/clinic/ClientAvatar';
import { Badge, EmptyState } from '@/components/clinic/ui';
import { fetchAppointments, todayLabel, type Appointment } from '@/features/appointments';
import { fetchClients } from '@/features/clients';
import { fetchConsents } from '@/features/consents/api';
import { fetchEligibilityChecks } from '@/features/ehr/eligibilityApi';
import { fetchWaitlist, type WaitlistEntry } from '@/features/waitlist/api';
import { FrontDeskHuddlePanel } from '@/components/front-desk/FrontDeskHuddlePanel';

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
    desc: 'Send or mark signed',
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
  border = 'border-slate-200',
  accent = 'text-slate-900',
  iconBg = 'bg-slate-100',
  iconColor = 'text-slate-600',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  border?: string;
  accent?: string;
  iconBg?: string;
  iconColor?: string;
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

export function FrontDeskHome({ firstName }: Props) {
  const [greeting, setGreeting] = useState('Hello');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [clientCount, setClientCount] = useState(0);
  const [clients, setClients] = useState<Array<{ id: string; locationName?: string | null }>>([]);
  const [location, setLocation] = useState('all');
  const [pendingEligibility, setPendingEligibility] = useState(0);
  const [expiringConsents, setExpiringConsents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(() => todayLabel(), []);

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.allSettled([fetchAppointments(), fetchWaitlist(), fetchClients(), fetchEligibilityChecks(), fetchConsents()])
      .then((results) => {
        if (cancelled) return;

        const [apptsRes, waitRes, clientsRes, eligRes, consentRes] = results;
        const errors: string[] = [];

        if (apptsRes.status === 'fulfilled') {
          setAppointments(apptsRes.value);
        } else {
          setAppointments([]);
          errors.push(apptsRes.reason?.message || 'Appointments failed');
        }

        if (waitRes.status === 'fulfilled') {
          setWaitlist(waitRes.value.entries);
        } else {
          setWaitlist([]);
          errors.push(waitRes.reason?.message || 'Waitlist failed');
        }

        if (clientsRes.status === 'fulfilled') {
          setClients(clientsRes.value);
          setClientCount(clientsRes.value.length);
        } else {
          setClientCount(0);
          errors.push(clientsRes.reason?.message || 'Clients failed');
        }

        if (errors.length === 3) {
          setError(errors[0] || 'Failed to load front desk data');
        }
        if (eligRes.status === 'fulfilled') {
          setPendingEligibility(eligRes.value.filter((row) => row.status === 'PENDING' || row.status === 'ERROR').length);
        }
        if (consentRes.status === 'fulfilled') {
          const soon = Date.now() + 30 * 86400000;
          setExpiringConsents(consentRes.value.filter((row) => row.expiresAt && new Date(row.expiresAt).getTime() <= soon).length);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const locations = [...new Set(clients.map((client) => client.locationName).filter(Boolean))] as string[];
  const visibleIds = new Set(clients.filter((client) => location === 'all' || client.locationName === location).map((client) => client.id));
  const todayAppts = appointments.filter((appointment) => appointment.date === today && appointment.status !== 'cancelled' && appointment.status !== 'late-cancel' && (location === 'all' || visibleIds.has(appointment.clientId)));
  const remaining = todayAppts.filter(
    (a) => a.status === 'scheduled' || a.status === 'checked-in'
  );
  const checkedIn = todayAppts.filter((a) => a.status === 'checked-in');
  const waiting = waitlist.filter((e) => e.status === 'waiting');
  const urgentWaiting = waiting.filter(
    (e) => e.urgency === 'urgent' || e.urgency === 'crisis'
  );

  const displayName = firstName?.trim() || 'there';

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Loading front desk...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {greeting}, {displayName}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Scheduling, check-in, intake, and waitlist
          </p>
          <label className="mt-2 block text-xs font-semibold text-slate-600">
            Location
            <select className="ml-2 rounded-lg border border-slate-300 px-2 py-1 text-sm" value={location} onChange={(event) => setLocation(event.target.value)}>
              <option value="all">All locations</option>
              {locations.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end sm:gap-3">
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
          ].map((a) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #37474F, #546E7A)' }}
            >
              {a.icon}
              <span>{a.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <FrontDeskHuddlePanel />
      <p className="text-xs text-slate-500">
        Summary: {remaining.length} visits still open today · {pendingEligibility} eligibility pending ·{' '}
        {expiringConsents} consents expiring within 30 days.
      </p>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Calendar size={18} />}
          label="Today's Appointments"
          value={String(todayAppts.length)}
          sub={`${remaining.length} remaining`}
          border="border-gray-200"
          accent="text-gray-700"
          iconBg="bg-gray-100"
          iconColor="text-gray-600"
        />
        <StatCard
          icon={<CheckCircle2 size={18} />}
          label="Checked In"
          value={String(checkedIn.length)}
          sub="Arrived today"
          border="border-blue-200"
          accent="text-blue-700"
          iconBg="bg-blue-100"
          iconColor="text-blue-700"
        />
        <StatCard
          icon={<ListOrdered size={18} />}
          label="Waitlist Waiting"
          value={String(waiting.length)}
          sub={`${urgentWaiting.length} urgent`}
          border="border-amber-200"
          accent="text-amber-700"
          iconBg="bg-amber-100"
          iconColor="text-amber-700"
        />
        <StatCard
          icon={<Users size={18} />}
          label="Active Clients"
          value={String(clientCount)}
          sub="Client roster"
          border="border-slate-200"
          accent="text-slate-700"
          iconBg="bg-slate-100"
          iconColor="text-slate-600"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">Quick actions</h2>
            <p className="mt-0.5 text-xs text-slate-500">Main front desk tasks</p>
          </div>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href + action.title}
                href={action.href}
                className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 transition hover:border-slate-300 hover:bg-slate-50"
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

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">Today&apos;s board</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {remaining.length} remaining · {checkedIn.length} checked in
              </p>
            </div>
            <Link
              href="/dashboard/appointments"
              className="shrink-0 text-xs font-semibold text-[#6868D0] hover:underline"
            >
              Open board
            </Link>
          </div>
          {todayAppts.length === 0 ? (
            <EmptyState
              title="No appointments today"
              description="Schedule one to see it on the board."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {todayAppts.slice(0, 6).map((appt) => (
                <div key={appt.id} className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-slate-50">
                  <div className="w-14 shrink-0">
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {appt.startTime}
                    </p>
                  </div>
                  <ClientAvatar name={appt.clientName} image={appt.clientImage} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {appt.clientName}
                    </p>
                    <p className="truncate text-xs text-slate-500">{appt.type}</p>
                  </div>
                  <Badge
                    tone={
                      appt.status === 'checked-in'
                        ? 'violet'
                        : appt.status === 'completed'
                          ? 'slate'
                          : 'blue'
                    }
                  >
                    {appt.status.replace('-', ' ')}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">Waitlist</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {waiting.length} waiting
                {urgentWaiting.length > 0 ? ` · ${urgentWaiting.length} urgent` : ''}
              </p>
            </div>
            <Link
              href="/dashboard/clients/waitlist"
              className="shrink-0 text-xs font-semibold text-[#6868D0] hover:underline"
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
                <div key={entry.id} className="flex items-start gap-3 px-5 py-3.5 transition hover:bg-slate-50">
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
