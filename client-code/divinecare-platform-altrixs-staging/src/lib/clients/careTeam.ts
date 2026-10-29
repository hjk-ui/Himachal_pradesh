/**
 * Compact care team for the client list / cards / chart banner: the primary clinician first, then
 * the other treatment team members (ClientTreatmentTeamMember rows and the legacy Client.treatmentTeam
 * JSON slots), deduped, sorted by slot (Prescriber, Therapist, Case manager, PRP, Peer, other).
 *
 * Imported charts: Valant's primary provider is usually the prescriber, so the therapist lives only
 * on the care team; showing just Client.assignedTo hid them. Some imports defaulted assignedToId to
 * the importing admin when Valant had no provider: a non-clinical assignee (Admin, Office Manager,
 * Front Desk, Billing, HR...) is shown and counted as Unassigned. Data is never changed here.
 *
 * "Seen by": every other treating provider with a completed visit in the last 18 months is listed
 * after the team (label "<role> · seen", last-seen date in the tooltip), so a client seen by more
 * than one provider lists all of them. There is still one primary of record.
 *
 * Pure: no prisma; safe for client components and tests.
 */
import type { Prisma, Role } from '@prisma/client';
import { CLINICAL_SPECIALTY_ROLES } from '@/types/roles';

/** Roles that carry a caseload (Client.assignedToId means "primary clinician" only for these). */
export const CASELOAD_ROLE_VALUES = ['CLINICIAN', ...CLINICAL_SPECIALTY_ROLES] as const;
/** System / leadership accounts: never a primary clinician, even with extra clinical roles for Role Preview. */
const SYSTEM_ROLES = ['ADMIN', 'SUPER_ADMIN'];

export type AssigneeRoleRef = { role?: string | null; roles?: readonly (string | null | undefined)[] | null };

/**
 * True when the assigned user is a real primary clinician: a caseload primary role, or (for
 * leadership such as a medical director with role PRACTICE_DIRECTOR) a caseload role in roles[].
 * ADMIN / SUPER_ADMIN are never clinical assignees.
 */
export function isCaseloadAssignee(user: AssigneeRoleRef | null | undefined): boolean {
  if (!user) return false;
  const role = String(user.role ?? '').toUpperCase();
  if ((CASELOAD_ROLE_VALUES as readonly string[]).includes(role)) return true;
  if (SYSTEM_ROLES.includes(role)) return false;
  return (user.roles ?? []).some((r) => (CASELOAD_ROLE_VALUES as readonly string[]).includes(String(r ?? '').toUpperCase()));
}

/** Prisma filter: Client.assignedTo is a non-clinical user (mirror of isCaseloadAssignee). */
export function nonClinicalAssigneeUserWhere(): Prisma.UserWhereInput {
  const caseload = [...CASELOAD_ROLE_VALUES] as Role[];
  return {
    OR: [
      { role: { in: SYSTEM_ROLES as Role[] } },
      { AND: [{ role: { notIn: caseload } }, { NOT: { roles: { hasSome: caseload } } }] },
    ],
  };
}

/** No clinical primary: assignedToId NULL or assigned to a non-clinical user. */
export function noClinicalPrimaryWhere(): Prisma.ClientWhereInput {
  return { OR: [{ assignedToId: null }, { assignedTo: nonClinicalAssigneeUserWhere() }] };
}

export type CareTeamSlot = 'Prescriber' | 'Therapist' | 'Case manager' | 'PRP' | 'Peer' | 'Primary care' | 'Clinician';
const SLOT_ORDER: CareTeamSlot[] = ['Prescriber', 'Therapist', 'Case manager', 'PRP', 'Peer', 'Primary care', 'Clinician'];

/** Slot for a staff Role enum value (assignedTo.role, linked provider's role). */
export function slotForStaffRole(role: string | null | undefined): CareTeamSlot | null {
  switch (String(role ?? '').toUpperCase()) {
    case 'PSYCHIATRIST':
    case 'NP':
    case 'NURSE_PRACTITIONER':
      return 'Prescriber';
    case 'THERAPIST':
    case 'CLINICIAN':
    case 'CLINICAL_SUPERVISOR':
      return 'Therapist';
    case 'CASE_MANAGER':
      return 'Case manager';
    case 'PRP_SPECIALIST':
      return 'PRP';
    case 'PEER_SUPPORT':
      return 'Peer';
    case 'PHYSICIAN':
    case 'MEDICAL_NP':
    case 'MEDICAL_ASSISTANT':
      return 'Primary care';
    default:
      return null;
  }
}

/** Slot for a free-text team role ("Psychiatrist", "Nurse Practitioner", "Therapist", "PCP"...). */
export function slotForTeamRole(teamRole: string | null | undefined): CareTeamSlot | null {
  const r = String(teamRole ?? '').toLowerCase();
  if (!r.trim()) return null;
  if (/primary care|\bpcp\b|family|internal med/.test(r)) return 'Primary care';
  if (/psychiatr|prescrib|nurse practitioner|\bnp\b|pmhnp|crnp|med(ication)? manag/.test(r)) return 'Prescriber';
  if (/case manag|case mgr|care coord/.test(r)) return 'Case manager';
  if (/\bprp\b|psychiatric rehab|rehabilitation/.test(r)) return 'PRP';
  if (/peer/.test(r)) return 'Peer';
  if (/therap|counsel|social work|lcsw|lcpc|lgpc|psycholog/.test(r)) return 'Therapist';
  return null;
}

/** Display label: the team role's slot, else the linked staff role's slot, else "Clinician". */
export function careTeamLabel(teamRole: string | null | undefined, staffRole?: string | null): CareTeamSlot {
  return slotForTeamRole(teamRole) ?? slotForStaffRole(staffRole) ?? 'Clinician';
}

export type CareTeamPerson = {
  id: string | null;
  name: string;
  label: CareTeamSlot;
  /** true for a provider who saw the client (completed appointment / medical visit) but is not on the team */
  seen?: boolean;
  /** YYYY-MM-DD of the most recent completed visit (seen-by members only) */
  lastSeen?: string | null;
};

export type ClientCareTeam = {
  /** Primary clinician (Client.assignedTo with a caseload role); null when none or non-clinical */
  primary: CareTeamPerson | null;
  /** Why there is no primary: none set, or the assignee is a non-clinical account (e.g. the importing admin) */
  primaryStatus: 'assigned' | 'none' | 'non_clinical';
  /** Other members (team by slot then name, then seen-by by most recent visit), capped at CARE_TEAM_CAP */
  members: CareTeamPerson[];
  /** Every other member, uncapped (tooltip / "+N more" popover / chart banner list) */
  allMembers: CareTeamPerson[];
  /** All other members before the cap (for "+N more") */
  memberCount: number;
  /** Full list for a tooltip ("Therapist: Stephanie Walker; Prescriber · seen: Rajan Sood (last seen Oct 3, 2026)") */
  summary: string;
};

export const CARE_TEAM_CAP = 4;

export type CareTeamClientRow = {
  id: string;
  assignedToId: string | null;
  assignedTo: { id?: string; name: string | null; role?: string | null; roles?: readonly string[] | null } | null;
  /** Legacy JSON slots (Client.treatmentTeam) */
  treatmentTeam?: unknown;
};

export type CareTeamMemberRow = { clientId: string; providerId: string | null; name: string; role: string };
export type CareTeamStaffRef = { id: string; name: string | null; role: string | null; roles?: readonly string[] | null; status?: string | null };

/**
 * "Seen by": a provider with a COMPLETED appointment (any source, incl. imported Valant history) or a
 * MedicalVisit for the client in the last SEEN_BY_WINDOW_MONTHS; one row per client + provider with
 * the most recent date (grouped query). Eligibility (clinical / medical role, not deactivated) is
 * checked here against the staff ref so the rule lives in one place.
 */
export type CareTeamSeenRow = { clientId: string; providerId: string; lastSeen: Date | string };
export const SEEN_BY_WINDOW_MONTHS = 18;

/** Start of the seen-by window: same calendar day SEEN_BY_WINDOW_MONTHS months before `now` (UTC) */
export function seenByWindowStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - SEEN_BY_WINDOW_MONTHS, now.getUTCDate()));
}

/** A treating provider for "Seen by": caseload / clinical / medical role (not a medical assistant), not deactivated */
export function isSeenByEligible(staff: CareTeamStaffRef | null | undefined): boolean {
  if (!staff) return false;
  if (String(staff.status ?? '').toUpperCase() === 'DEACTIVATED') return false;
  const role = String(staff.role ?? '').toUpperCase();
  const roles = (staff.roles ?? []).map((r) => String(r ?? '').toUpperCase()).filter((r) => r !== 'MEDICAL_ASSISTANT');
  return isCaseloadAssignee({ role: role === 'MEDICAL_ASSISTANT' ? null : role, roles });
}

const ymdOf = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** "Oct 3, 2026" from YYYY-MM-DD (UTC, so the day never shifts) */
export function formatSeenDate(ymd: string | null | undefined): string {
  if (!ymd) return '';
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Display label for one member: "Therapist" or "Prescriber · seen" */
export function careTeamPersonLabel(p: CareTeamPerson): string {
  return p.seen ? `${p.label} · seen` : p.label;
}

/** Tooltip / popover line: "Prescriber · seen: Rajan Sood (last seen Oct 3, 2026)" */
export function careTeamPersonLine(p: CareTeamPerson): string {
  const when = p.seen && p.lastSeen ? ` (last seen ${formatSeenDate(p.lastSeen)})` : '';
  return `${careTeamPersonLabel(p)}: ${p.name}${when}`;
}

const JSON_SLOTS: Array<[idKey: string, nameKey: string, label: CareTeamSlot]> = [
  ['prescriberId', 'prescriberName', 'Prescriber'],
  ['primaryTherapistId', 'primaryTherapistName', 'Therapist'],
  ['caseManagerId', 'caseManagerName', 'Case manager'],
  ['prpSpecialistId', 'prpSpecialistName', 'PRP'],
  ['peerSupportId', 'peerSupportName', 'Peer'],
];

const nameKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** One client's care team (primary first; others deduped, sorted, capped). */
export function buildClientCareTeam(
  client: CareTeamClientRow,
  members: readonly CareTeamMemberRow[],
  staffById: ReadonlyMap<string, CareTeamStaffRef> = new Map(),
  seenRows: readonly CareTeamSeenRow[] = [],
  now: Date = new Date()
): ClientCareTeam {
  const a = client.assignedTo;
  const clinical = Boolean(client.assignedToId && a && isCaseloadAssignee(a));
  const primaryStatus: ClientCareTeam['primaryStatus'] = !client.assignedToId ? 'none' : clinical ? 'assigned' : 'non_clinical';
  const primary: CareTeamPerson | null =
    clinical && a ? { id: client.assignedToId, name: a.name || 'Clinician', label: slotForStaffRole(a.role) ?? 'Clinician' } : null;

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  if (client.assignedToId) seenIds.add(client.assignedToId);
  // Excluding the primary also by name: an unlinked import row may repeat the primary's name
  if (primary) seenNames.add(nameKey(primary.name));
  const others: CareTeamPerson[] = [];
  const add = (id: string | null, rawName: string | null | undefined, label: CareTeamSlot) => {
    const staff = id ? staffById.get(id) : undefined;
    const name = (staff?.name || rawName || '').trim();
    if (!name) return;
    if (id && seenIds.has(id)) return;
    if (seenNames.has(nameKey(name))) return;
    if (id) seenIds.add(id);
    seenNames.add(nameKey(name));
    others.push({ id, name, label });
  };
  for (const m of members) {
    if (m.clientId !== client.id) continue;
    const staff = m.providerId ? staffById.get(m.providerId) : undefined;
    add(m.providerId, m.name, careTeamLabel(m.role, staff?.role));
  }
  const json = client.treatmentTeam && typeof client.treatmentTeam === 'object' ? (client.treatmentTeam as Record<string, unknown>) : null;
  if (json) {
    for (const [idKey, nk, label] of JSON_SLOTS) {
      const id = typeof json[idKey] === 'string' && json[idKey] ? (json[idKey] as string) : null;
      const name = typeof json[nk] === 'string' ? (json[nk] as string) : null;
      if (id || name) add(id, name, label);
    }
  }
  others.sort(
    (x, y) => SLOT_ORDER.indexOf(x.label) - SLOT_ORDER.indexOf(y.label) || x.name.localeCompare(y.name, undefined, { sensitivity: 'base' })
  );

  // Seen by: providers not already the primary / on the team, most recent visit first (one entry each)
  const since = ymdOf(seenByWindowStart(now));
  const today = ymdOf(now);
  const latest = new Map<string, string>();
  for (const r of seenRows) {
    if (r.clientId !== client.id || !r.providerId) continue;
    const day = ymdOf(r.lastSeen);
    if (day < since || day > today) continue;
    const prev = latest.get(r.providerId);
    if (!prev || day > prev) latest.set(r.providerId, day);
  }
  const seen: CareTeamPerson[] = [];
  for (const [id, day] of latest) {
    const staff = staffById.get(id);
    if (!staff || !isSeenByEligible(staff)) continue;
    const name = (staff.name || '').trim();
    if (!name || seenIds.has(id) || seenNames.has(nameKey(name))) continue;
    seenIds.add(id);
    seenNames.add(nameKey(name));
    seen.push({ id, name, label: slotForStaffRole(staff.role) ?? 'Clinician', seen: true, lastSeen: day });
  }
  seen.sort((x, y) => (y.lastSeen ?? '').localeCompare(x.lastSeen ?? '') || x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));
  const all = [...others, ...seen];

  const summary = [...(primary ? [`Primary (${primary.label}): ${primary.name}`] : []), ...all.map(careTeamPersonLine)].join('; ');
  return { primary, primaryStatus, members: all.slice(0, CARE_TEAM_CAP), allMembers: all, memberCount: all.length, summary };
}

/** Care teams for one page of clients from one batched member query; locked ids get none. */
export function buildCareTeams(
  clients: readonly CareTeamClientRow[],
  members: readonly CareTeamMemberRow[],
  opts: { lockedIds?: ReadonlySet<string>; staff?: readonly CareTeamStaffRef[]; seen?: readonly CareTeamSeenRow[]; now?: Date } = {}
): Map<string, ClientCareTeam> {
  const byClient = new Map<string, CareTeamMemberRow[]>();
  for (const m of members) {
    const list = byClient.get(m.clientId);
    if (list) list.push(m);
    else byClient.set(m.clientId, [m]);
  }
  const seenByClient = new Map<string, CareTeamSeenRow[]>();
  for (const r of opts.seen ?? []) {
    const list = seenByClient.get(r.clientId);
    if (list) list.push(r);
    else seenByClient.set(r.clientId, [r]);
  }
  const staffById = new Map((opts.staff ?? []).map((s) => [s.id, s]));
  const now = opts.now ?? new Date();
  const out = new Map<string, ClientCareTeam>();
  for (const c of clients) {
    if (opts.lockedIds?.has(c.id)) continue;
    out.set(c.id, buildClientCareTeam(c, byClient.get(c.id) ?? [], staffById, seenByClient.get(c.id) ?? [], now));
  }
  return out;
}

/** Unassigned for the Assign clinician CTA / "No clinician" display: no clinical primary and nobody else on the team. */
export function careTeamIsUnassigned(team: ClientCareTeam | null | undefined): boolean {
  return !team || (!team.primary && team.memberCount === 0);
}
