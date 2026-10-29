import type { Prisma, Role } from '@prisma/client';
import type { StaffRole } from '@/types/roles';
import { isCaseloadRole, isClinicalStaff, isMedicalRole } from '@/types/roles';
import { verifiedMedicalDirector } from '@/lib/auth/medicalDirector';

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
 * Care-team link for primary care roles (PHYSICIAN / MEDICAL_NP / MEDICAL_ASSISTANT): assigned to
 * the client, on the client's treatment team (ClientTreatmentTeamMember rows are deleted when a
 * member is removed, so a row means active), or has had / has a MedicalVisit or an appointment
 * with the client. Behavioral-health caseload roles: behavioralCareTeamClientWhere.
 */
export function medicalCareTeamClientWhere(userId: string): Prisma.ClientWhereInput {
  return {
    OR: [
      { assignedToId: userId },
      { treatmentTeamMembers: { some: { providerId: userId } } },
      { medicalVisits: { some: { providerId: userId } } },
      { appointments: { some: { clinicianId: userId } } },
    ],
  };
}

/** How far back a past appointment keeps a behavioral-health clinician on the client's care team. */
export const CASELOAD_APPOINTMENT_LOOKBACK_DAYS = 548; // ~18 months

/**
 * Behavioral-health caseload (THERAPIST, PSYCHIATRIST, NP, PRP_SPECIALIST, CASE_MANAGER, CLINICIAN):
 * the treatment relationship, as in other BH EHRs — primary assigned clinician, a linked member of
 * the client's treatment team, or the clinician on one of the client's appointments in the last
 * ~18 months or upcoming (so a psychiatrist sees the med-management clients whose primary is a
 * therapist, and covering / intake clinicians see who is on their schedule).
 */
export function behavioralCareTeamClientWhere(userId: string, now: Date = new Date()): Prisma.ClientWhereInput {
  const since = new Date(now.getTime() - CASELOAD_APPOINTMENT_LOOKBACK_DAYS * 86_400_000);
  return {
    OR: [
      { assignedToId: userId },
      { treatmentTeamMembers: { some: { providerId: userId } } },
      { appointments: { some: { clinicianId: userId, startsAt: { gte: since } } } },
    ],
  };
}

/**
 * Peer Support caseload: assigned, or on the client's treatment team (peer specialists are
 * normally added to a care team rather than made the primary assignee). Same rule as
 * src/lib/peerSupport/scope.ts peerClientWhere, so the chart matches the peer page.
 */
export function peerCareTeamClientWhere(userId: string): Prisma.ClientWhereInput {
  return {
    OR: [{ assignedToId: userId }, { treatmentTeamMembers: { some: { providerId: userId } } }],
  };
}

/**
 * The role-correct care-team (caseload) link for one staff member: primary care roles ->
 * medicalCareTeamClientWhere, Peer Support -> peerCareTeamClientWhere, other caseload roles
 * (behavioral health) -> behavioralCareTeamClientWhere. Same branches as clientAccessWhere, without
 * the organization filter or the Medical Director org-wide scope (callers add those).
 */
export function careTeamClientWhereForRole(userId: string, role: Role | StaffRole | string, now: Date = new Date()): Prisma.ClientWhereInput {
  if (isMedicalRole(role)) return medicalCareTeamClientWhere(userId);
  if (String(role).toUpperCase() === 'PEER_SUPPORT') return peerCareTeamClientWhere(userId);
  return behavioralCareTeamClientWhere(userId, now);
}

/**
 * THE patient-scope rule for lists, scoped lookups (findScopedClient), scanners, reports and
 * break-glass eligibility: always the actor's organization; caseload roles narrowed to their
 * clients. A database-verified Medical Director (src/lib/auth/medicalDirector.ts, refreshed by
 * requireSession on every request) gets the whole organization, all locations, like leadership.
 * Never widens past the organization; Part 2 / VIP locks are applied separately by callers.
 */
export function clientAccessWhere(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}): Prisma.ClientWhereInput {
  const org = clientOrgFilter(input.organizationId);
  if (verifiedMedicalDirector({ userId: input.actorUserId, role: input.actorRole, organizationId: input.organizationId })) {
    return org;
  }
  if (isMedicalRole(input.actorRole) || isCaseloadRole(input.actorRole)) {
    return { AND: [org, careTeamClientWhereForRole(input.actorUserId, input.actorRole)] };
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

/** 403 text when a care-team member (not the primary) tries to change the care team */
export const CARE_TEAM_CHANGE_DENIED = 'Ask the primary clinician or leadership to change the care team';

/**
 * Who may add / remove members of a client's care (treatment) team: leadership (Super Admin, Admin,
 * Practice Director, Director), a verified Medical Director, the roles that may assign a clinician
 * (canAssignPatientToClinician: also Front Desk / Office Manager), or the client's primary assigned
 * clinician. Other care-team members can see the team but not change it (team membership grants
 * chart access, so only the person accountable for the client or leadership hands it out).
 * Callers still require canEditClientProfile and the org / caseload scope.
 */
export function canManageCareTeam(
  actor: { role: Role | StaffRole | string | null | undefined; userId: string; organizationId?: string | null },
  client: { assignedToId: string | null | undefined }
): boolean {
  const r = String(actor.role ?? '').toUpperCase();
  if (!r || !actor.userId) return false;
  if (r === 'SUPER_ADMIN' || r === 'ADMIN' || r === 'PRACTICE_DIRECTOR' || r === 'DIRECTOR') return true;
  if (canAssignPatientToClinician(r)) return true;
  if (verifiedMedicalDirector({ userId: actor.userId, role: r, organizationId: actor.organizationId })) return true;
  return Boolean(client.assignedToId) && client.assignedToId === actor.userId;
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

/**
 * Chart Notes tab / GET notes — not Billing, HR, Peer Support, or any primary care role
 * (physician, medical NP, medical assistant): behavioral-health notes are minimum-necessary and
 * psychotherapy notes are protected (HIPAA / 42 CFR Part 2). Front Desk and Office Manager are
 * administrative roles (scheduling, intake, consents) with no treatment purpose for note bodies,
 * the same rule as the practice-wide Progress Notes page (/dashboard/ehr/notes).
 */
export function canAccessClientChartNotes(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  if (
    !r ||
    r === 'BILLING' ||
    r === 'HR' ||
    r === 'PEER_SUPPORT' ||
    r === 'SUPER_ADMIN' ||
    r === 'FRONT_DESK' ||
    r === 'OFFICE_MANAGER' ||
    isMedicalRole(r)
  ) {
    return false;
  }
  return r === 'ADMIN' || r === 'DIRECTOR' || r === 'PRACTICE_DIRECTOR' || isCaseloadRole(r);
}

/** Write chart notes: clinical staff; never Office Manager (cannot write clinical notes), Peer Support or primary care roles. */
export function canWriteClientChartNotes(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  if (isMedicalRole(r) || r === 'OFFICE_MANAGER') return false;
  return Boolean(r) && isClinicalStaff(r) && r !== 'PEER_SUPPORT';
}

const LEADERSHIP_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'SUPER_ADMIN'];
const LICENSED_BH = ['THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP'];
const MEDICAL_TEAM = ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT'];

/**
 * Client medication list (GET /api/clients/[id]/medications, safety-check, DrFirst med list):
 * leadership, licensed BH clinicians / prescribers, the primary care team and crisis responders
 * (overdose / interaction safety in the field). Row scope (caseload / care team) is applied by the
 * route. Not Peer Support, Case Manager, PRP, Front Desk, Office Manager, Billing or HR.
 */
export function canViewClientMedications(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return [...LEADERSHIP_ROLES, ...LICENSED_BH, ...MEDICAL_TEAM, 'CRISIS_RESPONDER'].includes(r);
}

/** Add / edit / stop a medication-list entry: leadership, licensed BH clinicians, the primary care team. */
export function canWriteClientMedications(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return [...LEADERSHIP_ROLES, ...LICENSED_BH, ...MEDICAL_TEAM].includes(r);
}

/**
 * Insurance (payer / member id / group / copay / authorizations) on the client record, roster and
 * chart banner: everyone with roster access except Peer Support (name, status and appointments
 * only, plus the generic high-risk safety flag) and HR.
 */
export function canSeeClientInsurance(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return Boolean(r) && r !== 'PEER_SUPPORT' && r !== 'HR';
}

/**
 * Behavioral-health diagnoses (primary / secondary, ICD-10 code search) on the client record and
 * roster: leadership, licensed BH clinicians / prescribers, PRP, case managers, crisis responders
 * (treatment) and Billing (codes for claims). Not Front Desk or Office Manager (scheduling and
 * eligibility do not need them), Peer Support, HR or the primary care roles (BH diagnoses are
 * hidden from primary care; they have their own problem list).
 */
export function canSeeClientDiagnoses(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return [...LEADERSHIP_ROLES, ...LICENSED_BH, 'PRP_SPECIALIST', 'CASE_MANAGER', 'CRISIS_RESPONDER', 'BILLING'].includes(r);
}

/**
 * Risk detail (latest C-SSRS score, latest alert text, open-alert count) and the SUD-diagnosis
 * (42 CFR Part 2) flag on the chart banner: the treating BH roles and leadership, same people as the
 * Risk Alerts page. Everyone else keeps the generic risk level (the safety flag).
 */
export function canSeeClientRiskDetail(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return [...LEADERSHIP_ROLES, ...LICENSED_BH, 'PRP_SPECIALIST', 'CASE_MANAGER', 'CRISIS_RESPONDER'].includes(r);
}

/**
 * Patient check-in history (mood / stress / sleep scores and the patient's free-text note): the BH
 * care team, including Peer Support (their chart shows check-ins). Not Front Desk, Office Manager,
 * Billing, HR or primary care roles.
 */
export function canSeeClientCheckIns(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return [...LEADERSHIP_ROLES, ...LICENSED_BH, 'PRP_SPECIALIST', 'CASE_MANAGER', 'CRISIS_RESPONDER', 'PEER_SUPPORT'].includes(r);
}

/**
 * Change a client's BH diagnoses on the profile: licensed BH clinicians / prescribers and leadership
 * (diagnosing is outside the scope of Front Desk, Office Manager, PRP, case managers, peers and
 * crisis responders). Diagnoses entered at intake (createClient) are unchanged.
 */
export function canEditClientDiagnoses(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return [...LEADERSHIP_ROLES, ...LICENSED_BH].includes(r);
}

/** Change the clinical risk level: licensed BH clinicians, crisis responders and leadership. */
export function canEditClientRiskLevel(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return [...LEADERSHIP_ROLES, ...LICENSED_BH, 'CRISIS_RESPONDER'].includes(r);
}

/**
 * Patient check-ins (mood / stress entries): staff entry on the client's behalf. Licensed BH,
 * leadership, PRP, case manager, crisis responder and Front Desk (kiosk check-in); not Peer
 * Support, Billing, HR or primary care roles (BH content).
 */
export function canWriteClientCheckIns(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return [...LEADERSHIP_ROLES, ...LICENSED_BH, 'PRP_SPECIALIST', 'CASE_MANAGER', 'CRISIS_RESPONDER', 'OFFICE_MANAGER', 'FRONT_DESK'].includes(r);
}

/**
 * AI pre-session briefing (chart facts -> Bedrock): licensed BH clinicians / prescribers,
 * primary care providers and leadership. Not Peer Support, Case Manager, PRP, Crisis Responder,
 * Medical Assistant, Office Manager, Front Desk, Billing or HR. Chart access and AI consent are
 * checked by the briefing service after this.
 */
export function canRequestClientBriefing(role: Role | StaffRole | string | undefined | null): boolean {
  const r = (role ?? '').toUpperCase();
  return [...LEADERSHIP_ROLES, ...LICENSED_BH, 'PHYSICIAN', 'MEDICAL_NP'].includes(r);
}
