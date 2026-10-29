/**
 * Care team on client cards (Oct 25): chips, seen-by (COMPLETED visits, last 18 months) and PCP state.
 * Pure — no Prisma, no React. The list API supplies `treatmentTeam` + `seenBy`; this builds the view model.
 */
import { isCaseloadRole } from '@/types/roles';

export const SEEN_BY_MONTHS = 18;
export const PCP_ROLE_LABEL = 'Primary care';
export const DEFAULT_MAX_CHIPS = 4;

export const UNASSIGNED_LABEL = 'Unassigned';
export const PCP_TO_CONFIRM = 'PCP: to confirm';
export const PCP_NOT_ASSIGNED = 'PCP: not assigned';
export const SET_AS_PCP = 'Set as PCP';

export type CareTeamSlot =
  | 'prescriber'
  | 'therapist'
  | 'caseManager'
  | 'prp'
  | 'peer'
  | 'primaryCare'
  | 'clinician';

/** Chip order and exact labels. */
export const CARE_TEAM_SLOT_ORDER: readonly CareTeamSlot[] = [
  'prescriber',
  'therapist',
  'caseManager',
  'prp',
  'peer',
  'primaryCare',
  'clinician',
];

export const CARE_TEAM_SLOT_LABELS: Record<CareTeamSlot, string> = {
  prescriber: 'Prescriber',
  therapist: 'Therapist',
  caseManager: 'Case manager',
  prp: 'PRP',
  peer: 'Peer',
  primaryCare: 'Primary care',
  clinician: 'Clinician',
};

/** A provider who completed a visit with the client in the seen-by window. */
export type SeenByProvider = {
  providerId: string | null;
  name: string;
  /** Staff role (User.role) when the provider is a known user; null for unmapped imported names. */
  role: string | null;
  /** ISO timestamp of the most recent COMPLETED visit. */
  lastSeenAt: string;
  /** medicalVisit = a primary-care encounter (MedicalVisit); appointment = a scheduled BH/other visit. */
  source: 'appointment' | 'medicalVisit';
};

export type CareTeamMember = {
  id: string | null;
  name: string | null;
  slot: CareTeamSlot;
  primary: boolean;
};

export type CareTeamChip = {
  key: string;
  slot: CareTeamSlot;
  /** Slot label. */
  label: string;
  name: string | null;
  kind: 'assigned' | 'seen';
  /** ISO date of the last completed visit (seen chips). */
  lastSeenAt?: string;
  /** Exact chip text. */
  text: string;
};

export type PcpCandidate = { providerId: string | null; name: string; canSet: boolean; lastSeenAt: string };

export type PcpState =
  | { status: 'assigned'; name: string; text: string }
  | { status: 'to_confirm'; candidates: PcpCandidate[]; text: string; seenByText: string }
  | { status: 'not_assigned'; text: string };

export type CareTeamSummaryModel = {
  /** null → render "Unassigned". */
  primary: { name: string; slot: string; text: string } | null;
  chips: CareTeamChip[];
  moreCount: number;
  moreTitle: string;
  pcp: PcpState;
};

export function slotForRoleText(role: string | null | undefined): CareTeamSlot {
  const r = (role ?? '').toLowerCase().replace(/_/g, ' ');
  if (!r) return 'clinician';
  if (/primary\s*care|\bpcp\b|physician/.test(r)) return 'primaryCare';
  if (/prescrib|psychiatr/.test(r) || r === 'np' || /nurse\s*pract/.test(r)) return 'prescriber';
  if (/therap|counsel/.test(r)) return 'therapist';
  if (/case/.test(r)) return 'caseManager';
  if (/\bprp\b|rehab/.test(r)) return 'prp';
  if (/peer/.test(r)) return 'peer';
  return 'clinician';
}

/** Slot for a provider's staff role (seen-by + PCP picking). */
export function slotForStaffRole(role: string | null | undefined): CareTeamSlot {
  switch ((role ?? '').toUpperCase()) {
    case 'PSYCHIATRIST':
    case 'NP':
      return 'prescriber';
    case 'THERAPIST':
      return 'therapist';
    case 'CASE_MANAGER':
      return 'caseManager';
    case 'PRP_SPECIALIST':
      return 'prp';
    case 'PEER_SUPPORT':
      return 'peer';
    case 'PHYSICIAN':
    case 'MEDICAL_NP':
      return 'primaryCare';
    default:
      return 'clinician';
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

const OBJECT_SLOTS: Array<{ slot: CareTeamSlot; id: string; name: string }> = [
  { slot: 'therapist', id: 'primaryTherapistId', name: 'primaryTherapistName' },
  { slot: 'prescriber', id: 'prescriberId', name: 'prescriberName' },
  { slot: 'caseManager', id: 'caseManagerId', name: 'caseManagerName' },
  { slot: 'prp', id: 'prpSpecialistId', name: 'prpSpecialistName' },
  { slot: 'peer', id: 'peerSupportId', name: 'peerSupportName' },
  { slot: 'primaryCare', id: 'primaryCareId', name: 'primaryCareName' },
];

/** Accepts both stored shapes: the 5-slot object and the member array. */
export function normalizeCareTeam(raw: unknown): CareTeamMember[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((m): CareTeamMember[] => {
      if (!m || typeof m !== 'object') return [];
      const o = m as Record<string, unknown>;
      const name = str(o.name);
      const id = str(o.id) ?? str(o.providerId);
      if (!name && !id) return [];
      return [
        {
          id,
          name,
          slot: slotForRoleText(str(o.role)),
          primary: o.primary === true || o.isPrimary === true,
        },
      ];
    });
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    return OBJECT_SLOTS.flatMap(({ slot, id, name }): CareTeamMember[] => {
      const memberId = str(o[id]);
      if (!memberId) return [];
      return [{ id: memberId, name: str(o[name]), slot, primary: false }];
    });
  }
  return [];
}

function sameProvider(
  a: { id: string | null; name: string | null },
  b: { id: string | null; name: string | null }
): boolean {
  if (a.id && b.id) return a.id === b.id;
  return Boolean(a.name && b.name && a.name.trim().toLowerCase() === b.name.trim().toLowerCase());
}

export type CareTeamSummaryInput = {
  treatmentTeam: unknown;
  assignedToId?: string | null;
  assignedToName?: string | null;
  /** Staff role of the assigned user. A non-clinical assignee (e.g. an importing admin) is not a clinician. */
  assignedToRole?: string | null;
  seenBy?: SeenByProvider[] | null;
  maxChips?: number;
};

function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

export function buildCareTeamSummary(input: CareTeamSummaryInput): CareTeamSummaryModel {
  const members = normalizeCareTeam(input.treatmentTeam);
  const seenBy = [...(input.seenBy ?? [])].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  const max = Math.max(1, input.maxChips ?? DEFAULT_MAX_CHIPS);

  // ── Primary ────────────────────────────────────────────────────────────────
  const assignedIsClinician = !input.assignedToRole || isCaseloadRole(input.assignedToRole);
  const assignedName = assignedIsClinician ? str(input.assignedToName) : null;

  let primary: CareTeamSummaryModel['primary'] = null;
  const flagged = members.find((m) => m.primary && m.name);
  if (flagged) {
    const slot = CARE_TEAM_SLOT_LABELS[flagged.slot];
    primary = { name: flagged.name!, slot, text: `${flagged.name} · ${slot}` };
  } else if (assignedName) {
    const match = members.find((m) => sameProvider(m, { id: input.assignedToId ?? null, name: assignedName }));
    const slot = CARE_TEAM_SLOT_LABELS[match?.slot ?? 'clinician'];
    primary = { name: assignedName, slot, text: `${assignedName} · ${slot}` };
  } else {
    const fallback = members.find((m) => m.name && (m.slot === 'therapist' || m.slot === 'prescriber'));
    if (fallback) {
      const slot = CARE_TEAM_SLOT_LABELS[fallback.slot];
      primary = { name: fallback.name!, slot, text: `${fallback.name} · ${slot}` };
    }
  }

  // ── Chips: assigned members, then providers who actually saw the client ──────
  const chips: CareTeamChip[] = [];
  for (const slot of CARE_TEAM_SLOT_ORDER) {
    const inSlot = members.filter((m) => m.slot === slot);
    if (inSlot.length === 0) continue;
    const label = CARE_TEAM_SLOT_LABELS[slot];
    const names = inSlot.map((m) => m.name).filter((n): n is string => Boolean(n));
    chips.push({
      key: `assigned:${slot}`,
      slot,
      label,
      name: names.length ? names.join(', ') : null,
      kind: 'assigned',
      text: label,
    });
  }

  const seenChips: CareTeamChip[] = [];
  for (const s of seenBy) {
    if (members.some((m) => sameProvider(m, { id: s.providerId, name: s.name }))) continue;
    const slot = s.source === 'medicalVisit' ? 'primaryCare' : slotForStaffRole(s.role);
    const label = CARE_TEAM_SLOT_LABELS[slot];
    seenChips.push({
      key: `seen:${s.providerId ?? s.name}`,
      slot,
      label,
      name: s.name,
      kind: 'seen',
      lastSeenAt: s.lastSeenAt,
      text: `${label} · seen: ${s.name}`,
    });
  }
  chips.push(...seenChips);

  const visible = chips.slice(0, max);
  const hidden = chips.slice(max);

  // ── PCP ────────────────────────────────────────────────────────────────────
  const assignedPcp = members.find((m) => m.slot === 'primaryCare');
  let pcp: PcpState;
  if (assignedPcp) {
    const name = assignedPcp.name ?? 'on file';
    pcp = { status: 'assigned', name, text: `PCP: ${name}` };
  } else {
    const candidates: PcpCandidate[] = [];
    for (const s of seenBy) {
      const isPcpLike = s.source === 'medicalVisit' || slotForStaffRole(s.role) === 'primaryCare';
      if (!isPcpLike) continue;
      if (candidates.some((c) => sameProvider({ id: c.providerId, name: c.name }, { id: s.providerId, name: s.name }))) {
        continue;
      }
      candidates.push({
        providerId: s.providerId,
        name: s.name,
        canSet: Boolean(s.providerId),
        lastSeenAt: s.lastSeenAt,
      });
    }
    pcp = candidates.length
      ? {
          status: 'to_confirm',
          candidates,
          text: PCP_TO_CONFIRM,
          seenByText: `seen by ${candidates.map((c) => c.name).join(', ')}`,
        }
      : { status: 'not_assigned', text: PCP_NOT_ASSIGNED };
  }

  return {
    primary,
    chips: visible,
    moreCount: hidden.length,
    moreTitle: hidden
      .map((c) => (c.kind === 'seen' ? `${c.text}${c.lastSeenAt ? ` (${shortDate(c.lastSeenAt)})` : ''}` : `${c.label}${c.name ? `: ${c.name}` : ''}`))
      .join('\n'),
    pcp,
  };
}
