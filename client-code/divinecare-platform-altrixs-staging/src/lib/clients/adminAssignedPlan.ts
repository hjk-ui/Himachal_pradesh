/**
 * Clients assigned to a non-clinical account (e.g. the admin a Valant import defaulted to): what a
 * cleanup would do. Pure; used by scripts/report-admin-assigned-clients.ts (counts only).
 *
 * Suggested clinician = the clinician on the client's most recent completed visit, only when that
 * person has a caseload role and is active (a clear answer). Everyone else would go to NULL
 * (Unassigned / "No clinician"), never to another guess.
 */
import { isCaseloadAssignee, type AssigneeRoleRef } from '@/lib/clients/careTeam';

export type CompletedVisitRow = { clientId: string; clinicianId: string | null; startsAt: Date };
export type PlanStaff = AssigneeRoleRef & { id: string; status?: string | null };

export type AdminAssignedPlan = {
  /** clientId -> suggested clinician id, or null (would be unassigned) */
  decisions: Map<string, string | null>;
  counts: {
    total: number;
    withCompletedVisit: number;
    withoutCompletedVisit: number;
    suggested: number;
    toUnassigned: number;
    /** had a visit, but the latest visit's clinician is missing / not clinical / inactive */
    unclearLatestClinician: number;
    distinctSuggestedClinicians: number;
  };
};

export function planAdminAssigned(
  clientIds: readonly string[],
  visits: readonly CompletedVisitRow[],
  staff: readonly PlanStaff[]
): AdminAssignedPlan {
  const latest = new Map<string, CompletedVisitRow>();
  for (const v of visits) {
    const cur = latest.get(v.clientId);
    if (!cur || v.startsAt.getTime() > cur.startsAt.getTime()) latest.set(v.clientId, v);
  }
  const byId = new Map(staff.map((s) => [s.id, s]));
  const decisions = new Map<string, string | null>();
  const suggestedIds = new Set<string>();
  let withVisit = 0;
  let unclear = 0;
  for (const id of clientIds) {
    const v = latest.get(id);
    if (!v) {
      decisions.set(id, null);
      continue;
    }
    withVisit += 1;
    const s = v.clinicianId ? byId.get(v.clinicianId) : undefined;
    const ok = Boolean(s && isCaseloadAssignee(s) && (!s.status || s.status === 'ACTIVE'));
    if (ok) {
      decisions.set(id, s!.id);
      suggestedIds.add(s!.id);
    } else {
      decisions.set(id, null);
      unclear += 1;
    }
  }
  const suggested = [...decisions.values()].filter(Boolean).length;
  return {
    decisions,
    counts: {
      total: clientIds.length,
      withCompletedVisit: withVisit,
      withoutCompletedVisit: clientIds.length - withVisit,
      suggested,
      toUnassigned: clientIds.length - suggested,
      unclearLatestClinician: unclear,
      distinctSuggestedClinicians: suggestedIds.size,
    },
  };
}
