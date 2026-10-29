'use client';

import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchRiskAlerts } from '@/features/alerts/api/alertsApi';
import type { RiskAlert } from '@/features/alerts/types';
import { fetchAppointments, todayLabel, type Appointment } from '@/features/appointments';
import { fetchClaims, type ClaimRecord } from '@/features/billing/claimsApi';
import { fetchPayments } from '@/features/billing/ledgerApi';
import { fetchClients } from '@/features/clients';
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
  activeClients: number;
};

const EMPTY: RoleHomeFeed = {
  loading: false,
  todayAppts: [],
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
};

const Ctx = createContext<RoleHomeFeed>(EMPTY);

async function settled<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

function skip<T>(fallback: T): Promise<T> {
  return Promise.resolve(fallback);
}

function allowStaffDirectory(role: StaffRole) {
  return role === 'ADMIN' || role === 'DIRECTOR' || role === 'PRACTICE_DIRECTOR' || role === 'HR';
}

function allowBillingOverview(role: StaffRole) {
  return role === 'ADMIN' || role === 'DIRECTOR' || role === 'PRACTICE_DIRECTOR' || role === 'BILLING';
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
    const today = todayLabel();

    (async () => {
      const wave1 = await Promise.all([
        canAccessPath(role, '/dashboard/appointments')
          ? settled(fetchAppointments({ date: today }), [] as Appointment[])
          : skip([] as Appointment[]),
        canAccessPath(role, '/dashboard/alerts')
          ? settled(fetchRiskAlerts(true).then((d) => d.alerts), [] as RiskAlert[])
          : skip([] as RiskAlert[]),
      ]);
      const wave1b = await Promise.all([
        canAccessPath(role, '/dashboard/tasks')
          ? settled(
              apiJson<{ success: true; tasks: HomeTask[] }>('/api/tasks').then((d) => d.tasks),
              [] as HomeTask[]
            )
          : skip([] as HomeTask[]),
        canAccessPath(role, '/dashboard/clients')
          ? settled(fetchClients(), [] as Client[])
          : skip([] as Client[]),
      ]);
      const wave2 = await Promise.all([
        canAccessPath(role, '/dashboard/billing/claims')
          ? settled(fetchClaims(), [] as ClaimRecord[])
          : skip([] as ClaimRecord[]),
        canAccessPath(role, '/dashboard/ehr/eligibility')
          ? settled(fetchEligibilityChecks(), [] as EligibilityCheckRecord[])
          : skip([] as EligibilityCheckRecord[]),
      ]);
      const wave2b = await Promise.all([
        canAccessPath(role, '/dashboard/ehr/consents')
          ? settled(fetchConsents(), [] as ConsentItem[])
          : skip([] as ConsentItem[]),
        canAccessPath(role, '/dashboard/clients/waitlist')
          ? settled(fetchWaitlist().then((d) => d.entries), [] as WaitlistEntry[])
          : skip([] as WaitlistEntry[]),
      ]);
      const wave3 = await Promise.all([
        canAccessPath(role, '/dashboard/hr/credentialing')
          ? settled(fetchStaffCredentials().then((d) => d.credentials), [] as StaffCredentialRecord[])
          : skip([] as StaffCredentialRecord[]),
        allowStaffDirectory(role) ? settled(listStaff(), [] as StaffUser[]) : skip([] as StaffUser[]),
      ]);
      const wave3b = await Promise.all([
        canAccessPath(role, '/dashboard/billing/payments')
          ? settled(fetchPayments().then((d) => d.payments), [])
          : skip([] as Awaited<ReturnType<typeof fetchPayments>>['payments']),
        allowBillingOverview(role)
          ? settled(
              apiJson<{ success: true; overview: { stats: { activeClients: number } } }>(
                '/api/billing/overview'
              ).then((d) => d.overview.stats.activeClients),
              0
            )
          : skip(0),
      ]);
      if (cancelled) return;
      const payments = wave3b[0];
      setFeed({
        loading: false,
        todayAppts: wave1[0].filter((appointment) => appointment.status !== 'cancelled' && appointment.status !== 'late-cancel'),
        alerts: wave1[1],
        tasks: wave1b[0],
        clients: wave1b[1],
        claims: wave2[0],
        eligibility: wave2[1],
        consents: wave2b[0],
        waitlist: wave2b[1],
        credentials: wave3[0],
        staff: wave3[1],
        paymentsCents: payments.reduce((sum, p) => sum + (p.amountCents || 0), 0),
        activeClients: wave3b[1] || wave1b[1].length,
      });
    })().catch(() => {
      if (!cancelled) setFeed({ ...EMPTY, loading: false });
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, role]);

  const value = useMemo(() => feed, [feed]);
  return createElement(Ctx.Provider, { value }, children);
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
