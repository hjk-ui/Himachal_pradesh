/**
 * Who a worklist item belongs to (My To-Do, Inbox "Documents to file"). Pure: Prisma where
 * builders and predicates only, no database access, so the routing rules are unit tested.
 *
 * Prescriber feedback (staging): To-Do and the inbox showed other providers' work (prior
 * authorizations, therapy treatment plans, the whole Valant document import pile). Rules:
 *   - "My patients" = the user's own caseload / care team (assigned, on the treatment team, or a
 *     recent appointment with them), independent of a wider read scope (leadership, Medical Director).
 *   - Prior authorizations go to billing / front desk / office manager / leadership, not to
 *     prescribers or therapists unless that person created (requested) the authorization.
 *   - Treatment plan reviews go to the plan's owner (author; the client's assigned clinician when
 *     the plan has none) and the owner's supervisor; leadership keeps the oversight view.
 *   - Documents to file: the user's own (uploaded by them, or for their patients) by default; the
 *     roles that file for everyone get an "All documents" view; the Valant import review pile is
 *     its own collapsed group and clinicians only see an imported document for their own patient.
 */
import type { Prisma } from '@prisma/client';
import {
  behavioralCareTeamClientWhere,
  medicalCareTeamClientWhere,
  peerCareTeamClientWhere,
} from '@/lib/clients/orgScope';
import { isCaseloadRole, isMedicalRole } from '@/types/roles';

const upper = (role: string | null | undefined) => String(role ?? '').trim().toUpperCase();

/** The user's own patients (never the org-wide scope a leader or Medical Director can read) */
export function ownCaseloadClientWhere(role: string | null | undefined, userId: string, now: Date = new Date()): Prisma.ClientWhereInput {
  const r = upper(role);
  if (isMedicalRole(r)) return medicalCareTeamClientWhere(userId);
  if (r === 'PEER_SUPPORT') return peerCareTeamClientWhere(userId);
  return behavioralCareTeamClientWhere(userId, now);
}

/** "My patients only" starts ON for clinical (caseload) roles, OFF for leadership and the front office */
export function myPatientsDefault(role: string | null | undefined): boolean {
  const r = upper(role);
  return r === 'CLINICIAN' || isCaseloadRole(r);
}

/** Roles that work prior authorizations for everyone (they request and renew them) */
export const PRIOR_AUTH_WORK_ROLES = ['BILLING', 'FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'SUPER_ADMIN'] as const;

export function routesPriorAuthTo(role: string | null | undefined, userId: string, auth: { createdById: string | null }): boolean {
  if ((PRIOR_AUTH_WORK_ROLES as readonly string[]).includes(upper(role))) return true;
  // A prescriber / therapist only gets the authorizations they requested themselves
  return Boolean(auth.createdById) && auth.createdById === userId;
}

/** Leadership keeps the practice-wide treatment plan oversight view */
export const PLAN_OVERSIGHT_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'SUPER_ADMIN'] as const;

export function planOwnerId(plan: { clinicianId: string | null; clientAssignedToId?: string | null }): string | null {
  return plan.clinicianId ?? plan.clientAssignedToId ?? null;
}

export function routesPlanReviewTo(
  role: string | null | undefined,
  userId: string,
  plan: { clinicianId: string | null; clientAssignedToId?: string | null },
  superviseeIds: ReadonlySet<string>
): boolean {
  if ((PLAN_OVERSIGHT_ROLES as readonly string[]).includes(upper(role))) return true;
  const owner = planOwnerId(plan);
  if (!owner) return false;
  return owner === userId || superviseeIds.has(owner);
}

/** Roles that file documents for everyone ("All documents" view) */
export const DOCUMENT_FILE_ALL_ROLES = ['FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'SUPER_ADMIN'] as const;

export function filesForEveryone(role: string | null | undefined): boolean {
  return (DOCUMENT_FILE_ALL_ROLES as readonly string[]).includes(upper(role));
}

export type DocumentInboxPlacement = 'mine' | 'all_documents' | 'valant_import' | null;

/**
 * Where a "ready" Smart Document Intake row goes in the user's inbox:
 * 'mine' (default list), 'all_documents' (behind the All documents toggle), 'valant_import'
 * (collapsed import review group) or null (not shown to this user).
 */
export function placeInboxDocument(
  doc: { isValantImport: boolean; suggestedClientId: string | null; uploadedById: string | null },
  ctx: { userId: string; fileForAll: boolean; myClientIds: ReadonlySet<string> }
): DocumentInboxPlacement {
  if (doc.suggestedClientId && ctx.myClientIds.has(doc.suggestedClientId)) return 'mine';
  // The import job's runner "uploaded" every Valant file: that does not make the pile theirs
  if (!doc.isValantImport && doc.uploadedById && doc.uploadedById === ctx.userId) return 'mine';
  if (!ctx.fileForAll) return null;
  return doc.isValantImport ? 'valant_import' : 'all_documents';
}
