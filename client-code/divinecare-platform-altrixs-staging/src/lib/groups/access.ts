/**
 * Group access (pure). Page / API gate per kind comes from roleAccess (canAccessPath on the
 * kind's page). Inside a group, roster PHI follows caseload rules:
 *   - leadership (Admin / Director / Practice Director) and a verified Medical Director: everyone;
 *   - the group's facilitator or co-facilitator: the group's members (they run the group);
 *   - anyone else with page access: only members on their own caseload (assigned to them).
 * Protected (Part 2 / VIP SensitiveRecord) clients the viewer cannot open are masked on top of this
 * (lockedSensitiveClientIds); there is no group bypass of the protected-record rules.
 */
import { canAccessPath } from '@/lib/auth/roleAccess';
import { GROUP_KIND_META, type GroupKind } from './types';

const LEADERSHIP = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);

export function canUseGroupKind(role: string | null | undefined, kind: GroupKind): boolean {
  if (!role) return false;
  return canAccessPath(role, GROUP_KIND_META[kind].href);
}

export function isGroupLeadership(role: string | null | undefined, medicalDirector = false): boolean {
  return LEADERSHIP.has(String(role ?? '').toUpperCase()) || medicalDirector;
}

export type GroupStaffRef = { facilitatorId: string | null; coFacilitatorId: string | null };

export function isGroupFacilitator(userId: string, g: GroupStaffRef): boolean {
  return Boolean(userId) && (g.facilitatorId === userId || g.coFacilitatorId === userId);
}

/** Create groups, edit settings, add / end members. */
export function canManageGroup(input: { role: string; userId: string; medicalDirector?: boolean; group: GroupStaffRef | null }): boolean {
  if (isGroupLeadership(input.role, input.medicalDirector)) return true;
  return input.group ? isGroupFacilitator(input.userId, input.group) : false;
}

/** Take attendance and write / sign notes for a session (as the note author). */
export function canDocumentSession(input: { role: string; userId: string; session: GroupStaffRef; group: GroupStaffRef }): boolean {
  if (isGroupLeadership(input.role)) return true;
  return isGroupFacilitator(input.userId, input.session) || isGroupFacilitator(input.userId, input.group);
}

/** May this viewer see this member's identity and records within the group? */
export function canSeeMember(input: {
  role: string;
  userId: string;
  medicalDirector?: boolean;
  group: GroupStaffRef;
  /** Client.assignedToId */
  assignedToId: string | null;
  /** The client is on the viewer's care team (orgScope.clientAccessWhere: treatment team / visit clinician) */
  onCareTeam?: boolean;
}): boolean {
  if (isGroupLeadership(input.role, input.medicalDirector)) return true;
  if (isGroupFacilitator(input.userId, input.group)) return true;
  if (input.onCareTeam) return true;
  return Boolean(input.assignedToId) && input.assignedToId === input.userId;
}

export const HIDDEN_MEMBER_LABEL = 'Member not on your caseload';
export const PROTECTED_MEMBER_LABEL = 'Protected record';
