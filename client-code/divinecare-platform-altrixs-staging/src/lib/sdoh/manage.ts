import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { assertClientPhiAccess, lockedSensitiveClientIds, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import {
  AHC_INSTRUMENT,
  AHC_SAFETY_THRESHOLD,
  AHC_VERSION,
  ALL_DOMAINS,
  SUPPLEMENTAL_DOMAINS,
  normalizeAnswers,
  scoreAhcHrsn,
  type AhcAnswers,
  type AhcDomain,
} from './ahcHrsn';
import { isSdohZCode, mergeSecondaryDiagnoses, suggestZCodes } from './zCodes';
import { countyFromText, parseAgencyCsv, suggestCommunityResources } from '@/lib/resources/community';
import {
  applyTransition,
  parseLegacyResources,
  pct,
  rescreenDueAt,
  rescreenState,
  RESCREEN_MONTHS,
  type CloseReason,
  type ReferralStatus,
  type ReferralType,
  type ResourceDomain,
} from './workflow';

export const SDOH_PATH = '/dashboard/sdoh';
/** Confirming Z codes writes the client's diagnoses: same rule as the BH diagnoses page. */
export const canConfirmZCodes = (role: string) => canAccessPath(role, '/dashboard/ehr/diagnoses');

export type SdohActor = { organizationId: string; actorUserId: string; actorRole: Role };

export class SdohError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'SdohError';
  }
}

// ─── Scoping ────────────────────────────────────────────────────────────────

/** Clients this actor may see (org + caseload) minus protected records they cannot open. */
export async function accessibleClients(actor: SdohActor) {
  const rows = await prisma.client.findMany({
    where: clientAccessWhere(actor),
    select: { id: true, name: true, status: true },
  });
  const locked = await lockedSensitiveClientIds({
    organizationId: actor.organizationId,
    userId: actor.actorUserId,
    role: actor.actorRole,
    clientIds: rows.map((r) => r.id),
  });
  return rows.filter((r) => !locked.has(r.id));
}

/** One client in scope, with the protected-record (break-glass) check. */
export async function requireClient(actor: SdohActor, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { AND: [{ id: clientId }, clientAccessWhere(actor)] },
    select: { id: true, name: true, assignedToId: true, secondaryDiagnoses: true },
  });
  if (!client) throw new SdohError('Client not found in your caseload', 404);
  try {
    await assertClientPhiAccess({
      organizationId: actor.organizationId,
      userId: actor.actorUserId,
      role: actor.actorRole,
      clientId,
      path: SDOH_PATH,
    });
  } catch (e) {
    if (e instanceof SensitiveRecordAccessError) throw new SdohError('Protected record: break-glass access is required', 403);
    throw e;
  }
  return client;
}

async function actorName(actor: SdohActor) {
  const u = await prisma.user.findFirst({ where: { id: actor.actorUserId, organizationId: actor.organizationId }, select: { name: true, email: true } });
  return u?.name || u?.email || null;
}

// ─── Screenings ─────────────────────────────────────────────────────────────

export interface SubmitScreeningInput {
  submissionId: string;
  clientId: string;
  answers: AhcAnswers;
  includeSupplemental: boolean;
  respondent: 'self' | 'caregiver';
  notes?: string | null;
}

function serializeScreening(row: {
  id: string; clientId: string; answers: Prisma.JsonValue; includesSupplemental: boolean; positiveDomains: string[];
  safetyScore: number | null; respondent: string; source: string; completedByName: string | null; completedAt: Date;
  confirmedZCodes: string[]; zCodesConfirmedAt: Date | null; riskAlertId: string | null; notes: string | null; version: string;
}) {
  const answers = (row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers) ? row.answers : {}) as AhcAnswers;
  const positive = row.positiveDomains.filter((d): d is AhcDomain => (ALL_DOMAINS as string[]).includes(d));
  return {
    id: row.id,
    clientId: row.clientId,
    version: row.version,
    answers,
    includesSupplemental: row.includesSupplemental,
    positiveDomains: positive,
    safetyScore: row.safetyScore,
    respondent: row.respondent,
    source: row.source,
    completedByName: row.completedByName,
    completedAt: row.completedAt.toISOString(),
    rescreenDueAt: rescreenDueAt(row.completedAt).toISOString(),
    confirmedZCodes: row.confirmedZCodes,
    zCodesConfirmedAt: row.zCodesConfirmedAt?.toISOString() ?? null,
    riskAlertId: row.riskAlertId,
    notes: row.notes,
    suggestions: suggestZCodes(answers, positive, row.includesSupplemental),
  };
}
export type SdohScreeningDto = ReturnType<typeof serializeScreening>;

/** Saves the screening and, for a positive interpersonal-safety score, a HIGH risk alert in the same transaction. Retries reuse submissionId. */
export async function submitScreening(actor: SdohActor, input: SubmitScreeningInput) {
  const client = await requireClient(actor, input.clientId);
  const answers = normalizeAnswers(input.answers, input.includeSupplemental);
  if (Object.keys(answers).length === 0) throw new SdohError('Answer at least one question', 400);
  const score = scoreAhcHrsn(answers, input.includeSupplemental);

  const existing = await prisma.sdohScreening.findUnique({ where: { id: input.submissionId } });
  if (existing) {
    if (existing.organizationId !== actor.organizationId || existing.clientId !== client.id) {
      throw new SdohError('Submission ID already used', 409);
    }
    return { screening: serializeScreening(existing), score, duplicate: true, riskAlertCreated: false };
  }

  const name = await actorName(actor);
  const row = await prisma.$transaction(async (tx) => {
    let created = await tx.sdohScreening.create({
      data: {
        id: input.submissionId,
        organizationId: actor.organizationId,
        clientId: client.id,
        instrument: AHC_INSTRUMENT,
        version: AHC_VERSION,
        answers: answers as Prisma.InputJsonValue,
        includesSupplemental: input.includeSupplemental,
        positiveDomains: score.positiveDomains,
        safetyScore: score.safetyScore,
        respondent: input.respondent,
        source: 'staff',
        completedById: actor.actorUserId,
        completedByName: name,
        notes: input.notes?.trim() || null,
      },
    });
    if (score.safetyPositive) {
      const alert = await tx.riskAlert.create({
        data: {
          organizationId: actor.organizationId,
          clientId: client.id,
          clientName: client.name,
          clinicianId: client.assignedToId,
          type: 'interpersonal_safety',
          severity: 'HIGH',
          source: 'sdoh_ahc_hrsn',
          sourceId: created.id,
          reviewed: false,
          description: `AHC HRSN interpersonal safety score ${score.safetyScore} (${AHC_SAFETY_THRESHOLD} or more = may not be safe). Safety follow-up is required.`,
        },
      });
      created = await tx.sdohScreening.update({ where: { id: created.id }, data: { riskAlertId: alert.id } });
    }
    return created;
  });
  return { screening: serializeScreening(row), score, duplicate: false, riskAlertCreated: Boolean(row.riskAlertId) };
}

export async function listClientSdoh(actor: SdohActor, clientId: string) {
  const client = await requireClient(actor, clientId);
  const [screenings, referrals] = await Promise.all([
    prisma.sdohScreening.findMany({
      where: { organizationId: actor.organizationId, clientId: client.id },
      orderBy: { completedAt: 'desc' },
      take: 20,
    }),
    prisma.sdohReferral.findMany({
      where: { organizationId: actor.organizationId, clientId: client.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);
  const resources = await resourceNames(actor.organizationId, referrals.map((r) => r.resourceId));
  const latest = screenings[0];
  return {
    client: { id: client.id, name: client.name },
    screenings: screenings.map(serializeScreening),
    referrals: referrals.map((r) => serializeReferral(r, client.name, resources)),
    rescreen: latest ? { dueAt: rescreenDueAt(latest.completedAt).toISOString(), state: rescreenState(latest.completedAt) } : null,
    canConfirmZCodes: canConfirmZCodes(actor.actorRole),
  };
}

/** Clinician confirms suggested Z codes: they are appended to the client's secondary diagnoses. */
export async function confirmZCodes(actor: SdohActor, screeningId: string, codes: string[]) {
  if (!canConfirmZCodes(actor.actorRole)) throw new SdohError('Only clinicians who manage diagnoses can confirm Z codes', 403);
  const row = await prisma.sdohScreening.findFirst({ where: { id: screeningId, organizationId: actor.organizationId } });
  if (!row) throw new SdohError('Screening not found', 404);
  const client = await requireClient(actor, row.clientId);
  const dto = serializeScreening(row);
  const allowed = new Set(dto.suggestions.map((s) => s.code));
  const picked = [...new Set(codes)];
  if (!picked.length) throw new SdohError('Pick at least one code', 400);
  const bad = picked.filter((c) => !isSdohZCode(c) || !allowed.has(c));
  if (bad.length) throw new SdohError(`Not a suggestion for this screening: ${bad.join(', ')}`, 400);

  const merged = mergeSecondaryDiagnoses(client.secondaryDiagnoses, picked);
  if (merged && merged.length > 500) throw new SdohError('The diagnosis list is full (500 characters). Edit diagnoses on the chart first.', 409);
  const updated = await prisma.$transaction(async (tx) => {
    if (merged) await tx.client.update({ where: { id: client.id }, data: { secondaryDiagnoses: merged } });
    return tx.sdohScreening.update({
      where: { id: row.id },
      data: {
        confirmedZCodes: [...new Set([...row.confirmedZCodes, ...picked])],
        zCodesConfirmedAt: new Date(),
        zCodesConfirmedById: actor.actorUserId,
      },
    });
  });
  return { screening: serializeScreening(updated), addedToDiagnoses: merged ? picked.filter((c) => merged.includes(c)) : [] };
}

// ─── Referrals ──────────────────────────────────────────────────────────────

async function resourceNames(organizationId: string, ids: (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!list.length) return new Map<string, string>();
  const rows = await prisma.sdohResource.findMany({ where: { organizationId, id: { in: list } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

function serializeReferral(
  r: {
    id: string; clientId: string; screeningId: string | null; domain: string; resourceId: string | null; status: string;
    ownerId: string | null; ownerName: string | null; notes: string | null; connectedAt: Date | null; closedAt: Date | null;
    closeReason: string | null; createdAt: Date; updatedAt: Date;
    referralType?: string; followUpDate?: Date | null; followUpCompletedAt?: Date | null; libraryItemId?: string | null;
  },
  clientName: string,
  resources: Map<string, string>,
) {
  return {
    id: r.id,
    clientId: r.clientId,
    clientName,
    screeningId: r.screeningId,
    domain: r.domain,
    resourceId: r.resourceId,
    resourceName: r.resourceId ? resources.get(r.resourceId) ?? null : null,
    status: r.status as ReferralStatus,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    notes: r.notes,
    connectedAt: r.connectedAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    closeReason: r.closeReason,
    referralType: (r.referralType === 'resource_given' ? 'resource_given' : 'referral_made') as ReferralType,
    followUpDate: r.followUpDate ? r.followUpDate.toISOString().slice(0, 10) : null,
    followUpCompletedAt: r.followUpCompletedAt?.toISOString() ?? null,
    libraryItemId: r.libraryItemId ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type SdohReferralDto = ReturnType<typeof serializeReferral>;

/** Staff who can work SDOH referrals (owner picker). Names only. */
export async function referralOwners(organizationId: string) {
  const users = await prisma.user.findMany({
    where: { organizationId, status: 'ACTIVE' },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });
  return users.filter((u) => canAccessPath(u.role, SDOH_PATH)).map((u) => ({ id: u.id, name: u.name || u.email }));
}

async function ownerFor(organizationId: string, ownerId: string | null | undefined) {
  if (!ownerId) return null;
  const u = await prisma.user.findFirst({ where: { id: ownerId, organizationId }, select: { id: true, name: true, email: true, role: true } });
  if (!u || !canAccessPath(u.role, SDOH_PATH)) throw new SdohError('Owner must be a staff member who works SDOH referrals', 400);
  return { id: u.id, name: u.name || u.email };
}

/** Library item handed out with the referral (active, patient-facing, same organization). */
async function assertLibraryItem(organizationId: string, itemId: string | null | undefined) {
  if (!itemId) return null;
  const r = await prisma.resourceItem.findFirst({ where: { id: itemId, organizationId, audience: 'patient', status: 'active' }, select: { id: true } });
  if (!r) throw new SdohError('Library resource not found', 404);
  return r.id;
}

async function assertResource(organizationId: string, resourceId: string | null | undefined) {
  if (!resourceId) return null;
  const r = await prisma.sdohResource.findFirst({ where: { id: resourceId, organizationId }, select: { id: true } });
  if (!r) throw new SdohError('Resource not found', 404);
  return r.id;
}

export async function createReferral(
  actor: SdohActor,
  input: {
    clientId: string; domain: AhcDomain; screeningId?: string | null; resourceId?: string | null; ownerId?: string | null; notes?: string | null;
    referralType?: ReferralType; followUpDate?: string | null; libraryItemId?: string | null;
  },
) {
  const client = await requireClient(actor, input.clientId);
  if (input.screeningId) {
    const s = await prisma.sdohScreening.findFirst({ where: { id: input.screeningId, organizationId: actor.organizationId, clientId: client.id }, select: { id: true } });
    if (!s) throw new SdohError('Screening not found for this client', 404);
  }
  const resourceId = await assertResource(actor.organizationId, input.resourceId);
  const owner = (await ownerFor(actor.organizationId, input.ownerId ?? actor.actorUserId)) ?? null;
  const row = await prisma.sdohReferral.create({
    data: {
      organizationId: actor.organizationId,
      clientId: client.id,
      screeningId: input.screeningId || null,
      domain: input.domain,
      resourceId,
      status: 'open',
      ownerId: owner?.id ?? null,
      ownerName: owner?.name ?? null,
      notes: input.notes?.trim() || null,
      referralType: input.referralType ?? 'referral_made',
      followUpDate: input.followUpDate ? new Date(`${input.followUpDate}T00:00:00Z`) : null,
      libraryItemId: await assertLibraryItem(actor.organizationId, input.libraryItemId),
      createdById: actor.actorUserId,
    },
  });
  return serializeReferral(row, client.name, await resourceNames(actor.organizationId, [resourceId]));
}

export async function updateReferral(
  actor: SdohActor,
  id: string,
  input: {
    status?: ReferralStatus; closeReason?: CloseReason | null; notes?: string | null; ownerId?: string | null; resourceId?: string | null;
    referralType?: ReferralType; followUpDate?: string | null; followUpCompleted?: boolean;
  },
) {
  const row = await prisma.sdohReferral.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!row) throw new SdohError('Referral not found', 404);
  const client = await requireClient(actor, row.clientId);
  const data: Prisma.SdohReferralUpdateInput = {};
  if (input.status) {
    const t = applyTransition({ status: row.status as ReferralStatus, connectedAt: row.connectedAt }, input.status, input.closeReason);
    if (t.ok === false) throw new SdohError(t.error, 400);
    Object.assign(data, t.data);
  }
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.referralType !== undefined) data.referralType = input.referralType;
  if (input.followUpDate !== undefined) data.followUpDate = input.followUpDate ? new Date(`${input.followUpDate}T00:00:00Z`) : null;
  if (input.followUpCompleted !== undefined) data.followUpCompletedAt = input.followUpCompleted ? new Date() : null;
  if (input.ownerId !== undefined) {
    const owner = await ownerFor(actor.organizationId, input.ownerId);
    data.ownerId = owner?.id ?? null;
    data.ownerName = owner?.name ?? null;
  }
  if (input.resourceId !== undefined) data.resourceId = await assertResource(actor.organizationId, input.resourceId);
  if (!Object.keys(data).length) throw new SdohError('No changes provided', 400);
  const updated = await prisma.sdohReferral.update({ where: { id: row.id }, data });
  return serializeReferral(updated, client.name, await resourceNames(actor.organizationId, [updated.resourceId]));
}

/** Worklist: referrals in scope (open + connected by default) and clients due for a rescreen. */
export async function worklist(actor: SdohActor, opts: { includeClosed?: boolean }) {
  const clients = await accessibleClients(actor);
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const ids = clients.map((c) => c.id);
  const [referrals, latest, owners] = await Promise.all([
    prisma.sdohReferral.findMany({
      where: {
        organizationId: actor.organizationId,
        clientId: { in: ids },
        ...(opts.includeClosed ? {} : { status: { in: ['open', 'connected'] } }),
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    }),
    prisma.sdohScreening.groupBy({
      by: ['clientId'],
      where: { organizationId: actor.organizationId, clientId: { in: ids } },
      _max: { completedAt: true },
    }),
    referralOwners(actor.organizationId),
  ]);
  const resources = await resourceNames(actor.organizationId, referrals.map((r) => r.resourceId));
  const now = new Date();
  const rescreen = latest
    .filter((g) => g._max.completedAt && rescreenState(g._max.completedAt, now) !== 'current')
    .map((g) => ({
      clientId: g.clientId,
      clientName: names.get(g.clientId) ?? 'Client',
      lastScreenedAt: g._max.completedAt!.toISOString(),
      dueAt: rescreenDueAt(g._max.completedAt!).toISOString(),
      state: rescreenState(g._max.completedAt!, now),
    }))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return {
    referrals: referrals.map((r) => serializeReferral(r, names.get(r.clientId) ?? 'Client', resources)),
    rescreen,
    owners,
  };
}

// ─── Summary ────────────────────────────────────────────────────────────────

/** Last 12 months, real counts only, scoped like the worklist. */
export async function summary(actor: SdohActor) {
  const clients = await accessibleClients(actor);
  const ids = clients.map((c) => c.id);
  const since = new Date();
  since.setMonth(since.getMonth() - RESCREEN_MONTHS);
  const [screenings, referrals] = await Promise.all([
    prisma.sdohScreening.findMany({
      where: { organizationId: actor.organizationId, clientId: { in: ids }, completedAt: { gte: since } },
      select: { clientId: true, completedAt: true, positiveDomains: true, includesSupplemental: true, safetyScore: true },
      orderBy: { completedAt: 'desc' },
    }),
    prisma.sdohReferral.findMany({
      where: { organizationId: actor.organizationId, clientId: { in: ids }, createdAt: { gte: since } },
      select: { status: true, closeReason: true, connectedAt: true, domain: true },
    }),
  ]);
  // Most recent screening per client
  const latest = new Map<string, (typeof screenings)[number]>();
  for (const s of screenings) if (!latest.has(s.clientId)) latest.set(s.clientId, s);
  const latestRows = [...latest.values()];
  const supplementalBase = latestRows.filter((s) => s.includesSupplemental).length;
  const byDomain = ALL_DOMAINS.map((domain) => {
    const base = SUPPLEMENTAL_DOMAINS.includes(domain) ? supplementalBase : latestRows.length;
    const positive = latestRows.filter((s) => s.positiveDomains.includes(domain)).length;
    return { domain, positive, screened: base, percent: pct(positive, base) };
  });
  const active = new Set(clients.filter((c) => c.status === 'ACTIVE').map((c) => c.id));
  const activeClients = active.size;
  const closed = referrals.filter((r) => r.status === 'closed');
  return {
    since: since.toISOString(),
    screenings: screenings.length,
    clientsScreened: latestRows.length,
    activeClients,
    coveragePercent: pct(latestRows.filter((s) => active.has(s.clientId)).length, activeClients),
    anyPositive: latestRows.filter((s) => s.positiveDomains.length > 0).length,
    byDomain,
    referrals: {
      total: referrals.length,
      open: referrals.filter((r) => r.status === 'open').length,
      connected: referrals.filter((r) => r.connectedAt !== null).length,
      closed: closed.length,
      needMet: closed.filter((r) => r.closeReason === 'need_met').length,
      closurePercent: pct(closed.length, referrals.length),
      needMetPercent: pct(closed.filter((r) => r.closeReason === 'need_met').length, referrals.length),
    },
  };
}

// ─── Resource directory (org data, no PHI) ──────────────────────────────────

export interface ResourceInput {
  name: string;
  domains: ResourceDomain[];
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  website?: string | null;
  hours?: string | null;
  languages?: string[];
  cost?: string | null;
  eligibilityNotes?: string | null;
  active?: boolean;
  verified?: boolean;
  counties?: string[];
  email?: string | null;
  verificationSource?: string | null;
}

function resourceData(input: Partial<ResourceInput>) {
  const t = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
  return {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.domains !== undefined ? { domains: [...new Set(input.domains)] } : {}),
    address: t(input.address),
    city: t(input.city),
    state: t(input.state),
    postalCode: t(input.postalCode),
    phone: t(input.phone),
    website: t(input.website),
    hours: t(input.hours),
    ...(input.languages !== undefined ? { languages: [...new Set(input.languages.map((l) => l.trim()).filter(Boolean))] } : {}),
    cost: t(input.cost),
    eligibilityNotes: t(input.eligibilityNotes),
    ...(input.active !== undefined ? { active: input.active } : {}),
    ...(input.verified ? { lastVerifiedAt: new Date() } : {}),
    ...(input.counties !== undefined ? { counties: [...new Set(input.counties)] } : {}),
    email: t(input.email),
    verificationSource: t(input.verificationSource),
  };
}

export async function listResources(organizationId: string) {
  const [rows, legacy] = await Promise.all([
    prisma.sdohResource.findMany({ where: { organizationId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
    prisma.clinicModuleState.findUnique({ where: { organizationId_module: { organizationId, module: 'sdoh-resources' } }, select: { data: true } }),
  ]);
  const legacyRows = parseLegacyResources(legacy?.data);
  const imported = new Set(rows.filter((r) => r.source === 'legacy').map((r) => r.legacyId));
  return {
    resources: rows.map((r) => ({
      ...r,
      lastVerifiedAt: r.lastVerifiedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    legacyAvailable: legacyRows.filter((r) => !imported.has(r.legacyId)).length,
  };
}

export async function createResource(actor: SdohActor, input: ResourceInput) {
  return prisma.sdohResource.create({
    data: {
      ...resourceData(input),
      name: input.name.trim(),
      organizationId: actor.organizationId,
      source: 'manual',
      createdById: actor.actorUserId,
      ...(input.verified ? { verifiedById: actor.actorUserId } : {}),
    },
  });
}

export async function updateResource(actor: SdohActor, id: string, input: Partial<ResourceInput>) {
  const row = await prisma.sdohResource.findFirst({ where: { id, organizationId: actor.organizationId }, select: { id: true } });
  if (!row) throw new SdohError('Resource not found', 404);
  return prisma.sdohResource.update({ where: { id: row.id }, data: { ...resourceData(input), ...(input.verified ? { verifiedById: actor.actorUserId } : {}) } });
}

/** One-time copy of the old module list into the directory. Idempotent (unique org + source + legacyId). Not marked verified. */
export async function importLegacyResources(actor: SdohActor) {
  const state = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId: actor.organizationId, module: 'sdoh-resources' } },
    select: { data: true },
  });
  const rows = parseLegacyResources(state?.data);
  let created = 0;
  for (const r of rows) {
    const exists = await prisma.sdohResource.findFirst({
      where: { organizationId: actor.organizationId, source: 'legacy', legacyId: r.legacyId },
      select: { id: true },
    });
    if (exists) continue;
    try {
      await prisma.sdohResource.create({
        data: {
          organizationId: actor.organizationId,
          name: r.name,
          domains: r.domains,
          phone: r.phone,
          hours: r.hours,
          cost: r.cost,
          eligibilityNotes: r.eligibilityNotes,
          source: 'legacy',
          legacyId: r.legacyId,
          createdById: actor.actorUserId,
        },
      });
      created += 1;
    } catch (e) {
      // A concurrent import created the same row
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
  return { found: rows.length, created, skipped: rows.length - created };
}

// ─── Community resource suggestions & CSV import (resource library, 20261020) ─

/**
 * For the client's latest screening: each positive domain with matching active directory
 * entries (src/lib/resources/community.ts ranking; the client's county from Client.county) and
 * the active patient-facing library items tagged "community services" to hand out.
 */
export async function suggestionsForClient(actor: SdohActor, clientId: string) {
  const client = await requireClient(actor, clientId);
  const [latest, row, directory, library] = await Promise.all([
    prisma.sdohScreening.findFirst({
      where: { organizationId: actor.organizationId, clientId: client.id },
      orderBy: { completedAt: 'desc' },
      select: { id: true, positiveDomains: true, completedAt: true },
    }),
    prisma.client.findUnique({ where: { id: client.id }, select: { county: true } }),
    prisma.sdohResource.findMany({ where: { organizationId: actor.organizationId, active: true } }),
    prisma.resourceItem.findMany({
      where: { organizationId: actor.organizationId, audience: 'patient', status: 'active', topics: { has: 'community_services' } },
      select: { id: true, title: true, kind: true, url: true, contactPhone: true },
      orderBy: { title: 'asc' },
    }),
  ]);
  const positive = (latest?.positiveDomains ?? []).filter((d): d is AhcDomain => (ALL_DOMAINS as string[]).includes(d));
  const county = countyFromText(row?.county);
  const suggestions = suggestCommunityResources(positive, directory, county).map((s) => ({
    domain: s.domain,
    resources: s.resources.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      website: r.website,
      hours: r.hours,
      counties: r.counties,
      eligibilityNotes: r.eligibilityNotes,
      lastVerifiedAt: r.lastVerifiedAt?.toISOString() ?? null,
    })),
  }));
  return {
    clientId: client.id,
    screeningId: latest?.id ?? null,
    screenedAt: latest?.completedAt.toISOString() ?? null,
    county,
    suggestions,
    libraryItems: library,
  };
}

/** CSV import (template: src/lib/resources/community.ts). Rows with errors are reported, never guessed. */
export async function importResourcesCsv(actor: SdohActor, text: string) {
  const parsed = parseAgencyCsv(text);
  let created = 0;
  for (const r of parsed.rows) {
    await prisma.sdohResource.create({
      data: {
        organizationId: actor.organizationId,
        name: r.name,
        domains: r.domains,
        counties: r.counties,
        address: r.address,
        city: r.city,
        state: r.state,
        postalCode: r.postalCode,
        phone: r.phone,
        email: r.email,
        website: r.website,
        hours: r.hours,
        eligibilityNotes: r.eligibilityNotes,
        languages: r.languages,
        cost: r.cost,
        lastVerifiedAt: r.lastVerifiedAt,
        verificationSource: r.verificationSource,
        source: 'csv',
        createdById: actor.actorUserId,
      },
    });
    created += 1;
  }
  return { created, errors: parsed.errors };
}
