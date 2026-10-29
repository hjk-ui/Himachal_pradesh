/**
 * Who may run the quality check:
 *  - co-sign mode: a supervising clinician who could co-sign the note (decideCosignScope:
 *    leadership / verified Medical Director org-wide; the author's designated licensure-track
 *    supervisor; a Psychiatrist with the client on their caseload), never the author;
 *  - pre-sign mode: the note's author (same rule as signing).
 * The note is already org-scoped by the loader; protected (sensitive) clients also need PHI access.
 */
import type { Role } from '@prisma/client';
import { verifiedMedicalDirector } from '@/lib/auth/medicalDirector';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canSignNote, decideCosignScope, hasCaseloadCosign, hasCosignAuthority } from '@/lib/notes/transitions';
import { isClientOnCaseload, isDesignatedSupervisorOf } from '@/lib/notes/cosignScope';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import type { QualityMode } from './types';

export type QualityAccess = { ok: true } | { ok: false; status: number; error: string; reason: string; body?: unknown };

/** Designated licensure-track supervisor of any of these authors (kept for callers; see cosignScope.ts). */
export async function isDesignatedSupervisor(organizationId: string, supervisorId: string, authorIds: string[]): Promise<boolean> {
  return isDesignatedSupervisorOf(organizationId, supervisorId, authorIds);
}

export async function checkQualityAccess(input: {
  organizationId: string;
  userId: string;
  role: Role;
  mode: QualityMode;
  clientId: string;
  authorIds: string[];
  path: string;
}): Promise<QualityAccess> {
  if (input.mode === 'cosign') {
    const medicalDirector = verifiedMedicalDirector({ userId: input.userId, role: input.role, organizationId: input.organizationId });
    if (!canAccessPath(input.role, '/dashboard/ehr/supervisor-review', { medicalDirector })) return { ok: false, status: 403, error: 'Forbidden', reason: 'role' };
    if (input.authorIds.includes(input.userId)) return { ok: false, status: 403, error: 'You cannot review your own note for co-signature.', reason: 'own_note' };
    const isDesignated = await isDesignatedSupervisorOf(input.organizationId, input.userId, input.authorIds);
    const clientOnCaseload =
      !isDesignated && !hasCosignAuthority(input.role, { medicalDirector }) && hasCaseloadCosign(input.role)
        ? await isClientOnCaseload({ organizationId: input.organizationId, actorUserId: input.userId, actorRole: input.role }, input.clientId)
        : false;
    const allowed = decideCosignScope({ role: input.role, medicalDirector, isDesignatedSupervisor: isDesignated, clientOnCaseload }).allowed;
    if (!allowed) return { ok: false, status: 403, error: 'Only a supervising clinician can review this note.', reason: 'not_supervisor' };
  } else {
    if (!canAccessPath(input.role, '/dashboard/ehr/notes')) return { ok: false, status: 403, error: 'Forbidden', reason: 'role' };
    if (!canSignNote({ actorUserId: input.userId, actorRole: input.role, authorId: input.authorIds[0] ?? null })) {
      return { ok: false, status: 403, error: "Only the note's author can run the pre-sign checklist.", reason: 'not_author' };
    }
  }
  try {
    await assertClientPhiAccess({ organizationId: input.organizationId, userId: input.userId, role: input.role, clientId: input.clientId, path: input.path });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) return { ok: false, status: err.status, error: 'Protected record', reason: 'sensitive_record', body: err.body };
    throw err;
  }
  return { ok: true };
}
