/**
 * Intensive programs access (pure). Page / API gates come from roleAccess (canAccessPath on
 * /dashboard/programs/intensive); inside the module:
 *  - leadership (Admin / Director / Practice Director) or a verified Medical Director: the whole
 *    org, program setup and the program-director rollups (census, attendance %, outcomes);
 *  - licensed clinicians and case managers: enrollments where they are on the program team
 *    (primary clinician, psychiatrist / NP, case manager) or the client is in their caseload
 *    (clientAccessWhere). Providers get no practice-wide rollups (no practice reports);
 *  - SUD IOP (and SUD PHP) records are 42 CFR Part 2: only Part 2 program staff (the SUD group
 *    roles, plus the psychiatrist / NP named on the client's program team) and leadership see them;
 *  - protected-record locks (lockedSensitiveClientIds) are applied on top by the store.
 */
import { canAccessPath } from '@/lib/auth/roleAccess';

export const INTENSIVE_PATH = '/dashboard/programs/intensive';
export const INTENSIVE_BILLING_PATH = '/dashboard/programs/intensive/billing';
export const SUD_GROUPS_PATH = '/dashboard/ehr/sud-groups';

const LEADERSHIP = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);
const LICENSED = new Set(['CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP']);
const PRESCRIBERS = new Set(['PSYCHIATRIST', 'NP']);

const up = (r: string | null | undefined) => String(r ?? '').toUpperCase();

export function isIntensiveLeadership(role: string | null | undefined, medicalDirector = false): boolean {
  return LEADERSHIP.has(up(role)) || medicalDirector;
}

/** Program setup and policy confirmation. */
export function canManagePrograms(role: string | null | undefined): boolean {
  return LEADERSHIP.has(up(role));
}

/** Program-director rollups (census, attendance %, under-minimum list org-wide, outcomes). */
export function canSeeRollups(role: string | null | undefined, medicalDirector = false): boolean {
  return isIntensiveLeadership(role, medicalDirector);
}

/** Referral intake, attendance, missed-day outreach. */
export function canRecordProgramWork(role: string | null | undefined): boolean {
  return canAccessPath(up(role), INTENSIVE_PATH);
}

/** Screening / admission decision, team assignment, weekly team review, discharge. */
export function canMakeClinicalDecisions(role: string | null | undefined): boolean {
  return LEADERSHIP.has(up(role)) || LICENSED.has(up(role));
}

export function isPrescriber(role: string | null | undefined): boolean {
  return PRESCRIBERS.has(up(role));
}

/** Charge drafts: generate and read, leadership + billing (Office Manager removed 2026-10-22). */
export function canGenerateCharges(role: string | null | undefined): boolean {
  const r = up(role);
  return LEADERSHIP.has(r) || r === 'BILLING';
}
export function canReadCharges(role: string | null | undefined): boolean {
  return canGenerateCharges(role);
}

/** May this role see 42 CFR Part 2 program records at all (before the per-client team / caseload check)? */
export function canSeePart2Program(role: string | null | undefined): boolean {
  return canAccessPath(up(role), SUD_GROUPS_PATH) || PRESCRIBERS.has(up(role));
}

export type TeamRef = { primaryClinicianId: string | null; prescriberId: string | null; caseManagerId: string | null };

export function isOnProgramTeam(userId: string, e: TeamRef): boolean {
  return Boolean(userId) && (e.primaryClinicianId === userId || e.prescriberId === userId || e.caseManagerId === userId);
}

/**
 * One enrollment, after org scope: leadership sees it; otherwise the viewer is on the program team
 * or the client is in their caseload. Part 2: the role must be Part 2 program staff, and a
 * prescriber outside the SUD group roles only when named on the team.
 */
export function canSeeEnrollment(input: {
  role: string;
  userId: string;
  medicalDirector?: boolean;
  part2: boolean;
  team: TeamRef;
  inCaseload: boolean;
}): boolean {
  const leader = isIntensiveLeadership(input.role, input.medicalDirector);
  const onTeam = isOnProgramTeam(input.userId, input.team);
  if (input.part2 && !leader) {
    if (!canSeePart2Program(input.role)) return false;
    if (!canAccessPath(up(input.role), SUD_GROUPS_PATH) && !onTeam) return false;
  }
  if (leader) return true;
  return onTeam || input.inCaseload;
}

/** May this viewer see that a Part 2 program exists (program list, roster)? Rows inside are still per-client checked. */
export function canSeePart2ProgramList(role: string | null | undefined, medicalDirector = false): boolean {
  return isIntensiveLeadership(role, medicalDirector) || canSeePart2Program(role);
}
