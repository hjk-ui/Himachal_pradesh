import type { Prisma } from '@prisma/client';
import { isBehavioralHealthDirectorRole, isMedicalDirectorEligibleRole } from '@/lib/auth/medicalDirector';

export type StoredNoteStatus = 'DRAFT' | 'SIGNED' | 'LOCKED';

/** Finalized content is immutable. A repeated request is safe; regression is never allowed. */
export function noteTransition(current: StoredNoteStatus, requested: 'SIGNED' | 'LOCKED') {
  if (current === requested) return { allowed: true, changed: false };
  // Sign & Lock may jump DRAFT → LOCKED in one step (sets signedAt + lockedAt).
  if (
    (current === 'DRAFT' && requested === 'SIGNED') ||
    (current === 'DRAFT' && requested === 'LOCKED') ||
    (current === 'SIGNED' && requested === 'LOCKED')
  ) {
    return { allowed: true, changed: true };
  }
  return { allowed: false, changed: false };
}

/**
 * Roles whose signed notes always need a supervisor co-signature. Licensed staff who are
 * still on a licensure track (a SupervisionTrack row naming them as supervisee — e.g.
 * LGPC→LCPC, LGSW→LCSW) also need one regardless of role. Edit this list to change policy.
 */
export const COSIGN_REQUIRED_ROLES: readonly string[] = ['PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT'];

/**
 * Leadership roles that may co-sign any colleague's note in their organization (org-wide review
 * queue). A database-verified Medical Director also has org-wide authority (hasCosignAuthority).
 * Every other reviewer is scoped: see COSIGN_CASELOAD_ROLES and decideCosignScope below.
 */
export const COSIGN_AUTHORITY_ROLES: readonly string[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];

/**
 * Clinical supervisor roles (no Medical Director flag) whose co-sign authority is limited to
 * (a) notes authored by their licensure-track supervisees (SupervisionTrack.supervisorId = me) and
 * (b) notes on clients on their own caseload (clientAccessWhere). HIPAA minimum necessary: a
 * psychiatrist reviews the clinicians they supervise and the patients they treat, not the whole org.
 * Other roles that reach the supervisor review page (THERAPIST, NP, CLINICIAN) co-sign only their
 * designated supervisees' notes.
 */
export const COSIGN_CASELOAD_ROLES: readonly string[] = ['PSYCHIATRIST'];

/**
 * Org-wide co-sign / supervisor-review authority over any colleague's notes and treatment plans.
 * A Medical Director (verified flag on a prescriber role) has it too, except that only a
 * behavioral-health medical director (Psychiatrist / psychiatric NP) counts as the supervisor
 * signature for a PRE-LICENSED behavioral-health author (`preLicensedAuthor`): Maryland's
 * counseling and social work boards approve licensed mental-health professionals as supervisors,
 * not a primary care physician / family NP. Licensure-hour supervision itself stays with the
 * designated HR supervision track (SupervisionTrack); the flag never creates one.
 */
export function hasCosignAuthority(
  role: string | null | undefined,
  opts?: { medicalDirector?: boolean; preLicensedAuthor?: boolean }
): boolean {
  if (COSIGN_AUTHORITY_ROLES.includes((role ?? '').toUpperCase())) return true;
  if (!opts?.medicalDirector || !isMedicalDirectorEligibleRole(role)) return false;
  return opts.preLicensedAuthor ? isBehavioralHealthDirectorRole(role) : true;
}

/** May this role co-sign notes of clients on its own caseload (in addition to its supervisees)? */
export function hasCaseloadCosign(role: string | null | undefined): boolean {
  return COSIGN_CASELOAD_ROLES.includes((role ?? '').toUpperCase());
}

/**
 * Which notes a reviewer's co-sign queue covers:
 *  - 'org': every pending note in the organization (leadership, verified Medical Director);
 *  - 'supervisees_and_caseload': their supervisees' notes + notes on clients on their caseload;
 *  - 'supervisees': only their licensure-track supervisees' notes.
 */
export type CosignQueueScope = 'org' | 'supervisees_and_caseload' | 'supervisees';

export function cosignQueueScope(role: string | null | undefined, opts?: { medicalDirector?: boolean }): CosignQueueScope {
  if (hasCosignAuthority(role, { medicalDirector: opts?.medicalDirector })) return 'org';
  return hasCaseloadCosign(role) ? 'supervisees_and_caseload' : 'supervisees';
}

export type CosignBasis = 'leadership' | 'medical_director' | 'supervisor' | 'caseload';

/**
 * THE co-sign authority decision (pure, no DB). Inputs are loaded by src/lib/notes/cosignScope.ts.
 *  - leadership (ADMIN / DIRECTOR / PRACTICE_DIRECTOR): any note in the org;
 *  - verified Medical Director: any note in the org (a primary care director is not the supervisor
 *    of a pre-licensed behavioral-health author: `preLicensedAuthor`);
 *  - designated licensure-track supervisor of the author (SupervisionTrack): yes;
 *  - COSIGN_CASELOAD_ROLES (Psychiatrist): the note's client is on their caseload;
 *  - otherwise no.
 * Part 2 / VIP record locks are enforced separately (assertClientPhiAccess) by the caller.
 */
export function decideCosignScope(input: {
  role: string | null | undefined;
  medicalDirector?: boolean;
  preLicensedAuthor?: boolean;
  isDesignatedSupervisor: boolean;
  clientOnCaseload: boolean;
}): { allowed: true; basis: CosignBasis } | { allowed: false; basis: null } {
  const role = (input.role ?? '').toUpperCase();
  if (COSIGN_AUTHORITY_ROLES.includes(role)) return { allowed: true, basis: 'leadership' };
  if (input.isDesignatedSupervisor) return { allowed: true, basis: 'supervisor' };
  if (hasCosignAuthority(role, { medicalDirector: input.medicalDirector, preLicensedAuthor: input.preLicensedAuthor })) {
    return { allowed: true, basis: 'medical_director' };
  }
  if (hasCaseloadCosign(role) && input.clientOnCaseload) return { allowed: true, basis: 'caseload' };
  return { allowed: false, basis: null };
}

/**
 * Pure: the extra ProgressNoteWorkflow filter for a scoped reviewer's queue, or null when the
 * reviewer has nothing to review (no supervisees, no caseload co-sign). 'org' scope needs no filter ([]).
 * `caseloadClientWhere` = clientAccessWhere(actor) (only used for 'supervisees_and_caseload').
 */
export function cosignQueueFilter(
  scope: CosignQueueScope,
  superviseeIds: readonly string[],
  caseloadClientWhere: Prisma.ClientWhereInput | null
): Prisma.ProgressNoteWorkflowWhereInput[] | null {
  if (scope === 'org') return [];
  const or: Prisma.ProgressNoteWorkflowWhereInput[] = [];
  if (superviseeIds.length) {
    const ids = [...superviseeIds];
    or.push({ signedById: { in: ids } }, { clinicianId: { in: ids } });
  }
  if (scope === 'supervisees_and_caseload' && caseloadClientWhere) {
    or.push({ note: { client: caseloadClientWhere } });
  }
  return or.length ? [{ OR: or }] : null;
}

/** Roles allowed to sign a note that has no recorded author (legacy rows only). */
const UNAUTHORED_NOTE_SIGNERS: readonly string[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];

/**
 * Co-signature needed: role-based (above), on a licensure track, or pre-licensed by license
 * level (HR setting or credential, e.g. LGPC / LMSW / LGMFT — see src/lib/ehr/therapy/rules.ts).
 * Same rule as the supervisor signature on treatment plans. `requiredRoles` = Practice settings ›
 * Clinical › co-sign roles when the caller loaded them (progress note signing), else the default list.
 */
export function cosignRequiredFor(
  role: string | null | undefined,
  onLicensureTrack: boolean,
  preLicensed = false,
  requiredRoles: readonly string[] = COSIGN_REQUIRED_ROLES
): boolean {
  return preLicensed || onLicensureTrack || requiredRoles.includes((role ?? '').toUpperCase());
}

/**
 * A signature attests that the signer provided and documented the service, so only the
 * note's author may sign it. Supervisors review through co-sign, never by signing a draft.
 */
export function canSignNote(input: {
  actorUserId: string;
  actorRole: string | null | undefined;
  authorId: string | null | undefined;
}): boolean {
  if (input.authorId) return input.authorId === input.actorUserId;
  return UNAUTHORED_NOTE_SIGNERS.includes((input.actorRole ?? '').toUpperCase());
}

export function canCosignNote(input: {
  actorUserId: string;
  actorRole: string | null | undefined;
  authorIds: (string | null | undefined)[];
  status: StoredNoteStatus;
  isDesignatedSupervisor: boolean;
  /** hasCosignAuthority(role, { medicalDirector, preLicensedAuthor }) for a verified Medical Director */
  medicalDirectorAuthority?: boolean;
  /** The note's client is on the actor's caseload (clientAccessWhere); counts for COSIGN_CASELOAD_ROLES only */
  clientOnCaseload?: boolean;
}): { ok: true; basis: CosignBasis } | { ok: false; status: number; error: string } {
  if (input.status === 'DRAFT') {
    return { ok: false, status: 409, error: 'Only signed notes can be co-signed.' };
  }
  if (input.authorIds.some((id) => id && id === input.actorUserId)) {
    return { ok: false, status: 403, error: 'You cannot co-sign your own note.' };
  }
  const decision = decideCosignScope({
    role: input.actorRole,
    isDesignatedSupervisor: input.isDesignatedSupervisor,
    clientOnCaseload: Boolean(input.clientOnCaseload),
  });
  if (decision.allowed) return { ok: true, basis: decision.basis };
  if (input.medicalDirectorAuthority) return { ok: true, basis: 'medical_director' };
  return {
    ok: false,
    status: 403,
    error: "Only the author's supervisor, a clinician with this client on their caseload, or a clinical director can co-sign this note.",
  };
}
