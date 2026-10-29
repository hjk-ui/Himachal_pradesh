import { canAccessPath } from '@/lib/auth/roleAccess';

/** Marketing hub (campaigns, reputation, automations, analytics, settings). Same rule as the page. */
export function canAccessMarketing(role: string | null | undefined): boolean {
  return canAccessPath(role, '/dashboard/marketing');
}

/** Lead pipeline + conversations inbox (adds Front Desk). */
export function canWorkLeads(role: string | null | undefined): boolean {
  return canAccessPath(role, '/dashboard/marketing/leads');
}

/** Converting a lead creates a client: same roles that can create clients and work leads. */
export function canConvertLeads(role: string | null | undefined): boolean {
  const r = (role ?? '').toUpperCase();
  return canWorkLeads(r) && ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'FRONT_DESK', 'OFFICE_MANAGER'].includes(r);
}
