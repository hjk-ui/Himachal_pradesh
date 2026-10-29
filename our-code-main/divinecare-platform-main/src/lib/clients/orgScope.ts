import type { Prisma, Role } from '@prisma/client';
import type { StaffRole } from '@/types/roles';
import { isCaseloadRole, isClinicalStaff } from '@/types/roles';

/**
 * Tenant scope: prefer Client.organizationId (MRN era), then location / assignee fallbacks
 * for legacy rows not yet backfilled.
 */
export function clientOrgFilter(organizationId: string): Prisma.ClientWhereInput {
  return {
    OR: [
      { organizationId },
      { location: { organizationId } },
      {
        AND: [{ locationId: null }, { assignedTo: { organizationId } }],
      },
    ],
  };
}

/** GET/PATCH/DELETE /api/clients/[id] — id plus clinic scope. */
export function clientByIdWhere(
  id: string,
  organizationId: string
): Prisma.ClientWhereInput {
  return { id, AND: [clientOrgFilter(organizationId)] };
}

/**
 * Same as clientOrgFilter. Kept for call sites that used a looser
 * location-OR-assignee match (that leaked other-org located clients).
 */
export function clientOrgMembershipWhere(organizationId: string): Prisma.ClientWhereInput {
  return clientOrgFilter(organizationId);
}

/**
 * A client is on a user's caseload when they are the assigned clinician OR a care-team
 * member. Single definition — list, counts, and access scoping all share it.
 */
export function caseloadMemberWhere(userId: string): Prisma.ClientWhereInput {
  return {
    OR: [
      { assignedToId: userId },
      { treatmentTeamMembers: { some: { providerId: userId } } },
    ],
  };
}

export function clientAccessWhere(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}): Prisma.ClientWhereInput {
  const org = clientOrgFilter(input.organizationId);
  if (isCaseloadRole(input.actorRole)) {
    return {
      AND: [org, caseloadMemberWhere(input.actorUserId)],
    };
  }
  return org;
}

/** Pure helper for tests: Clinic B must not see Clinic A’s client. */
export function clientBelongsToOrg(
  client: {
    organizationId?: string | null;
    locationId?: string | null;
    location?: { organizationId: string } | null;
    assignedTo?: { organizationId: string } | null;
  },
  organizationId: string
): boolean {
  if (client.organizationId === organizationId) return true;
  if (client.location?.organizationId === organizationId) return true;
  if (!client.locationId && client.assignedTo?.organizationId === organizationId) {
    return true;
  }
  return false;
}

export function canAccessClientRoster(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return (
    r === 'SUPER_ADMIN' ||
    r === 'ADMIN' ||
    r === 'DIRECTOR' ||
    r === 'PRACTICE_DIRECTOR' ||
    r === 'FRONT_DESK' ||
    r === 'OFFICE_MANAGER' ||
    r === 'BILLING' ||
    r === 'PHYSICIAN' ||
    r === 'MEDICAL_NP' ||
    r === 'MEDICAL_ASSISTANT' ||
    isCaseloadRole(r)
  );
}

export function canCreateClient(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return (
    r === 'SUPER_ADMIN' ||
    r === 'ADMIN' ||
    r === 'DIRECTOR' ||
    r === 'PRACTICE_DIRECTOR' ||
    r === 'FRONT_DESK' ||
    r === 'OFFICE_MANAGER' ||
    (isCaseloadRole(r) && r !== 'PEER_SUPPORT')
  );
}

/**
 * RBAC: Who may edit client profiles (demographics, contact, clinical status, diagnoses).
 * Clinic Leadership (Super Admin, Admin, Practice Director, Director, Office Manager), Front Desk, and caseload providers.
 * Strictly blocks BILLING, HR, and PEER_SUPPORT.
 */
export function canEditClientProfile(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  if (!r || r === 'HR' || r === 'BILLING' || r === 'PEER_SUPPORT') {
    return false;
  }
  return (
    r === 'SUPER_ADMIN' ||
    r === 'ADMIN' ||
    r === 'DIRECTOR' ||
    r === 'PRACTICE_DIRECTOR' ||
    r === 'OFFICE_MANAGER' ||
    r === 'FRONT_DESK' ||
    (isCaseloadRole(r) && r !== 'PEER_SUPPORT')
  );
}

export function canAccessClientAppointments(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return (
    r === 'SUPER_ADMIN' ||
    r === 'ADMIN' ||
    r === 'DIRECTOR' ||
    r === 'PRACTICE_DIRECTOR' ||
    r === 'FRONT_DESK' ||
    r === 'OFFICE_MANAGER' ||
    isCaseloadRole(r)
  );
}

/** Who may assign / reassign a patient to a clinician (intake + Assign Clinician / warm handoff). */
export function canAssignPatientToClinician(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return (
    r === 'SUPER_ADMIN' ||
    r === 'ADMIN' ||
    r === 'PRACTICE_DIRECTOR' ||
    r === 'FRONT_DESK' ||
    r === 'OFFICE_MANAGER'
  );
}

/** Clinic MRN edits stay leadership-only (not front desk). */
export function canEditClinicMrn(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return r === 'SUPER_ADMIN' || r === 'ADMIN' || r === 'PRACTICE_DIRECTOR';
}

export function canAccessClientMessages(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return (
    r === 'SUPER_ADMIN' ||
    r === 'ADMIN' ||
    r === 'DIRECTOR' ||
    r === 'PRACTICE_DIRECTOR' ||
    r === 'FRONT_DESK' ||
    r === 'OFFICE_MANAGER' ||
    isCaseloadRole(r)
  );
}

/** Chart Notes tab / GET notes — not Billing, HR, Peer Support, or Primary Care Medical (HIPAA / 42 CFR Part 2). */
export function canAccessClientChartNotes(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  if (
    !r ||
    r === 'BILLING' ||
    r === 'HR' ||
    r === 'PEER_SUPPORT' ||
    r === 'SUPER_ADMIN' ||
    r === 'PHYSICIAN' ||
    r === 'MEDICAL_NP'
  ) {
    return false;
  }
  return (
    r === 'ADMIN' ||
    r === 'DIRECTOR' ||
    r === 'PRACTICE_DIRECTOR' ||
    r === 'FRONT_DESK' ||
    r === 'OFFICE_MANAGER' ||
    isCaseloadRole(r)
  );
}

export function canWriteClientChartNotes(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  if (r === 'PHYSICIAN' || r === 'MEDICAL_NP') return false;
  return Boolean(r) && isClinicalStaff(r) && r !== 'PEER_SUPPORT';
}
