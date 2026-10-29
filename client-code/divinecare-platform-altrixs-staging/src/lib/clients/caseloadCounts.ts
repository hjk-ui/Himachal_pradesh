/**
 * Per-clinician caseload counts for the Caseload view, Warm Handoff capacity and intake matching.
 * Counted on the server across the whole (scoped) active roster — never from one page of the list.
 *
 *  - primary: active clients whose Client.assignedToId is the clinician (the chart's "Assigned
 *    clinician"; the warm handoff writes the primary therapist to assignedToId).
 *  - careTeam: active clients where the clinician is a ClientTreatmentTeamMember (providerId) but
 *    not the primary ("Also on care team").
 *  - highRisk / mediumRisk / lowRisk: risk of the primary caseload.
 *  - upcomingAppointments: primary clients with a future, not-cancelled appointment.
 *  - A non-clinical assignee (Admin, Office Manager, Front Desk... — e.g. the admin an import
 *    defaulted to) is not a primary caseload: those clients count as unassigned instead
 *    (clinicalPrimaryWhere here, unassignedWhere in listQuery.ts).
 *
 * Pure: the route runs the Prisma groupBy / findMany queries and passes the rows here.
 */
import type { Prisma, RiskLevel } from '@prisma/client';
import { upcomingAppointmentWhere } from '@/lib/clients/listQuery';
import { nonClinicalAssigneeUserWhere } from '@/lib/clients/careTeam';

export type StaffCaseloadCount = {
  staffId: string;
  primary: number;
  careTeam: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  /** Risk of the care-team-only clients (for the acuity bar over the whole caseload) */
  careTeamHighRisk: number;
  careTeamMediumRisk: number;
  upcomingAppointments: number;
};

export type CaseloadCountsResponse = {
  counts: Record<string, StaffCaseloadCount>;
  /** Active clients with no primary clinician and nobody on the care team */
  unassigned: number;
  /** Active clients in scope */
  activeTotal: number;
};

/** Active clients in the caller's scope, optionally at one location (the page's location selector, never the search box). */
export function caseloadClientWhere(scope: Prisma.ClientWhereInput, locationId?: string | null): Prisma.ClientWhereInput {
  const and: Prisma.ClientWhereInput[] = [scope, { status: 'ACTIVE' }];
  if (locationId) and.push({ locationId });
  return { AND: and };
}

/** Has a primary clinician with a caseload role (never a non-clinical assignee). */
export function clinicalPrimaryWhere(): Prisma.ClientWhereInput {
  return { AND: [{ assignedToId: { not: null } }, { NOT: { assignedTo: nonClinicalAssigneeUserWhere() } }] };
}

export function caseloadUpcomingWhere(base: Prisma.ClientWhereInput, now: Date): Prisma.ClientWhereInput {
  return { AND: [base, clinicalPrimaryWhere(), { appointments: { some: upcomingAppointmentWhere(now) } }] };
}

const empty = (staffId: string): StaffCaseloadCount => ({
  staffId,
  primary: 0,
  careTeam: 0,
  highRisk: 0,
  mediumRisk: 0,
  lowRisk: 0,
  careTeamHighRisk: 0,
  careTeamMediumRisk: 0,
  upcomingAppointments: 0,
});

export function buildCaseloadCounts(input: {
  /** client.groupBy by [assignedToId, riskLevel] */
  primaryByRisk: Array<{ assignedToId: string | null; riskLevel: RiskLevel; _count: { _all: number } }>;
  /** client.groupBy by [assignedToId] with an upcoming appointment */
  primaryUpcoming: Array<{ assignedToId: string | null; _count: { _all: number } }>;
  /** Care-team rows (providerId, clientId) with the client's primary and risk */
  teamRows: Array<{ providerId: string | null; clientId: string; client: { assignedToId: string | null; riskLevel: RiskLevel } }>;
  unassigned: number;
  activeTotal: number;
}): CaseloadCountsResponse {
  const counts: Record<string, StaffCaseloadCount> = {};
  const get = (id: string) => (counts[id] ??= empty(id));
  for (const r of input.primaryByRisk) {
    if (!r.assignedToId) continue;
    const c = get(r.assignedToId);
    const n = r._count._all;
    c.primary += n;
    if (r.riskLevel === 'HIGH') c.highRisk += n;
    else if (r.riskLevel === 'MEDIUM') c.mediumRisk += n;
    else c.lowRisk += n;
  }
  for (const r of input.primaryUpcoming) {
    if (r.assignedToId) get(r.assignedToId).upcomingAppointments += r._count._all;
  }
  // One client counts once per clinician, even with two team rows (e.g. two roles)
  const seen = new Set<string>();
  for (const r of input.teamRows) {
    if (!r.providerId || r.providerId === r.client.assignedToId) continue;
    const key = `${r.providerId}:${r.clientId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = get(r.providerId);
    c.careTeam += 1;
    if (r.client.riskLevel === 'HIGH') c.careTeamHighRisk += 1;
    else if (r.client.riskLevel === 'MEDIUM') c.careTeamMediumRisk += 1;
  }
  return { counts, unassigned: input.unassigned, activeTotal: input.activeTotal };
}

/** Headcount used for capacity (primary + also on care team). */
export function caseloadHeadcount(c: StaffCaseloadCount | undefined): number {
  return c ? c.primary + c.careTeam : 0;
}

/**
 * Acuity points with the same weights as src/features/caseload/algorithms.ts calculateClientAcuity
 * (10 per client + 15 high / 5 medium risk). Diagnosis complexity is not stored, so it adds nothing.
 */
export function caseloadAcuity(c: StaffCaseloadCount | undefined): number {
  if (!c) return 0;
  const n = c.primary + c.careTeam;
  return n * 10 + (c.highRisk + c.careTeamHighRisk) * 15 + (c.mediumRisk + c.careTeamMediumRisk) * 5;
}

/** Roles that see the practice-wide counts (Caseload view, Warm Handoff, intake matching). */
export function canViewCaseloadCounts(role: string | null | undefined): boolean {
  const r = String(role ?? '').toUpperCase();
  return ['SUPER_ADMIN', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER', 'FRONT_DESK'].includes(r);
}
