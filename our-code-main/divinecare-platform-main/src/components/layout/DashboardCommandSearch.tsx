'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarClock,
  ClipboardPlus,
  FileText,
  Link2,
  Mic,
  MessageSquare,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { ClientAvatar } from '@/components/clinic/ClientAvatar';
import { fetchAppointments, todayLabel, type Appointment } from '@/features/appointments';
import { fetchClients, type Client } from '@/features/clients';
import { listStaff } from '@/features/staff/api/staffApi';
import type { StaffUser } from '@/features/staff/types';
import type { StaffRole } from '@/types/roles';
import { canAccessPath } from '@/lib/auth/roleAccess';

function normalize(value: string) {
  return value.trim().toLowerCase();
}

type NavSearchItem = { href: string; label: string; section: string };

type QuickAction = {
  id: string;
  label: string;
  href: string;
  keywords: string;
  icon: ReactNode;
};

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'intake',
    label: 'Send New Intake Link',
    href: '/dashboard/clients/intake',
    keywords: 'intake link send new digital forms',
    icon: <Link2 size={15} />,
  },
  {
    id: 'appointment',
    label: 'New Appointment',
    href: '/dashboard/appointments',
    keywords: 'new appointment schedule book',
    icon: <ClipboardPlus size={15} />,
  },
  {
    id: 'risk',
    label: 'View Risk Alerts',
    href: '/dashboard/alerts',
    keywords: 'risk alerts safety flag crisis',
    icon: <ShieldAlert size={15} />,
  },
  {
    id: 'note',
    label: 'Write Progress Note',
    href: '/dashboard/ehr/notes',
    keywords: 'progress note soap write documentation',
    icon: <FileText size={15} />,
  },
  {
    id: 'scribe',
    label: 'Start AI Scribe',
    href: '/dashboard/scribe',
    keywords: 'ai scribe dictation transcript',
    icon: <Mic size={15} />,
  },
  {
    id: 'comms',
    label: 'Communications',
    href: '/dashboard/communications',
    keywords: 'communications connect sms call message',
    icon: <MessageSquare size={15} />,
  },
];

export function DashboardCommandSearch({
  role,
  navItems = [],
}: {
  role?: StaffRole | null;
  navItems?: NavSearchItem[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const today = useMemo(() => todayLabel(), []);
  const isHrSearch = role === 'HR';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key?.toLowerCase();
      if (!key) return;
      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
      if (key === 'escape') {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }

    inputRef.current?.focus();

    if (isHrSearch && (staff.length || loading)) {
      return;
    }

    if (!isHrSearch && (clients.length || appointments.length || loading)) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    if (isHrSearch) {
      listStaff()
        .then((users) => {
          if (!cancelled) setStaff(users);
        })
        .catch(() => {
          if (!cancelled) setError('Staff search data could not be loaded.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }

    Promise.allSettled([fetchClients(), fetchAppointments()]).then((results) => {
      if (cancelled) return;

      const [clientsRes, apptsRes] = results;
      const nextClients = clientsRes.status === 'fulfilled' ? clientsRes.value : [];
      const nextAppointments = apptsRes.status === 'fulfilled' ? apptsRes.value : [];

      setClients(nextClients);
      setAppointments(nextAppointments);

      if (clientsRes.status === 'rejected' && apptsRes.status === 'rejected') {
        setError('Search data could not be loaded.');
      }

      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [appointments.length, clients.length, isHrSearch, loading, open, staff.length]);

  const q = normalize(query);

  const filteredActions = useMemo((): QuickAction[] => {
    return QUICK_ACTIONS.filter((action) => {
      if (role && !canAccessPath(role, action.href)) return false;
      if (!q) return true;
      const haystack = `${action.label} ${action.keywords}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [q, role]);

  const filteredNav = useMemo(() => {
    const allowed = navItems.filter((item) => !role || canAccessPath(role, item.href));
    if (!q) return allowed.slice(0, 10);
    return allowed
      .filter((item) => {
        const haystack = `${item.label} ${item.section} ${item.href}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 12);
  }, [navItems, q, role]);

  const filteredClients = useMemo(() => {
    const ordered = [...clients].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return ordered.slice(0, 8);
    return ordered
      .filter((client) => {
        const haystack = [
          client.name,
          client.email,
          client.phone,
          client.primaryDiagnosis,
          client.primaryDiagnosisCode,
          client.secondaryDiagnoses,
          client.assignedToName,
          client.locationName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 8);
  }, [clients, q]);

  const todayAppointments = useMemo(() => {
    const matches = appointments.filter((appt) => appt.date === today);
    if (!q) return matches.slice(0, 6);
    return matches
      .filter((appt) => {
        const haystack = [appt.clientName, appt.type, appt.clinicianName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 6);
  }, [appointments, q, today]);

  const openCount = todayAppointments.filter(
    (appt) => appt.status === 'scheduled' || appt.status === 'checked-in'
  ).length;

  const filteredStaff = useMemo(() => {
    const ordered = [...staff].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    if (!q) return ordered.slice(0, 10);
    return ordered
      .filter((user) => {
        const haystack = [
          user.name,
          user.email,
          user.role,
          user.status,
          user.primaryLocationName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 10);
  }, [q, staff]);

  const activeStaff = staff.filter((user) => user.status === 'ACTIVE').length;
  const invitedStaff = staff.filter((user) => user.status === 'INVITED').length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[#6868D0]/30 hover:text-[#141C34] hover:shadow-[0_10px_24px_rgba(20,28,52,0.08)]"
        aria-label={isHrSearch ? 'Search staff' : 'Search patient'}
      >
        <Search size={15} />
        <span className="hidden sm:inline">{isHrSearch ? 'Search staff' : 'Search patient'}</span>
        <span className="hidden rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 sm:inline">
          Ctrl+K
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[90]">
          <button
            type="button"
            aria-label="Close search"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-4 top-4 mx-auto w-full max-w-3xl overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.2)]">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#EEF0FE] text-[#6868D0]">
                <Search size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  {isHrSearch ? 'Staff search' : 'Command palette'}
                </p>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={
                    isHrSearch
                      ? 'Search staff name, email, role, location...'
                      : 'Search actions, pages, patients...'
                  }
                  className="mt-1 w-full border-0 bg-transparent p-0 text-base font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                />
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                aria-label="Close search panel"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-4">
              {isHrSearch ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                        Staff
                      </p>
                      <p className="mt-1 text-2xl font-black text-slate-900">{staff.length}</p>
                      <p className="mt-1 text-xs text-slate-500">portal accounts</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                        Active
                      </p>
                      <p className="mt-1 text-2xl font-black text-slate-900">{activeStaff}</p>
                      <p className="mt-1 text-xs text-slate-500">ready to work</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                        Invites
                      </p>
                      <p className="mt-1 text-2xl font-black text-slate-900">{invitedStaff}</p>
                      <p className="mt-1 text-xs text-slate-500">pending setup</p>
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {error}
                    </div>
                  )}

                  <section className="rounded-2xl border border-slate-200/80 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                      <div>
                        <h3 className="text-sm font-black text-slate-900">Staff directory</h3>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Search HR records by name, role, email, or location
                        </p>
                      </div>
                      <Link
                        href="/dashboard/hr"
                        onClick={() => setOpen(false)}
                        className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700"
                      >
                        HR home <ArrowRight size={14} />
                      </Link>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {loading ? (
                        <div className="px-4 py-8 text-center text-sm text-slate-500">
                          Loading staff...
                        </div>
                      ) : filteredStaff.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-slate-500">
                          No staff match your search.
                        </div>
                      ) : (
                        filteredStaff.map((user) => (
                          <Link
                            key={user.id}
                            href="/dashboard/hr"
                            onClick={() => setOpen(false)}
                            className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
                          >
                            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#EEF0FE] text-xs font-bold text-[#6868D0]">
                              {(user.name || user.email).slice(0, 1).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-semibold text-slate-900">
                                  {user.name || user.email}
                                </p>
                                <span className="clinic-badge bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
                                  {user.role.replaceAll('_', ' ')}
                                </span>
                              </div>
                              <p className="truncate text-xs text-slate-500">
                                {[user.email, user.primaryLocationName, user.status]
                                  .filter(Boolean)
                                  .join(' - ')}
                              </p>
                            </div>
                            <ArrowRight size={14} className="text-slate-400" />
                          </Link>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              ) : (
                <>
                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                        Today
                      </p>
                      <p className="mt-1 text-2xl font-black text-slate-900">
                        {todayAppointments.length}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">patients on board</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                        Open
                      </p>
                      <p className="mt-1 text-2xl font-black text-slate-900">{openCount}</p>
                      <p className="mt-1 text-xs text-slate-500">scheduled or checked in</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                        Profiles
                      </p>
                      <p className="mt-1 text-2xl font-black text-slate-900">
                        {filteredClients.length}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">matching clients</p>
                    </div>
                  </div>

                  {error && (
                    <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {error}
                    </div>
                  )}

                  <div className="space-y-4">
                    {filteredActions.length > 0 && (
                      <section className="rounded-2xl border border-slate-200/80 bg-white">
                        <div className="border-b border-slate-100 px-4 py-3">
                          <h3 className="text-sm font-black text-slate-900">Quick actions</h3>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Jump to common workflows
                          </p>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {filteredActions.map((action) => (
                            <Link
                              key={action.id}
                              href={action.href}
                              onClick={() => setOpen(false)}
                              className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
                            >
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#EEF0FE] text-[#6868D0]">
                                {action.icon}
                              </span>
                              <span className="min-w-0 flex-1 text-sm font-semibold text-slate-900">
                                {action.label}
                              </span>
                              <ArrowRight size={14} className="text-slate-400" />
                            </Link>
                          ))}
                        </div>
                      </section>
                    )}

                    {filteredNav.length > 0 && (
                      <section className="rounded-2xl border border-slate-200/80 bg-white">
                        <div className="border-b border-slate-100 px-4 py-3">
                          <h3 className="text-sm font-black text-slate-900">Pages</h3>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Search navigation sections
                          </p>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {filteredNav.map((item) => (
                            <Link
                              key={`${item.section}-${item.href}`}
                              href={item.href}
                              onClick={() => setOpen(false)}
                              className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-slate-900">
                                  {item.label}
                                </p>
                                <p className="truncate text-xs text-slate-500">{item.section}</p>
                              </div>
                              <ArrowRight size={14} className="text-slate-400" />
                            </Link>
                          ))}
                        </div>
                      </section>
                    )}

                    <section className="rounded-2xl border border-slate-200/80 bg-white">
                      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                        <div>
                          <h3 className="text-sm font-black text-slate-900">Today&apos;s patients</h3>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Open profile from the appointment board
                          </p>
                        </div>
                        <Link
                          href="/dashboard/appointments"
                          onClick={() => setOpen(false)}
                          className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700"
                        >
                          Open board <ArrowRight size={14} />
                        </Link>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {loading ? (
                          <div className="px-4 py-8 text-center text-sm text-slate-500">
                            Loading search data...
                          </div>
                        ) : todayAppointments.length === 0 ? (
                          <div className="px-4 py-8 text-center text-sm text-slate-500">
                            No matching appointments today.
                          </div>
                        ) : (
                          todayAppointments.map((appt) => (
                            <Link
                              key={appt.id}
                              href={`/dashboard/clients/${appt.clientId}`}
                              onClick={() => setOpen(false)}
                              className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
                            >
                              <ClientAvatar
                                name={appt.clientName}
                                image={appt.clientImage}
                                size="sm"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-slate-900">
                                  {appt.clientName}
                                </p>
                                <p className="truncate text-xs text-slate-500">
                                  {appt.startTime} - {appt.type}
                                </p>
                              </div>
                              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                <CalendarClock size={12} />
                                {appt.status.replace('-', ' ')}
                              </span>
                            </Link>
                          ))
                        )}
                      </div>
                    </section>

                    <section className="rounded-2xl border border-slate-200/80 bg-white">
                      <div className="border-b border-slate-100 px-4 py-3">
                        <h3 className="text-sm font-black text-slate-900">Client profiles</h3>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Search and open patient profile directly
                        </p>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {loading ? (
                          <div className="px-4 py-8 text-center text-sm text-slate-500">
                            Loading clients...
                          </div>
                        ) : filteredClients.length === 0 ? (
                          <div className="px-4 py-8 text-center text-sm text-slate-500">
                            No clients match your search.
                          </div>
                        ) : (
                          filteredClients.map((client) => (
                            <Link
                              key={client.id}
                              href={`/dashboard/clients/${client.id}`}
                              onClick={() => setOpen(false)}
                              className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
                            >
                              <ClientAvatar name={client.name} image={client.image} size="sm" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="truncate text-sm font-semibold text-slate-900">
                                    {client.name}
                                  </p>
                                  <span className="clinic-badge bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
                                    {client.risk} risk
                                  </span>
                                </div>
                                <p className="truncate text-xs text-slate-500">
                                  {[client.email, client.phone].filter(Boolean).join(' - ') ||
                                    'No contact on file'}
                                </p>
                              </div>
                              <ArrowRight size={14} className="text-slate-400" />
                            </Link>
                          ))
                        )}
                      </div>
                    </section>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
