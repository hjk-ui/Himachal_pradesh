import type { Prisma, Role, WaitlistUrgency } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { CLINICAL_SPECIALTY_ROLES } from '@/types/roles';
import {
  applySafetyScreen,
  canEditWaitlistEntry,
  canManageWaitlist,
  composeName,
  daysWaitingSince,
  deriveStage,
  findDuplicateCandidates,
  isOpenStage,
  nextNoResponseCount,
  serviceCategory,
  shouldPromptNoResponseClose,
  sortByPriority,
  splitName,
  stageAfterContact,
  statusForStage,
  validateClose,
  type ContactMethod,
  type ContactOutcome,
  type DuplicateMatch,
  type SafetyScreen,
  type WaitlistStage,
} from './standard';

/**
 * Waitlist persistence. Rules and vocabularies: src/lib/waitlist/standard.ts. Conversion:
 * src/lib/waitlist/convert.ts. Matching: src/lib/waitlist/matching.ts.
 * Every function is organization scoped. Callers audit (field names only, never values).
 */

/** Staff who can be matched from the waitlist (caseload + leadership). */
export const MATCHABLE_CLINICIAN_ROLES: Role[] = [
  'ADMIN',
  'PRACTICE_DIRECTOR',
  'DIRECTOR',
  'CLINICIAN',
  ...CLINICAL_SPECIALTY_ROLES,
];

/** View the waitlist (page + API): manage roles and clinicians; never HR / billing. */
export function canAccessWaitlist(role: Role) {
  return canAccessPath(role, '/dashboard/clients/waitlist');
}

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

function parseDateOnly(v?: string | null): Date | null | 'invalid' {
  const s = emptyToNull(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'invalid';
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getTime() > Date.now()) return 'invalid';
  return d;
}

function parseInstant(v?: string | null): Date | null | 'invalid' {
  const s = emptyToNull(v);
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

export const entryInclude = {
  clinician: { select: { id: true, name: true, email: true } },
  _count: { select: { contactAttempts: true } },
} satisfies Prisma.WaitlistEntryInclude;

type EntryRow = Prisma.WaitlistEntryGetPayload<{ include: typeof entryInclude }>;

export function serializeEntry(row: EntryRow) {
  const stage = deriveStage(row);
  const names = row.firstName || row.lastName ? { firstName: row.firstName ?? '', lastName: row.lastName ?? '' } : splitName(row.name);
  return {
    id: row.id,
    name: row.name,
    firstName: names.firstName,
    lastName: names.lastName,
    dateOfBirth: row.dateOfBirth ? row.dateOfBirth.toISOString().slice(0, 10) : null,
    email: row.email,
    phone: row.phone,
    preferredContactMethod: row.preferredContactMethod,
    bestTimeToContact: row.bestTimeToContact,
    guardianName: row.guardianName,
    guardianPhone: row.guardianPhone,
    guardianRelationship: row.guardianRelationship,
    specialty: row.specialty,
    service: serviceCategory(row.specialty),
    ageGroup: row.ageGroup,
    preferredLocationIds: row.preferredLocationIds ?? [],
    telehealthOk: row.telehealthOk,
    availabilityDays: row.availabilityDays ?? [],
    availabilityTimes: row.availabilityTimes ?? [],
    clinicianGenderPref: row.clinicianGenderPref,
    languagePref: row.languagePref,
    urgency: row.urgency.toLowerCase() as 'routine' | 'urgent' | 'crisis',
    status: row.status.toLowerCase() as 'waiting' | 'matched' | 'scheduled' | 'closed',
    stage,
    closeReason: row.closeReason,
    insurancePayer: row.insurancePayer,
    payerRegistryId: row.payerRegistryId,
    insuranceMemberId: row.insuranceMemberId,
    referralSource: row.referralSource,
    referringProvider: row.referringProvider,
    presentingConcern: row.presentingConcern,
    safetyScreen: (row.safetyScreen as SafetyScreen | null) ?? null,
    safetyScreenAt: row.safetyScreenAt?.toISOString() ?? null,
    notes: row.notes,
    preferredClinician: row.preferredClinician,
    clinicianId: row.clinicianId,
    clinicianName: row.clinician?.name || row.clinician?.email || null,
    convertedClientId: row.convertedClientId,
    convertedAppointmentId: row.convertedAppointmentId,
    matchedAt: row.matchedAt?.toISOString() ?? null,
    convertedAt: row.convertedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    nextFollowUpAt: row.nextFollowUpAt?.toISOString() ?? null,
    lastContactAt: row.lastContactAt?.toISOString() ?? null,
    noResponseCount: row.noResponseCount ?? 0,
    contactCount: row._count?.contactAttempts ?? 0,
    promptNoResponseClose: shouldPromptNoResponseClose(row.noResponseCount ?? 0, stage),
    createdById: row.createdById,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    daysWaiting: daysWaitingSince(row.createdAt),
  };
}
export type SerializedWaitlistEntry = ReturnType<typeof serializeEntry>;

type Urgency = 'routine' | 'urgent' | 'crisis';

export type WaitlistInput = {
  name?: string;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
  preferredContactMethod?: string | null;
  bestTimeToContact?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  guardianRelationship?: string | null;
  specialty?: string;
  ageGroup?: string | null;
  preferredLocationIds?: string[];
  telehealthOk?: boolean | null;
  availabilityDays?: string[];
  availabilityTimes?: string[];
  clinicianGenderPref?: string | null;
  languagePref?: string | null;
  urgency?: Urgency;
  insurancePayer?: string | null;
  payerRegistryId?: string | null;
  insuranceMemberId?: string | null;
  referralSource?: string | null;
  referringProvider?: string | null;
  presentingConcern?: string | null;
  safetyScreen?: SafetyScreen | null;
  notes?: string | null;
  preferredClinician?: string | null;
  /** Manual move between open stages (e.g. Ready to schedule) */
  stage?: WaitlistStage;
  /** Legacy PATCH status (closing now needs a reason: use closeWaitlistEntry) */
  status?: 'waiting' | 'matched' | 'scheduled' | 'closed';
};
export type CreateWaitlistInput = WaitlistInput & {
  specialty: string;
  /** Server-only: where the entry came from */
  source?: string | null;
  marketingLeadId?: string | null;
};
export type UpdateWaitlistInput = WaitlistInput;

function urgencyToDb(v?: string | null): WaitlistUrgency {
  const u = (v || 'routine').toLowerCase();
  if (u === 'urgent') return 'URGENT';
  if (u === 'crisis') return 'CRISIS';
  return 'ROUTINE';
}

/** Validated column data for create / update (only keys present in the input). */
async function buildData(
  organizationId: string,
  input: WaitlistInput,
  existing: { firstName: string | null; lastName: string | null } | null
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const data: Record<string, unknown> = {};
  const set = (k: keyof WaitlistInput) => {
    if (input[k] !== undefined) data[k] = emptyToNull(input[k] as string | null);
  };

  // Name: split parts win; a legacy single name is still accepted and split
  if (input.firstName !== undefined || input.lastName !== undefined) {
    const first = emptyToNull(input.firstName !== undefined ? input.firstName : existing?.firstName ?? null);
    const last = emptyToNull(input.lastName !== undefined ? input.lastName : existing?.lastName ?? null);
    const name = composeName(first, last, input.name ?? null);
    if (!first || !last || name.length < 2) return { ok: false, error: 'First and last name are required' };
    data.firstName = first;
    data.lastName = last;
    data.name = name;
  } else if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2) return { ok: false, error: 'Name is required' };
    data.name = name;
    const parts = splitName(name);
    data.firstName = parts.firstName || null;
    data.lastName = parts.lastName || null;
  }

  if (input.dateOfBirth !== undefined) {
    const d = parseDateOnly(input.dateOfBirth);
    if (d === 'invalid') return { ok: false, error: 'Date of birth must be a past date (YYYY-MM-DD)' };
    data.dateOfBirth = d;
  }
  if (input.email !== undefined) data.email = emptyToNull(input.email)?.toLowerCase() ?? null;
  set('phone');
  set('preferredContactMethod');
  set('bestTimeToContact');
  set('guardianName');
  set('guardianPhone');
  set('guardianRelationship');
  if (input.specialty !== undefined) {
    const s = input.specialty.trim();
    if (!s) return { ok: false, error: 'Service requested is required' };
    data.specialty = s;
  }
  set('ageGroup');
  if (input.preferredLocationIds !== undefined) {
    const ids = [...new Set(input.preferredLocationIds.filter(Boolean))].slice(0, 10);
    if (ids.length) {
      const found = await prisma.location.count({ where: { id: { in: ids }, organizationId, active: true } });
      if (found !== ids.length) return { ok: false, error: 'Unknown location' };
    }
    data.preferredLocationIds = ids;
  }
  if (input.telehealthOk !== undefined) data.telehealthOk = input.telehealthOk;
  if (input.availabilityDays !== undefined) data.availabilityDays = [...new Set(input.availabilityDays)];
  if (input.availabilityTimes !== undefined) data.availabilityTimes = [...new Set(input.availabilityTimes)];
  set('clinicianGenderPref');
  set('languagePref');
  if (input.urgency !== undefined) data.urgency = urgencyToDb(input.urgency);
  set('insurancePayer');
  if (input.payerRegistryId !== undefined) {
    const pid = emptyToNull(input.payerRegistryId);
    if (pid) {
      const payer = await prisma.payerRegistry.findFirst({ where: { id: pid, organizationId }, select: { id: true, name: true } });
      if (!payer) return { ok: false, error: 'Payer not found' };
      data.payerRegistryId = payer.id;
      if (!emptyToNull(input.insurancePayer)) data.insurancePayer = payer.name;
    } else data.payerRegistryId = null;
  }
  set('insuranceMemberId');
  set('referralSource');
  set('referringProvider');
  set('presentingConcern');
  set('notes');
  set('preferredClinician');
  return { ok: true, data };
}

/** Sets the safety screen columns; "yes" raises urgency. Returns true when crisis guidance applies. */
function applySafety(data: Record<string, unknown>, screen: SafetyScreen | null | undefined, currentUrgency: WaitlistUrgency, actorUserId: string | null) {
  if (screen === undefined) return false;
  data.safetyScreen = screen;
  data.safetyScreenAt = screen ? new Date() : null;
  data.safetyScreenById = screen ? actorUserId : null;
  const r = applySafetyScreen((data.urgency as WaitlistUrgency | undefined) ?? currentUrgency, screen);
  data.urgency = r.urgency;
  return r.crisisGuidance;
}

export async function listWaitlistClinicians(organizationId: string) {
  const users = await prisma.user.findMany({
    where: {
      organizationId,
      status: { in: ['ACTIVE', 'INVITED'] },
      role: { in: MATCHABLE_CLINICIAN_ROLES },
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true, role: true, image: true },
  });
  return users.map((u) => ({ id: u.id, name: u.name || u.email, email: u.email, role: u.role, image: u.image }));
}

/** Clinic sites for the capture form and filters. */
export async function listWaitlistLocations(organizationId: string) {
  return prisma.location.findMany({
    where: { organizationId, active: true },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true },
  });
}

/** Payer master names for the capture form (free text still allowed). */
export async function listWaitlistPayers(organizationId: string) {
  return prisma.payerRegistry
    .findMany({ where: { organizationId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
    .catch(() => [] as { id: string; name: string }[]);
}

/** All entries, priority ordered (open first; crisis, urgent, routine; longest waiting). */
export async function listWaitlistEntries(organizationId: string) {
  const rows = await prisma.waitlistEntry.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: 'asc' }],
    include: entryInclude,
    take: 2000,
  });
  return sortByPriority(rows.map(serializeEntry));
}

export async function getWaitlistEntry(organizationId: string, id: string) {
  const row = await prisma.waitlistEntry.findFirst({ where: { id, organizationId }, include: entryInclude });
  return row ? serializeEntry(row) : null;
}

export async function createWaitlistEntry(
  organizationId: string,
  input: CreateWaitlistInput,
  actor?: { userId: string; role: Role } | null
) {
  if (!input.specialty?.trim()) return { ok: false as const, error: 'Service requested is required', status: 400 };
  if (!input.name && !(input.firstName || input.lastName)) return { ok: false as const, error: 'Name is required', status: 400 };
  const built = await buildData(organizationId, input, null);
  if (built.ok === false) return { ok: false as const, error: built.error, status: 400 };
  const data = built.data;
  if (!data.urgency) data.urgency = 'ROUTINE';
  const crisisGuidance = applySafety(data, input.safetyScreen ?? undefined, data.urgency as WaitlistUrgency, actor?.userId ?? null);

  const row = await prisma.waitlistEntry.create({
    data: {
      ...(data as Omit<Prisma.WaitlistEntryUncheckedCreateInput, 'organizationId' | 'name' | 'specialty'>),
      organizationId,
      name: data.name as string,
      specialty: data.specialty as string,
      status: 'WAITING',
      stage: 'NEW',
      createdById: actor?.userId ?? null,
      source: input.source ?? (actor && !canManageWaitlist(actor.role) ? 'clinician' : 'staff'),
      marketingLeadId: input.marketingLeadId ?? null,
    },
    include: entryInclude,
  });

  return { ok: true as const, entry: serializeEntry(row), crisisGuidance, fields: Object.keys(data) };
}

export async function updateWaitlistEntry(
  organizationId: string,
  id: string,
  input: UpdateWaitlistInput,
  actor?: { userId: string; role: Role } | null
) {
  const existing = await prisma.waitlistEntry.findFirst({ where: { id, organizationId } });
  if (!existing) return { ok: false as const, error: 'Waitlist entry not found', status: 404 };
  const stage = deriveStage(existing);
  if (actor && !canEditWaitlistEntry(actor.role, actor.userId, { createdById: existing.createdById, stage })) {
    return { ok: false as const, error: 'You can edit only open entries you added', status: 403 };
  }
  if (input.status === 'closed') return { ok: false as const, error: 'Close with a reason', status: 400 };

  const built = await buildData(organizationId, input, existing);
  if (built.ok === false) return { ok: false as const, error: built.error, status: 400 };
  const data = built.data;
  const crisisGuidance = applySafety(data, input.safetyScreen, existing.urgency, actor?.userId ?? null);

  if (input.stage !== undefined) {
    if (!isOpenStage(input.stage) || !isOpenStage(stage)) {
      return { ok: false as const, error: 'Use Schedule, Convert or Close for that change', status: 400 };
    }
    data.stage = input.stage;
    data.status = statusForStage(input.stage, existing.clinicianId);
  }

  const row = await prisma.waitlistEntry.update({ where: { id }, data, include: entryInclude });
  return { ok: true as const, entry: serializeEntry(row), crisisGuidance, fields: Object.keys(data) };
}

export async function matchWaitlistEntry(organizationId: string, id: string, clinicianId: string) {
  const existing = await prisma.waitlistEntry.findFirst({ where: { id, organizationId } });
  if (!existing) return { ok: false as const, error: 'Waitlist entry not found', status: 404 };
  const stage = deriveStage(existing);
  if (!isOpenStage(stage)) return { ok: false as const, error: 'Entry is not open', status: 400 };

  const clinician = await prisma.user.findFirst({
    where: { id: clinicianId, organizationId, status: 'ACTIVE', role: { in: MATCHABLE_CLINICIAN_ROLES } },
  });
  if (!clinician) return { ok: false as const, error: 'Clinician not found', status: 400 };

  const row = await prisma.waitlistEntry.update({
    where: { id },
    data: { clinicianId, status: 'MATCHED', matchedAt: new Date(), stage },
    include: entryInclude,
  });
  return { ok: true as const, entry: serializeEntry(row) };
}

export async function closeWaitlistEntry(organizationId: string, id: string, reason?: string | null, note?: string | null) {
  const existing = await prisma.waitlistEntry.findFirst({ where: { id, organizationId } });
  if (!existing) return { ok: false as const, error: 'Waitlist entry not found', status: 404 };
  const v = validateClose(reason, deriveStage(existing));
  if (v.ok === false) return { ok: false as const, error: v.error, status: 400 };
  const extra = emptyToNull(note);
  const row = await prisma.waitlistEntry.update({
    where: { id },
    data: {
      status: 'CLOSED',
      stage: 'CLOSED',
      closeReason: v.reason,
      closedAt: new Date(),
      nextFollowUpAt: null,
      ...(extra ? { notes: [existing.notes, `Closed: ${extra}`].filter(Boolean).join('\n').slice(0, 4000) } : {}),
    },
    include: entryInclude,
  });
  return { ok: true as const, entry: serializeEntry(row) };
}

/** Reopen a closed entry (back to NEW; no-response streak cleared). */
export async function reopenWaitlistEntry(organizationId: string, id: string) {
  const existing = await prisma.waitlistEntry.findFirst({ where: { id, organizationId } });
  if (!existing) return { ok: false as const, error: 'Waitlist entry not found', status: 404 };
  if (deriveStage(existing) !== 'CLOSED') return { ok: false as const, error: 'Entry is not closed', status: 400 };
  const row = await prisma.waitlistEntry.update({
    where: { id },
    data: { stage: 'NEW', status: existing.clinicianId ? 'MATCHED' : 'WAITING', closeReason: null, closedAt: null, noResponseCount: 0 },
    include: entryInclude,
  });
  return { ok: true as const, entry: serializeEntry(row) };
}

// ─── Contact log ─────────────────────────────────────────────────────────────────────────

export async function listContactAttempts(organizationId: string, entryId: string) {
  const rows = await prisma.waitlistContactAttempt.findMany({
    where: { organizationId, waitlistEntryId: entryId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    method: r.method,
    outcome: r.outcome,
    note: r.note,
    nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null,
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function logContactAttempt(
  organizationId: string,
  entryId: string,
  actor: { userId: string; name: string | null },
  input: { method: ContactMethod; outcome: ContactOutcome; note?: string | null; nextFollowUpAt?: string | null }
) {
  const existing = await prisma.waitlistEntry.findFirst({ where: { id: entryId, organizationId } });
  if (!existing) return { ok: false as const, error: 'Waitlist entry not found', status: 404 };
  const stage = deriveStage(existing);
  if (!isOpenStage(stage)) return { ok: false as const, error: 'Entry is not open', status: 400 };
  const next = parseInstant(input.nextFollowUpAt);
  if (next === 'invalid') return { ok: false as const, error: 'Invalid follow-up date', status: 400 };

  const noResponseCount = nextNoResponseCount(existing.noResponseCount ?? 0, input.outcome);
  const newStage = stageAfterContact(stage);
  const [, row] = await prisma.$transaction([
    prisma.waitlistContactAttempt.create({
      data: {
        organizationId,
        waitlistEntryId: entryId,
        method: input.method,
        outcome: input.outcome,
        note: emptyToNull(input.note)?.slice(0, 1000) ?? null,
        nextFollowUpAt: next,
        createdById: actor.userId,
        createdByName: actor.name,
      },
    }),
    prisma.waitlistEntry.update({
      where: { id: entryId },
      data: {
        lastContactAt: new Date(),
        nextFollowUpAt: next,
        noResponseCount,
        stage: newStage,
        status: statusForStage(newStage, existing.clinicianId),
      },
      include: entryInclude,
    }),
  ]);
  const entry = serializeEntry(row);
  const promptClose: 'no_response' | 'declined' | null =
    input.outcome === 'declined' ? 'declined' : entry.promptNoResponseClose ? 'no_response' : null;
  return { ok: true as const, entry, promptClose };
}

// ─── Duplicates ──────────────────────────────────────────────────────────────────────────

/** Existing clients in the org that may be this person (name + DOB, phone, email). */
export async function findDuplicateClients(
  organizationId: string,
  person: { firstName?: string | null; lastName?: string | null; name?: string | null; dateOfBirth?: string | Date | null; phone?: string | null; email?: string | null }
): Promise<DuplicateMatch[]> {
  const last = (person.lastName || splitName(person.name ?? '').lastName || '').trim();
  const digits = (person.phone ?? '').replace(/\D/g, '');
  const last4 = digits.length >= 10 ? digits.slice(-4) : '';
  const email = (person.email ?? '').trim().toLowerCase();
  const or: Prisma.ClientWhereInput[] = [];
  if (last.length >= 2) or.push({ name: { contains: last, mode: 'insensitive' } });
  if (last4) or.push({ phone: { contains: last4 } });
  if (email) or.push({ email: { equals: email, mode: 'insensitive' } });
  if (!or.length) return [];
  const candidates = await prisma.client.findMany({
    where: { organizationId, OR: or },
    select: { id: true, name: true, mrn: true, dateOfBirth: true, phone: true, email: true, status: true },
    take: 300,
  });
  return findDuplicateCandidates(person, candidates).slice(0, 10);
}

/** After an intake invite: stage INTAKE_SENT (status unchanged: the person is still waiting). */
export async function markIntakeSent(organizationId: string, entryId: string) {
  await prisma.waitlistEntry.updateMany({
    where: {
      id: entryId,
      organizationId,
      status: { in: ['WAITING', 'MATCHED'] },
      OR: [{ stage: null }, { stage: { in: ['NEW', 'CONTACTED'] } }],
    },
    data: { stage: 'INTAKE_SENT' },
  });
}
