/**
 * Primary care provider (PCP) assignment. Pure: no prisma, safe for tests and the browser bundle.
 * DB loading and writes live in pcpAssignmentDb.ts; scripts/check-pcp-assignments.ts and
 * scripts/fix-pcp-assignments.ts report and fix with these rules.
 *
 * CURRENT PCP (one canonical place)
 *   The care team member (ClientTreatmentTeamMember) with role PCP_TEAM_ROLE ("Primary Care
 *   Provider") and a providerId (a staff user). MedicalPatient.assignedPcp only mirrors that
 *   member's display name. While older charts are being fixed, a chart with no such member falls
 *   back to MedicalPatient.assignedPcp text: a staff user id, or the exact full name (case / spaces
 *   ignored) of exactly ONE staff member (the old intake form stored the user's name). Any other
 *   text is shown but counts as no PCP. Client.assignedToId is the behavioral health clinician and
 *   is never read or written here. "Primary Care Physician" / "Primary Care NP" care team rows (added
 *   for whoever did primary care intake) are care team facts, not a PCP assignment.
 *
 * EVIDENCE (primary care encounters; one per provider per calendar day, whatever the source)
 *   1. Valant Transaction Journal charges with facility "Family Practice". The provider code counts
 *      only when mapped to a staff user in ValantProviderMap; an unmapped code is reported, never
 *      guessed (the import's own name match is NOT used).
 *   2. MedicalVisit rows with a providerId (rows with only a typed name are counted as unattributed).
 *   3. COMPLETED appointments, in the past, whose clinician is a medical provider.
 *   Only medical providers (PHYSICIAN / MEDICAL_NP, role or extra roles, not deactivated) are PCP
 *   candidates. Encounters with other mapped staff are counted (nonMedicalEncounters) and listed.
 *
 * DECISION (industry practice: plurality of primary care visits, recency tie-break)
 *   - PCP = the provider with the most encounters in the last 12 months (PCP_WINDOW_MONTHS); a tie
 *     goes to the most recent encounter.
 *   - No encounter in 12 months: the provider of the most recent encounter ever.
 *   - Contenders: in the 12-month case, every provider within AMBIGUOUS_MARGIN (1) encounter of the
 *     top count.
 *   Statuses, in this order:
 *     NO_EVIDENCE        no attributable encounter at all (flagged primary care, no medical visit)
 *     MATCH              the current PCP is the evidence provider, or one of the contenders (a person
 *                        already chose between near-equal providers; that choice is kept)
 *     AMBIGUOUS          two or more contenders and the current PCP is not one of them
 *     UNMAPPED_PROVIDER  the evidence provider is an unmapped Valant provider code
 *     MISSING            no current PCP (staff user) recorded
 *     MISMATCH           the current PCP is someone else
 *   The fix script changes MISSING and MISMATCH only.
 */

import { normalizeStaffRole } from '@/lib/auth/rolePersonas';

export const PCP_TEAM_ROLE = 'Primary Care Provider';
/** Care team roles added for primary care staff at intake (care team facts, not a PCP assignment) */
export const PRIMARY_CARE_STAFF_TEAM_ROLES: readonly string[] = ['Primary Care Physician', 'Primary Care NP'];
/** Staff roles that may be a PCP */
export const PCP_PROVIDER_ROLES: readonly string[] = ['PHYSICIAN', 'MEDICAL_NP'];
export const PCP_WINDOW_MONTHS = 12;
export const AMBIGUOUS_MARGIN = 1;

export const PCP_STATUSES = ['MATCH', 'MISMATCH', 'MISSING', 'NO_EVIDENCE', 'AMBIGUOUS', 'UNMAPPED_PROVIDER'] as const;
export type PcpStatus = (typeof PCP_STATUSES)[number];
/** Statuses the roster's "PCP needs review" filter shows */
export const PCP_REVIEW_STATUSES: readonly PcpStatus[] = ['MISMATCH', 'MISSING', 'AMBIGUOUS'];
/** Statuses the fix script may change */
export const PCP_FIXABLE_STATUSES: readonly PcpStatus[] = ['MISSING', 'MISMATCH'];

export const PCP_STATUS_LABEL: Record<PcpStatus, string> = {
  MATCH: 'Matches visits',
  MISMATCH: 'Differs from visits',
  MISSING: 'No PCP set',
  NO_EVIDENCE: 'No medical visits yet',
  AMBIGUOUS: 'Seen by more than one provider',
  UNMAPPED_PROVIDER: 'Valant provider code not mapped',
};

/** Who may change a chart's PCP (front desk / leadership, and the medical providers themselves) */
export const PCP_EDITOR_ROLES: readonly string[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'OFFICE_MANAGER',
  'FRONT_DESK',
  'PHYSICIAN',
  'MEDICAL_NP',
];

export function canChangePcp(role: string | null | undefined): boolean {
  if (!role) return false;
  return PCP_EDITOR_ROLES.includes(String(normalizeStaffRole(role)).toUpperCase());
}

const normText = (s: string | null | undefined) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function isPcpTeamRole(role: string | null | undefined): boolean {
  return normText(role) === normText(PCP_TEAM_ROLE);
}

// ─── Staff ───────────────────────────────────────────────────────────────────

export type PcpStaff = {
  id: string;
  name: string | null;
  credentials?: string | null;
  role: string;
  roles?: readonly string[] | null;
  status: string;
};

/** Medical provider (PHYSICIAN / MEDICAL_NP, role or extra roles), not deactivated */
export function isPcpEligible(staff: PcpStaff | null | undefined): boolean {
  if (!staff || String(staff.status).toUpperCase() === 'DEACTIVATED') return false;
  const all = [staff.role, ...(staff.roles ?? [])].map((r) => String(r).toUpperCase());
  return all.some((r) => PCP_PROVIDER_ROLES.includes(r));
}

/** "Dana Doc, MD" (name as on the staff account; credentials when recorded) */
export function pcpDisplayName(staff: Pick<PcpStaff, 'name' | 'credentials'>): string {
  const name = String(staff.name ?? '').trim() || 'Provider';
  const cred = String(staff.credentials ?? '').trim();
  return cred ? `${name}, ${cred}` : name;
}

// ─── Current PCP ─────────────────────────────────────────────────────────────

export type PcpTeamRow = {
  id: string;
  providerId: string | null;
  name: string;
  role: string;
  credentials?: string | null;
  isPrimary: boolean;
};

export type CurrentPcp = {
  /** staff user id; null = text only (not a staff user): counts as no PCP */
  userId: string | null;
  displayName: string;
  source: 'care_team' | 'assigned_pcp_text';
  /** care team row id (source care_team) */
  memberId: string | null;
};

/**
 * The current PCP, from the canonical care team member, else the MedicalPatient.assignedPcp text
 * (staff id, or exact full name of exactly one staff member). Also returns how many PCP care team
 * rows the chart has (more than one is fixed by setting the PCP again).
 */
export function resolveCurrentPcp(input: {
  team: readonly PcpTeamRow[];
  assignedPcpTexts: readonly (string | null | undefined)[];
  staff: ReadonlyMap<string, PcpStaff>;
}): { current: CurrentPcp | null; pcpMemberCount: number } {
  const pcpRows = input.team.filter((m) => isPcpTeamRole(m.role) && m.providerId);
  const member = pcpRows[0];
  if (member) {
    const staff = input.staff.get(member.providerId!);
    return {
      current: {
        userId: member.providerId,
        displayName: staff ? pcpDisplayName(staff) : member.credentials ? `${member.name}, ${member.credentials}` : member.name,
        source: 'care_team',
        memberId: member.id,
      },
      pcpMemberCount: pcpRows.length,
    };
  }
  const text = input.assignedPcpTexts.map((t) => String(t ?? '').trim()).find(Boolean);
  if (!text) return { current: null, pcpMemberCount: 0 };
  const byId = input.staff.get(text);
  if (byId) return { current: { userId: byId.id, displayName: pcpDisplayName(byId), source: 'assigned_pcp_text', memberId: null }, pcpMemberCount: 0 };
  const want = normText(text);
  const hits = [...input.staff.values()].filter((s) => normText(s.name) === want || normText(pcpDisplayName(s)) === want);
  if (hits.length === 1) {
    return { current: { userId: hits[0].id, displayName: pcpDisplayName(hits[0]), source: 'assigned_pcp_text', memberId: null }, pcpMemberCount: 0 };
  }
  return { current: { userId: null, displayName: text, source: 'assigned_pcp_text', memberId: null }, pcpMemberCount: 0 };
}

// ─── Evidence ────────────────────────────────────────────────────────────────

export type EncounterSource = 'valant_charge' | 'medical_visit' | 'appointment';

/** One raw piece of evidence for one client, before mapping */
export type RawEncounter =
  | { source: 'valant_charge'; date: Date; providerCode: string | null }
  | { source: 'medical_visit'; date: Date; providerUserId: string | null }
  | { source: 'appointment'; date: Date; providerUserId: string | null };

export type ProviderTally = {
  /** u:<userId> for staff, c:<codeKey> for an unmapped Valant code */
  key: string;
  userId: string | null;
  /** unmapped Valant code as exported (null for staff) */
  code: string | null;
  inWindow: number;
  total: number;
  /** YYYY-MM-DD of the most recent encounter */
  lastDate: string;
};

export type EvidenceSummary = {
  tallies: ProviderTally[];
  /** encounters (provider-days) with mapped staff who are not medical providers, per user id */
  nonMedical: Map<string, number>;
  /** MedicalVisit rows with no providerId */
  unattributedVisits: number;
  /** Valant charges with a blank provider code */
  blankCodeCharges: number;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Start of the 12-month window: same calendar day PCP_WINDOW_MONTHS months before `now` (UTC) */
export function pcpWindowStart(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - PCP_WINDOW_MONTHS, now.getUTCDate()));
  return ymd(d);
}

/**
 * Attribute and de-duplicate encounters: one per provider per calendar day. Valant codes resolve only
 * through `codeMap` (codeKey -> userId); `codeKey` normalizes a code.
 */
export function tallyEncounters(input: {
  encounters: readonly RawEncounter[];
  codeMap: ReadonlyMap<string, string>;
  codeKey: (code: string | null | undefined) => string;
  staff: ReadonlyMap<string, PcpStaff>;
  now: Date;
}): EvidenceSummary {
  const windowStart = pcpWindowStart(input.now);
  const today = ymd(input.now);
  const days = new Map<string, Set<string>>();
  const meta = new Map<string, { userId: string | null; code: string | null }>();
  const nonMedicalDays = new Map<string, Set<string>>();
  let unattributedVisits = 0;
  let blankCodeCharges = 0;

  for (const e of input.encounters) {
    if (!(e.date instanceof Date) || Number.isNaN(e.date.getTime())) continue;
    const day = ymd(e.date);
    if (day > today) continue; // future rows are not encounters
    let userId: string | null = null;
    let code: string | null = null;
    if (e.source === 'valant_charge') {
      const key = input.codeKey(e.providerCode);
      if (!key) {
        blankCodeCharges += 1;
        continue;
      }
      userId = input.codeMap.get(key) ?? null;
      if (!userId) code = String(e.providerCode).trim().replace(/\s+/g, ' ');
    } else {
      userId = e.providerUserId;
      if (!userId) {
        if (e.source === 'medical_visit') unattributedVisits += 1;
        continue;
      }
    }
    if (userId && !isPcpEligible(input.staff.get(userId))) {
      const set = nonMedicalDays.get(userId) ?? new Set<string>();
      set.add(day);
      nonMedicalDays.set(userId, set);
      continue;
    }
    const key = userId ? `u:${userId}` : `c:${input.codeKey(code)}`;
    if (!meta.has(key)) meta.set(key, { userId, code });
    const set = days.get(key) ?? new Set<string>();
    set.add(day);
    days.set(key, set);
  }

  const tallies: ProviderTally[] = [...days.entries()].map(([key, set]) => {
    const sorted = [...set].sort();
    return {
      key,
      userId: meta.get(key)!.userId,
      code: meta.get(key)!.code,
      inWindow: sorted.filter((d) => d >= windowStart).length,
      total: sorted.length,
      lastDate: sorted[sorted.length - 1],
    };
  });
  return {
    tallies,
    nonMedical: new Map([...nonMedicalDays.entries()].map(([id, set]) => [id, set.size])),
    unattributedVisits,
    blankCodeCharges,
  };
}

/** Rank providers: 12-month count, then most recent, then key (stable) */
export function rankTallies(tallies: readonly ProviderTally[]): { ranked: ProviderTally[]; basis: 'window' | 'most_recent' | 'none' } {
  if (!tallies.length) return { ranked: [], basis: 'none' };
  const inWindow = tallies.filter((t) => t.inWindow > 0);
  if (inWindow.length) {
    const ranked = [...inWindow].sort(
      (a, b) => b.inWindow - a.inWindow || b.lastDate.localeCompare(a.lastDate) || a.key.localeCompare(b.key)
    );
    return { ranked, basis: 'window' };
  }
  const ranked = [...tallies].sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.total - a.total || a.key.localeCompare(b.key));
  return { ranked, basis: 'most_recent' };
}

export type PcpDecision = {
  status: PcpStatus;
  current: CurrentPcp | null;
  /** the evidence provider (top ranked); null for NO_EVIDENCE */
  evidence: ProviderTally | null;
  /** providers within AMBIGUOUS_MARGIN of the top (12-month case), top first */
  contenders: ProviderTally[];
  basis: 'window' | 'most_recent' | 'none';
  /** staff user the fix would set (MISSING / MISMATCH only), else null */
  proposedUserId: string | null;
};

export function decidePcp(input: { current: CurrentPcp | null; tallies: readonly ProviderTally[] }): PcpDecision {
  const { current } = input;
  const { ranked, basis } = rankTallies(input.tallies);
  const top = ranked[0] ?? null;
  const base = { current, evidence: top, basis } as const;
  if (!top) return { ...base, status: 'NO_EVIDENCE', contenders: [], proposedUserId: null };

  const contenders = basis === 'window' ? ranked.filter((t) => top.inWindow - t.inWindow <= AMBIGUOUS_MARGIN) : [top];
  const currentId = current?.userId ?? null;
  if (currentId && contenders.some((t) => t.userId === currentId)) {
    return { ...base, status: 'MATCH', contenders, proposedUserId: null };
  }
  if (contenders.length > 1) return { ...base, status: 'AMBIGUOUS', contenders, proposedUserId: null };
  if (!top.userId) return { ...base, status: 'UNMAPPED_PROVIDER', contenders, proposedUserId: null };
  if (!currentId) return { ...base, status: 'MISSING', contenders, proposedUserId: top.userId };
  return { ...base, status: 'MISMATCH', contenders, proposedUserId: top.userId };
}

/** Fix-script selection: only MISSING / MISMATCH (optionally narrowed with --only) */
export function shouldFix(decision: PcpDecision, only: PcpStatus | null = null): boolean {
  if (!decision.proposedUserId) return false;
  if (!PCP_FIXABLE_STATUSES.includes(decision.status)) return false;
  return !only || decision.status === only;
}

/**
 * MATCH whose PCP is known only from MedicalPatient.assignedPcp text (resolved to a staff user):
 * the PCP is right but not yet the canonical care team member. The fix script records it only
 * with --record-text-matches (it does not change who the PCP is).
 */
export function isTextOnlyMatch(decision: PcpDecision): boolean {
  return decision.status === 'MATCH' && decision.current?.source === 'assigned_pcp_text' && Boolean(decision.current.userId);
}

// ─── Review display (chart banner, primary care roster) ──────────────────────

export type PcpReviewContender = {
  userId: string | null;
  name: string;
  /** encounters in the 12-month window */
  inWindow: number;
  /** YYYY-MM-DD of the most recent encounter */
  lastDate: string;
  /** an active physician / medical NP: offered "Set as PCP" (an unmapped Valant code is not) */
  canSet: boolean;
};

/**
 * What to show when a primary care patient has no staff PCP of record:
 *   - AMBIGUOUS   -> "PCP: to confirm" with every contender ("seen by A, B")
 *   - NO_EVIDENCE -> "PCP: not assigned"
 * null otherwise (a PCP is set, or the status is handled by the usual review flag). One PCP of
 * record stays the rule: nothing is chosen here, staff confirm one contender.
 */
export type PcpReviewDisplay = {
  state: 'to_confirm' | 'not_assigned';
  label: string;
  contenders: PcpReviewContender[];
  /** "seen by Daniel Safo Kantanka, Rajan Sood" (empty for not_assigned) */
  seenBy: string;
};

export function pcpReviewDisplay(decision: Pick<PcpDecision, 'status' | 'current' | 'contenders'>, staff: ReadonlyMap<string, PcpStaff>): PcpReviewDisplay | null {
  if (decision.current?.userId) return null;
  if (decision.status === 'NO_EVIDENCE') return { state: 'not_assigned', label: 'PCP: not assigned', contenders: [], seenBy: '' };
  if (decision.status !== 'AMBIGUOUS') return null;
  const contenders = decision.contenders.map((t) => {
    const s = t.userId ? staff.get(t.userId) : undefined;
    return {
      userId: t.userId,
      name: s ? pcpDisplayName(s) : t.code ? `Valant code ${t.code} (not mapped)` : 'Unknown provider',
      inWindow: t.inWindow,
      lastDate: t.lastDate,
      canSet: Boolean(t.userId && s && isPcpEligible(s)),
    };
  });
  return { state: 'to_confirm', label: 'PCP: to confirm', contenders, seenBy: contenders.length ? `seen by ${contenders.map((c) => c.name).join(', ')}` : '' };
}

// ─── Setting the PCP (care team plan) ────────────────────────────────────────

export type SetPcpPlan = {
  /** already the only PCP member: nothing to write */
  noop: boolean;
  /** existing row of the new provider whose role becomes PCP_TEAM_ROLE */
  promoteMemberId: string | null;
  /** create a PCP_TEAM_ROLE row for the new provider */
  create: boolean;
  /** other PCP rows removed from the care team (the previous PCP keeps only "seen by" access) */
  removeMembers: { id: string; providerId: string | null; wasPrimary: boolean }[];
  previousUserId: string | null;
};

/**
 * Care team changes that make `newUserId` the one PCP. Idempotent: planning again after applying
 * returns noop. Never touches Client.assignedToId. Other care team rows (and PCP-role rows with no
 * staff link) are left alone.
 */
export function planSetPcp(team: readonly PcpTeamRow[], newUserId: string): SetPcpPlan {
  // Only staff-linked PCP rows; a PCP row with no providerId (e.g. an outside PCP noted by name) is left alone
  const pcpRows = team.filter((m) => isPcpTeamRole(m.role) && m.providerId);
  const previous = pcpRows.find((m) => m.providerId && m.providerId !== newUserId) ?? null;
  const removeMembers = pcpRows
    .filter((m) => m.providerId !== newUserId)
    .map((m) => ({ id: m.id, providerId: m.providerId, wasPrimary: m.isPrimary }));
  const ownPcp = pcpRows.filter((m) => m.providerId === newUserId);
  // a second PCP row for the same provider (should not exist) is removed too
  for (const extra of ownPcp.slice(1)) removeMembers.push({ id: extra.id, providerId: extra.providerId, wasPrimary: extra.isPrimary });
  const ownRow = ownPcp[0] ?? team.find((m) => m.providerId === newUserId) ?? null;
  const promoteMemberId = ownRow && !isPcpTeamRole(ownRow.role) ? ownRow.id : null;
  const create = !ownRow;
  return {
    noop: !removeMembers.length && !promoteMemberId && !create,
    promoteMemberId,
    create,
    removeMembers,
    previousUserId: previous?.providerId ?? null,
  };
}

/** Care team after a plan is applied (tests and previews) */
export function applySetPcpPlan(team: readonly PcpTeamRow[], plan: SetPcpPlan, newMember: PcpTeamRow): PcpTeamRow[] {
  const removed = new Set(plan.removeMembers.map((m) => m.id));
  const out = team
    .filter((m) => !removed.has(m.id))
    .map((m) => (m.id === plan.promoteMemberId ? { ...m, role: PCP_TEAM_ROLE } : m));
  if (plan.create) out.push({ ...newMember, role: PCP_TEAM_ROLE });
  return out;
}

// ─── Setting the PCP (write orchestration; storage injected) ─────────────────

export type SetPcpActor = { userId: string | null; role: string | null; via: 'chart' | 'intake' | 'fix-script' | 'visit-suggestion' };

export type SetPcpResult =
  | { ok: true; changed: boolean; previousUserId: string | null; displayName: string }
  | { ok: false; error: 'client_not_found' | 'not_medical_provider' };

/** Writes inside one transaction. There is deliberately no way to write Client.assignedToId. */
export type PcpWriteTx = {
  findClient(organizationId: string, clientId: string): Promise<{ id: string; mrn: string | null } | null>;
  team(clientId: string): Promise<PcpTeamRow[]>;
  deleteMembers(clientId: string, memberIds: string[]): Promise<void>;
  setMemberRole(memberId: string, role: string, assignedBy: string): Promise<void>;
  createMember(clientId: string, staff: PcpStaff, role: string, assignedBy: string): Promise<void>;
  /** MedicalPatient.assignedPcp = displayName on the linked rows that differ; returns rows changed */
  mirrorAssignedPcp(organizationId: string, client: { id: string; mrn: string | null }, displayName: string): Promise<number>;
  /** legacy Client.treatmentTeam JSON copy of the care team */
  syncTeamJson(clientId: string): Promise<void>;
};

export type PcpWriteStore = {
  findStaff(organizationId: string, userId: string): Promise<PcpStaff | null>;
  transaction<T>(fn: (tx: PcpWriteTx) => Promise<T>): Promise<T>;
  audit(entry: {
    organizationId: string;
    actorUserId: string | null;
    actorRole: string | null;
    clientId: string;
    requestMeta?: { ipAddress: string | null; userAgent: string | null };
    metadata: Record<string, unknown>;
  }): Promise<void>;
};

/**
 * Make `newUserId` the client's one PCP care team member and mirror MedicalPatient.assignedPcp.
 * Previous PCP rows are removed from the care team (that provider keeps "seen by" access through
 * their visits / appointments only). Idempotent: a repeat call writes nothing and is not audited.
 * Every change is audited (ids and counts only).
 */
export async function runSetPcp(
  store: PcpWriteStore,
  input: {
    organizationId: string;
    clientId: string;
    newUserId: string;
    actor: SetPcpActor;
    auditDetail?: Record<string, unknown>;
    requestMeta?: { ipAddress: string | null; userAgent: string | null };
  }
): Promise<SetPcpResult> {
  const staff = await store.findStaff(input.organizationId, input.newUserId);
  if (!staff || !isPcpEligible(staff)) return { ok: false, error: 'not_medical_provider' };
  const displayName = pcpDisplayName(staff);
  const assignedBy = `pcp:${input.actor.via}`;

  const result = await store.transaction(async (tx) => {
    const client = await tx.findClient(input.organizationId, input.clientId);
    if (!client) return null;
    const plan = planSetPcp(await tx.team(client.id), staff.id);
    if (plan.removeMembers.length) await tx.deleteMembers(client.id, plan.removeMembers.map((m) => m.id));
    if (plan.promoteMemberId) await tx.setMemberRole(plan.promoteMemberId, PCP_TEAM_ROLE, assignedBy);
    if (plan.create) await tx.createMember(client.id, staff, PCP_TEAM_ROLE, assignedBy);
    const mirrored = await tx.mirrorAssignedPcp(input.organizationId, client, displayName);
    if (!plan.noop) await tx.syncTeamJson(client.id);
    return { plan, mirrored };
  });
  if (!result) return { ok: false, error: 'client_not_found' };

  const changed = !result.plan.noop || result.mirrored > 0;
  if (changed) {
    await store.audit({
      organizationId: input.organizationId,
      actorUserId: input.actor.userId,
      actorRole: input.actor.role,
      clientId: input.clientId,
      requestMeta: input.requestMeta,
      metadata: {
        via: input.actor.via,
        previousProviderId: result.plan.previousUserId,
        newProviderId: staff.id,
        careTeamChanged: !result.plan.noop,
        removedMemberIds: result.plan.removeMembers.map((m) => m.id),
        removedPrimaryMember: result.plan.removeMembers.some((m) => m.wasPrimary),
        promotedMemberId: result.plan.promoteMemberId,
        createdMember: result.plan.create,
        medicalPatientRowsMirrored: result.mirrored,
        ...(input.auditDetail ?? {}),
      },
    });
  }
  return { ok: true, changed, previousUserId: result.plan.previousUserId, displayName };
}

// ─── Access (mirror of medicalCareTeamClientWhere) ───────────────────────────

export type CareLinkSnapshot = {
  assignedToId: string | null;
  team: readonly { providerId: string | null }[];
  visitProviderIds: readonly (string | null)[];
  appointmentClinicianIds: readonly (string | null)[];
};

/**
 * Why a physician / medical NP may open a chart under the care-team rule
 * (src/lib/clients/orgScope.ts medicalCareTeamClientWhere): assigned, care team member, or
 * "seen by" (a medical visit or appointment). null = no access.
 */
export function medicalAccessBasis(userId: string, c: CareLinkSnapshot): 'assigned' | 'care_team' | 'seen_by' | null {
  if (c.assignedToId === userId) return 'assigned';
  if (c.team.some((m) => m.providerId === userId)) return 'care_team';
  if (c.visitProviderIds.includes(userId) || c.appointmentClinicianIds.includes(userId)) return 'seen_by';
  return null;
}

// ─── Visit signing suggestion ────────────────────────────────────────────────

/**
 * After a medical provider signs a visit: suggest making them the PCP when the chart has no PCP.
 * Never assigns; staff confirm with the PCP picker.
 */
export function pcpSuggestionAfterVisit(input: { current: CurrentPcp | null; signer: PcpStaff | null }): { userId: string; displayName: string } | null {
  if (input.current?.userId) return null;
  if (!input.signer || !isPcpEligible(input.signer)) return null;
  return { userId: input.signer.id, displayName: pcpDisplayName(input.signer) };
}
