'use client';

import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchRiskAlerts } from '@/features/alerts/api/alertsApi';
import type { RiskAlert } from '@/features/alerts/types';
import { fetchAppointmentsWithZone, type Appointment } from '@/features/appointments';
import { DEFAULT_PRACTICE_TIME_ZONE, practiceToday } from '@/lib/time/practiceTime';
import { fetchClaims, type ClaimRecord } from '@/features/billing/claimsApi';
import { fetchPayments } from '@/features/billing/ledgerApi';
import { fetchClients } from '@/features/clients';
import { fetchClientPage } from '@/features/clients/api/clientsApi';
import type { Client } from '@/features/clients/types';
import { fetchConsents, type ConsentItem } from '@/features/consents/api';
import { fetchEligibilityChecks, type EligibilityCheckRecord } from '@/features/ehr/eligibilityApi';
import { fetchStaffCredentials, type StaffCredentialRecord } from '@/features/hr/credentialsApi';
import { listStaff, type StaffUser } from '@/features/staff';
import { fetchWaitlist, type WaitlistEntry } from '@/features/waitlist/api';
import { apiJson } from '@/lib/api-client';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { useAuth } from '@/features/auth';
import type { StaffRole } from '@/types/roles';

export type HomeTask = {
  taskId: string;
  type: string;
  title: string;
  clientName?: string;
  dueDate?: string;
  daysUntil?: number;
  description?: string;
  priority?: string;
  actionLabel?: string;
  actionHref?: string;
};

export type RoleHomeFeed = {
  loading: boolean;
  todayAppts: Appointment[];
  /** Practice time zone the appointments' date / startTime are on (from the appointments API). */
  timeZone: string;
  alerts: RiskAlert[];
  tasks: HomeTask[];
  claims: ClaimRecord[];
  eligibility: EligibilityCheckRecord[];
  consents: ConsentItem[];
  waitlist: WaitlistEntry[];
  credentials: StaffCredentialRecord[];
  staff: StaffUser[];
  clients: Client[];
  paymentsCents: number;
  /** Server count of ACTIVE clients in the viewer's scope (not clients.length, which is capped at 250) */
  activeClients: number;
  /** Server count of unsigned (draft) progress notes; null when not loaded */
  unsignedNoteCount: number | null;
  /** Sources whose request failed: their tiles show "—" (not 0) and a warning is shown. */
  failed: FeedSource[];
};

export type FeedSource =
  | 'appointments'
  | 'alerts'
  | 'tasks'
  | 'clients'
  | 'activeClients'
  | 'claims'
  | 'eligibility'
  | 'consents'
  | 'waitlist'
  | 'credentials'
  | 'staff'
  | 'payments';

const SOURCE_LABEL: Record<FeedSource, string> = {
  appointments: 'appointments',
  alerts: 'risk alerts',
  tasks: 'to-do items',
  clients: 'clients',
  activeClients: 'client count',
  claims: 'claims',
  eligibility: 'eligibility checks',
  consents: 'consents',
  waitlist: 'waitlist',
  credentials: 'staff credentials',
  staff: 'staff directory',
  payments: 'payments',
};

/** Tile value: "—" when that source failed to load, otherwise the count. */
export function feedCount(feed: RoleHomeFeed, source: FeedSource, value: number): string {
  return feed.failed.includes(source) ? '—' : value.toLocaleString('en-US');
}

const EMPTY: RoleHomeFeed = {
  loading: false,
  todayAppts: [],
  timeZone: DEFAULT_PRACTICE_TIME_ZONE,
  alerts: [],
  tasks: [],
  claims: [],
  eligibility: [],
  consents: [],
  waitlist: [],
  credentials: [],
  staff: [],
  clients: [],
  paymentsCents: 0,
  activeClients: 0,
  unsignedNoteCount: null,
  failed: [],
};

const Ctx = createContext<RoleHomeFeed>(EMPTY);

/** Resolves to the fallback on failure and records the failed source (never a silent 0). */
function settledInto(failed: FeedSource[]) {
  return async function settled<T>(promise: Promise<T>, fallback: T, source?: FeedSource): Promise<T> {
    try {
      return await promise;
    } catch {
      if (source && !failed.includes(source)) failed.push(source);
      return fallback;
    }
  };
}

function skip<T>(fallback: T): Promise<T> {
  return Promise.resolve(fallback);
}

function allowStaffDirectory(role: StaffRole) {
  return role === 'ADMIN' || role === 'DIRECTOR' || role === 'HR';
}

function allowBillingOverview(role: StaffRole) {
  return role === 'ADMIN' || role === 'DIRECTOR' || role === 'BILLING';
}

export function RoleHomeFeedProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const role = user?.role;
  const [feed, setFeed] = useState<RoleHomeFeed>({ ...EMPTY, loading: true });

  useEffect(() => {
    if (authLoading) return;
    if (!role) {
      setFeed({ ...EMPTY, loading: false });
      return;
    }

    let cancelled = false;
    // Practice-clock day (not the viewer's browser day); the API reads `date` on the practice clock.
    const today = practiceToday(DEFAULT_PRACTICE_TIME_ZONE);
    const failed: FeedSource[] = [];
    const settled = settledInto(failed);

    (async () => {
      const wave1 = await Promise.all([
        canAccessPath(role, '/dashboard/appointments')
          ? settled(fetchAppointmentsWithZone({ date: today }), { appointments: [] as Appointment[], timeZone: DEFAULT_PRACTICE_TIME_ZONE }, 'appointments')
          : skip({ appointments: [] as Appointment[], timeZone: DEFAULT_PRACTICE_TIME_ZONE }),
        canAccessPath(role, '/dashboard/alerts')
          ? settled(fetchRiskAlerts(true).then((d) => d.alerts), [] as RiskAlert[], 'alerts')
          : skip([] as RiskAlert[]),
      ]);
      const wave1b = await Promise.all([
        canAccessPath(role, '/dashboard/tasks')
          ? settled(
              apiJson<{ success: true; tasks: HomeTask[]; counts?: { unsignedNotes?: number } }>('/api/tasks').then((d) => ({
                tasks: d.tasks,
                unsignedNotes: typeof d.counts?.unsignedNotes === 'number' ? d.counts.unsignedNotes : null,
              })),
              { tasks: [] as HomeTask[], unsignedNotes: null as number | null },
              'tasks'
            )
          : skip({ tasks: [] as HomeTask[], unsignedNotes: null as number | null }),
        canAccessPath(role, '/dashboard/clients')
          ? settled(fetchClients(), [] as Client[], 'clients')
          : skip([] as Client[]),
        // True active count (server count, caseload-scoped like the list); `clients` is only the first 250
        canAccessPath(role, '/dashboard/clients')
          ? settled(
              fetchClientPage({ page: 0, pageSize: 1, status: 'ACTIVE' }).then((d) => d.total as number | null),
              null as number | null,
              'activeClients'
            )
          : skip(null as number | null),
      ]);
      const wave2 = await Promise.all([
        canAccessPath(role, '/dashboard/billing/claims')
          ? settled(fetchClaims(), [] as ClaimRecord[], 'claims')
          : skip([] as ClaimRecord[]),
        canAccessPath(role, '/dashboard/ehr/eligibility')
          ? settled(fetchEligibilityChecks(), [] as EligibilityCheckRecord[], 'eligibility')
          : skip([] as EligibilityCheckRecord[]),
      ]);
      const wave2b = await Promise.all([
        canAccessPath(role, '/dashboard/ehr/consents')
          ? settled(fetchConsents(), [] as ConsentItem[], 'consents')
          : skip([] as ConsentItem[]),
        // Roles that work the waitlist (clinicians can open it but their home does not load it)
        canAccessPath(role, '/dashboard/clients/intake')
          ? settled(fetchWaitlist().then((d) => d.entries), [] as WaitlistEntry[], 'waitlist')
          : skip([] as WaitlistEntry[]),
      ]);
      const wave3 = await Promise.all([
        canAccessPath(role, '/dashboard/hr/credentialing')
          ? settled(fetchStaffCredentials().then((d) => d.credentials), [] as StaffCredentialRecord[], 'credentials')
          : skip([] as StaffCredentialRecord[]),
        allowStaffDirectory(role) ? settled(listStaff(), [] as StaffUser[], 'staff') : skip([] as StaffUser[]),
      ]);
      const wave3b = await Promise.all([
        canAccessPath(role, '/dashboard/billing/payments')
          ? settled(fetchPayments().then((d) => d.payments), [], 'payments')
          : skip([] as Awaited<ReturnType<typeof fetchPayments>>['payments']),
        allowBillingOverview(role)
          ? settled(
              apiJson<{ success: true; overview: { stats: { activeClients: number } } }>(
                '/api/billing/overview'
              ).then((d) => d.overview.stats.activeClients as number | null),
              null as number | null
            )
          : skip(null as number | null),
      ]);
      if (cancelled) return;
      const payments = wave3b[0];
      setFeed({
        loading: false,
        todayAppts: wave1[0].appointments,
        timeZone: wave1[0].timeZone,
        alerts: wave1[1],
        tasks: wave1b[0].tasks,
        unsignedNoteCount: wave1b[0].unsignedNotes,
        clients: wave1b[1],
        claims: wave2[0],
        eligibility: wave2[1],
        consents: wave2b[0],
        waitlist: wave2b[1],
        credentials: wave3[0],
        staff: wave3[1],
        paymentsCents: payments.reduce((sum, p) => sum + (p.amountCents || 0), 0),
        activeClients: wave1b[2] ?? wave3b[1] ?? 0,
        // activeClients only counts as failed when neither count source answered
        failed: wave1b[2] === null && wave3b[1] === null && failed.includes('activeClients')
          ? failed
          : failed.filter((f) => f !== 'activeClients'),
      });
    })().catch(() => {
      if (!cancelled) setFeed({ ...EMPTY, loading: false, failed: ['appointments', 'alerts', 'tasks'] });
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, role]);

  const value = useMemo(() => feed, [feed]);
  const warning =
    !feed.loading && feed.failed.length > 0
      ? createElement(
          'div',
          {
            role: 'status',
            className: 'mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800',
          },
          `Some dashboard data could not load (${feed.failed.map((f) => SOURCE_LABEL[f]).join(', ')}). Tiles from those sources show "—"; reload to try again.`
        )
      : null;
  return createElement(Ctx.Provider, { value }, warning, children);
}

export function useRoleHomeFeed() {
  return useContext(Ctx);
}

export function tasksOf(feed: RoleHomeFeed, types: string[]) {
  return feed.tasks.filter((t) => types.includes(t.type));
}

export function consentsExpiring(feed: RoleHomeFeed, withinDays = 30) {
  const now = Date.now();
  return feed.consents
    .filter((c) => c.expiresAt)
    .map((c) => {
      const days = Math.ceil((new Date(c.expiresAt!).getTime() - now) / 86400000);
      return { ...c, days };
    })
    .filter((c) => c.days <= withinDays)
    .sort((a, b) => a.days - b.days);
}

export function pendingEligibility(feed: RoleHomeFeed) {
  return feed.eligibility.filter((e) => e.status === 'PENDING' || e.status === 'ERROR');
}

export function staffProductivity(feed: RoleHomeFeed) {
  const map = new Map<
    string,
    { name: string; role: string; sessions: number; notes: number; unsigned: number }
  >();

  // Start with the staff directory so people with no activity today still appear.
  for (const staff of feed.staff) {
    if (staff.status === 'DEACTIVATED') continue;
    const name = staff.name?.trim() || staff.email.trim();
    if (!name) continue;
    map.set(name, {
      name,
      role: String(staff.role).replace(/_/g, ' '),
      sessions: 0,
      notes: 0,
      unsigned: 0,
    });
  }

  for (const a of feed.todayAppts) {
    const name = a.clinicianName?.trim() || 'Unassigned';
    const row = map.get(name) ?? {
      name,
      role: 'Staff',
      sessions: 0,
      notes: 0,
      unsigned: 0,
    };
    row.sessions += 1;
    if (a.status === 'completed') row.notes += 1;
    map.set(name, row);
  }
  const unsigned = feed.tasks.filter((t) => t.type === 'unsigned_note' || t.type === 'missing_note');
  if (unsigned.length) {
    const unassigned = map.get('Unassigned') ?? {
      name: 'Unassigned',
      role: 'Staff',
      sessions: 0,
      notes: 0,
      unsigned: 0,
    };
    unassigned.unsigned = unsigned.length;
    map.set('Unassigned', unassigned);
  }
  return [...map.values()];
}

export function relativeTime(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatCents(cents: number | null | undefined) {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
