/**
 * Clients assigned to a non-clinical user (usually the admin who imported or created them).
 * Pure helpers shared by scripts/report-admin-assigned-clients.ts and its tests.
 */
import { isCaseloadRole } from '@/types/roles';
import { slotForRoleText, slotForStaffRole, type CareTeamSlot } from './careTeamSummary';

/** An assignee who is not on a caseload role (admin, director, front desk, billing, HR…). */
export function isNonClinicalAssignee(role: string | null | undefined): boolean {
  return Boolean(role) && !isCaseloadRole(role);
}

export type SuggestionCandidate = {
  providerId: string;
  /** Staff role (User.role). */
  role: string;
  /** Care-team slot text, e.g. "Therapist" (null for seen-by candidates). */
  teamRole: string | null;
  isPrimary: boolean;
  source: 'careTeam' | 'seenBy';
  /** ISO timestamp for seen-by ordering. */
  lastSeenAt?: string;
};

function slotOf(c: SuggestionCandidate): CareTeamSlot {
  return c.teamRole ? slotForRoleText(c.teamRole) : slotForStaffRole(c.role);
}

const SLOT_PRIORITY: CareTeamSlot[] = ['therapist', 'prescriber', 'caseManager', 'prp', 'peer', 'clinician'];

/**
 * Pick the clinician to suggest as the client's assignee. Only real clinical staff qualify, and
 * only people already tied to the client: care-team members first (flagged primary, then by slot),
 * then whoever completed the most recent visit. Returns null when there is nobody — never a guess.
 */
export function pickSuggestedClinician(candidates: SuggestionCandidate[]): SuggestionCandidate | null {
  const clinical = candidates.filter((c) => isCaseloadRole(c.role) && slotOf(c) !== 'primaryCare');

  const team = clinical.filter((c) => c.source === 'careTeam');
  const primary = team.find((c) => c.isPrimary);
  if (primary) return primary;
  for (const slot of SLOT_PRIORITY) {
    const hit = team.find((c) => slotOf(c) === slot);
    if (hit) return hit;
  }

  const seen = clinical
    .filter((c) => c.source === 'seenBy')
    .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));
  return seen[0] ?? null;
}
