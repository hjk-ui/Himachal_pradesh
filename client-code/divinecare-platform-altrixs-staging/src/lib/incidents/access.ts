/**
 * Incident reports: who sees and who works which report.
 *
 * Industry standard (CARF 1.H, Joint Commission / state incident programs; HIPAA minimum necessary):
 * line staff FILE reports and see what concerns them; quality / leadership REVIEW all.
 *   - File: every role that opens /dashboard/incidents (canAccessPath).
 *   - Review all (org-wide list, investigation, status, assignment): ADMIN, DIRECTOR,
 *     PRACTICE_DIRECTOR, OFFICE_MANAGER (operations / risk) and a database-verified Medical Director.
 *   - Everyone else: only reports they filed, that name them as involved staff, or that are
 *     assigned to them (the assigned investigator may update the investigation and status).
 *   - The reporter cannot rewrite a filed report (the record is permanent; corrections go through
 *     a reviewer, and a mistaken report is marked filed_in_error with an explanation).
 * Pure (no database).
 */
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';

export const INCIDENT_REVIEW_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER'] as const;

export const INCIDENT_STATUSES = ['reported', 'investigating', 'corrective_action', 'closed', 'filed_in_error'] as const;
export type IncidentStatusValue = (typeof INCIDENT_STATUSES)[number];

/** Org-wide incident review: the review roles, or a verified Medical Director (server-verified flag). */
export function canReviewAllIncidents(role: string | null | undefined, verifiedMedicalDirector = false): boolean {
  if (verifiedMedicalDirector) return true;
  if (!role) return false;
  return (INCIDENT_REVIEW_ROLES as readonly string[]).includes(normalizeStaffRole(role));
}

export type IncidentLinks = {
  reporterUserId: string | null;
  involvedStaffIds: string[];
  assignedToUserId: string | null;
};

/** Does this report concern the user (filed it, named as involved, or assigned)? */
export function incidentConcernsUser(incident: IncidentLinks, userId: string): boolean {
  if (!userId) return false;
  return (
    incident.reporterUserId === userId ||
    incident.assignedToUserId === userId ||
    (incident.involvedStaffIds ?? []).includes(userId)
  );
}

export function canViewIncident(reviewer: boolean, incident: IncidentLinks, userId: string): boolean {
  return reviewer || incidentConcernsUser(incident, userId);
}

/** Investigation fields and status: reviewers, or the assigned investigator. */
export function canWorkIncident(reviewer: boolean, incident: IncidentLinks, userId: string): boolean {
  return reviewer || (Boolean(userId) && incident.assignedToUserId === userId);
}

/** Prisma-free where clause for the list (callers add organizationId). */
export function incidentVisibilityFilter(reviewer: boolean, userId: string) {
  if (reviewer) return {};
  return {
    OR: [
      { reporterUserId: userId },
      { assignedToUserId: userId },
      { involvedStaffIds: { has: userId } },
    ],
  };
}

/** Next INC-YYYY-NNN after the given numbers (same format the page used). */
export function nextIncidentNumber(existing: string[], year: number): string {
  const nums = existing
    .map((n) => {
      const m = /^INC-(\d{4})-(\d+)$/i.exec(n);
      return m && Number(m[1]) === year ? Number(m[2]) : 0;
    })
    .filter((n) => n > 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `INC-${year}-${String(next).padStart(3, '0')}`;
}
