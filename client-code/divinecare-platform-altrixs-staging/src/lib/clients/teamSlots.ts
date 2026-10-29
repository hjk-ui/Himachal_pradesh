/** Pure helpers for the treatment-team slot object (warm handoff / Assign Clinician). No prisma. */
/** Warm-handoff / Assign Clinician slot -> the treatment-team row role it creates (primary = Client.assignedToId). */
export const TEAM_SLOT_ROLES = {
  prescriberId: 'Prescriber',
  caseManagerId: 'Case Manager',
  prpSpecialistId: 'PRP Specialist',
  peerSupportId: 'Peer Support',
} as const;

export type SlotTeam = Record<string, unknown> | null | undefined;

const slotId = (team: SlotTeam, key: string): string | null => {
  const v = team && !Array.isArray(team) ? team[key] : null;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

/**
 * Pure: which treatment-team rows a slot change (PATCH treatmentTeam object) adds / removes.
 * A staff member put in a slot gets a ClientTreatmentTeamMember row (that row is what grants chart
 * access, orgScope.clientAccessWhere); the person replaced in a slot loses that slot's row (they
 * keep access only if still assigned, on the team another way, or seeing the client).
 */
export function teamSlotChanges(before: SlotTeam, after: SlotTeam): {
  add: { providerId: string; role: string }[];
  remove: { providerId: string; role: string }[];
} {
  const add: { providerId: string; role: string }[] = [];
  const remove: { providerId: string; role: string }[] = [];
  for (const [key, role] of Object.entries(TEAM_SLOT_ROLES)) {
    if (!after || Array.isArray(after) || !(key in after)) continue; // slot not in this update
    const prev = slotId(before, key);
    const next = slotId(after, key);
    if (next === prev) continue;
    if (next) add.push({ providerId: next, role });
    if (prev) remove.push({ providerId: prev, role });
  }
  return { add, remove };
}

