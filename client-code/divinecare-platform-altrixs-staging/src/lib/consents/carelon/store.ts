/**
 * Carelon non-overlap attestation: database access (ConsentForm rows with formKey
 * carelon-md-nonoverlap-attestation). Pure rules live next door:
 *   template.ts (exact text, versions) · medicaid.ts (who needs it) · prefill.ts · workflow.ts · pdf.ts
 * Routes do the auth / audit; every function here takes an org-scoped actor and checks the
 * client is in the actor's scope (clientAccessWhere) before reading or writing.
 */
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientByIdWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { practiceToday } from '@/lib/time/practiceTime';
import { normalizePayerName } from '@/lib/billing/valantPayers';
import { signedFormPath } from '@/lib/storage/privateUploads';
import { CARELON_CONSENT_TYPE, CARELON_CURRENT_VERSION, CARELON_FORM_KEY, carelonTemplate, type CarelonTemplate } from './template';
import { detectMarylandMedicaid, type MedicaidDetection } from './medicaid';
import {
  defaultProviderOption,
  formatPracticeMdY,
  participantPrefill,
  prefillBlockers,
  providerOptions,
  providerPrefill,
  type ParticipantPrefill,
  type ProviderOption,
  type ProviderPrefill,
} from './prefill';
import {
  asCarelonStatus,
  attestationRequirement,
  CARELON_STATUS_LABEL,
  canManageCarelon,
  canMarkCarelonSubmitted,
  canSignCarelonProvider,
  consentStatusFor,
  emptyFormData,
  fillBlanks,
  freezeDocument,
  frozenBlanks,
  parseFormData,
  requestDecision,
  transition,
  validatePartA,
  validatePartB,
  type AttestationRow,
  type CarelonFormData,
  type CarelonStatus,
  type ClientStatusRow,
  type PartAInput,
  type PartAMethod,
  type PartBInput,
  type Requirement,
} from './workflow';
import { buildCarelonPdf } from './pdf';

export type CarelonActor = { organizationId: string; userId: string; role: string };
type Fail = { ok: false; status: number; error: string };

const MAX_CLIENTS = 20_000;

// ─── Medicaid detection for many clients ─────────────────────────────────────

const MEDICAID_CLIENT_SELECT = {
  id: true,
  name: true,
  mrn: true,
  status: true,
  medicaidId: true,
  insuranceType: true,
  insurancePayer: true,
  insuranceMemberId: true,
  insuranceEffectiveTo: true,
} satisfies Prisma.ClientSelect;
type MedicaidClientRow = Prisma.ClientGetPayload<{ select: typeof MEDICAID_CLIENT_SELECT }>;

/** Payer name / alias → SBR09 claim filing code (Waystar payer mappings, org rows over '*'). */
async function filingCodeLookup(organizationId: string): Promise<(name: string) => string | null> {
  const rows = await prisma.waystarPayerMapping
    .findMany({ where: { organizationId: { in: [organizationId, '*'] }, active: true }, select: { organizationId: true, payerName: true, aliases: true, claimFilingCode: true } })
    .catch(() => []);
  const map = new Map<string, string>();
  for (const r of [...rows.filter((x) => x.organizationId === '*'), ...rows.filter((x) => x.organizationId !== '*')]) {
    for (const n of [r.payerName, ...r.aliases]) {
      const k = normalizePayerName(n);
      if (k) map.set(k, r.claimFilingCode);
    }
  }
  return (name) => map.get(normalizePayerName(name)) ?? null;
}

async function detectForClients(organizationId: string, clients: MedicaidClientRow[], now = new Date()): Promise<Map<string, MedicaidDetection>> {
  const out = new Map<string, MedicaidDetection>();
  if (!clients.length) return out;
  const ids = clients.map((c) => c.id);
  const [coverages, codeFor] = await Promise.all([
    prisma.clientInsuranceCoverage
      .findMany({ where: { organizationId, clientId: { in: ids } }, select: { clientId: true, payerName: true, memberId: true, claimFilingCode: true, active: true, rank: true } })
      .catch(() => []),
    filingCodeLookup(organizationId),
  ]);
  const byClient = new Map<string, typeof coverages>();
  for (const cov of coverages) byClient.set(cov.clientId, [...(byClient.get(cov.clientId) ?? []), cov]);
  for (const c of clients) {
    out.set(
      c.id,
      detectMarylandMedicaid(
        {
          medicaidId: c.medicaidId,
          insuranceType: c.insuranceType,
          insurancePayer: c.insurancePayer,
          insuranceMemberId: c.insuranceMemberId,
          insuranceEffectiveTo: c.insuranceEffectiveTo,
          coverages: (byClient.get(c.id) ?? []).sort((a, b) => a.rank.localeCompare(b.rank)),
        },
        { now, filingCodeForPayer: codeFor }
      )
    );
  }
  return out;
}

const ROW_SELECT = {
  id: true,
  clientId: true,
  formStatus: true,
  createdAt: true,
  signedAt: true,
  submittedAt: true,
  neededReason: true,
} satisfies Prisma.ConsentFormSelect;

async function attestationRowsFor(organizationId: string, clientIds: string[]): Promise<Map<string, AttestationRow[]>> {
  const out = new Map<string, AttestationRow[]>();
  if (!clientIds.length) return out;
  const rows = await prisma.consentForm.findMany({ where: { organizationId, formKey: CARELON_FORM_KEY, clientId: { in: clientIds } }, select: ROW_SELECT });
  for (const r of rows) out.set(r.clientId, [...(out.get(r.clientId) ?? []), { ...r, formStatus: r.formStatus ?? 'NOT_STARTED' }]);
  return out;
}

/** Clients who could be Medicaid (cheap pre-filter; the rule itself runs in detectMarylandMedicaid). */
async function possiblyMedicaidWhere(organizationId: string): Promise<Prisma.ClientWhereInput> {
  // ClientInsuranceCoverage has no Prisma relation on Client: collect its client ids first
  const cov = await prisma.clientInsuranceCoverage
    .findMany({ where: { organizationId, active: true }, select: { clientId: true }, distinct: ['clientId'] })
    .catch(() => []);
  return {
    OR: [
      { medicaidId: { not: null } },
      { insuranceType: { not: null } },
      { insurancePayer: { not: null } },
      ...(cov.length ? [{ id: { in: cov.map((c) => c.clientId) } }] : []),
    ],
  };
}

/**
 * Requirement status for every active client in scope who is Maryland Medicaid (plus any client
 * with an open attestation request). Used by the worklist, the inbox and the report.
 */
export async function loadClientStatusRows(
  scopeWhere: Prisma.ClientWhereInput,
  organizationId: string,
  opts: { now?: Date; clientIds?: string[] } = {}
): Promise<ClientStatusRow[]> {
  const now = opts.now ?? new Date();
  const clients = await prisma.client.findMany({
    where: {
      AND: [
        scopeWhere,
        { status: 'ACTIVE', deceasedAt: null } as Prisma.ClientWhereInput,
        opts.clientIds ? { id: { in: opts.clientIds } } : await possiblyMedicaidWhere(organizationId),
      ],
    },
    select: MEDICAID_CLIENT_SELECT,
    take: MAX_CLIENTS,
  });
  const [detections, rowsByClient] = await Promise.all([
    detectForClients(organizationId, clients, now),
    attestationRowsFor(organizationId, clients.map((c) => c.id)),
  ]);
  return clients.map((c) => {
    const det = detections.get(c.id)!;
    const rows = rowsByClient.get(c.id) ?? [];
    return toStatusRow(c, det, attestationRequirement(det.medicaid, rows));
  });
}

function toStatusRow(c: MedicaidClientRow, det: MedicaidDetection, req: Requirement): ClientStatusRow {
  return {
    clientId: c.id,
    clientName: c.name,
    mrn: c.mrn ?? null,
    payerName: det.payerName ?? c.insurancePayer ?? null,
    medicaidReasons: det.reasons,
    state: req.state,
    openStatus: req.open ? asCarelonStatus(req.open.formStatus) : null,
    openId: req.open?.id ?? null,
    currentId: req.current?.id ?? null,
    completedAt: req.current?.signedAt?.toISOString() ?? null,
    submitted: req.submitted,
    submittedAt: req.current?.submittedAt?.toISOString() ?? null,
    neededReason: req.open?.neededReason ?? null,
  };
}

/** One client's requirement (banner, scheduler badge). */
export async function clientCarelonRequirement(organizationId: string, clientId: string): Promise<{ detection: MedicaidDetection; requirement: Requirement } | null> {
  const c = await prisma.client.findFirst({ where: clientByIdWhere(clientId, organizationId), select: MEDICAID_CLIENT_SELECT });
  if (!c) return null;
  const [det, rows] = await Promise.all([detectForClients(organizationId, [c]), attestationRowsFor(organizationId, [c.id])]);
  const detection = det.get(c.id)!;
  const active = c.status === 'ACTIVE';
  return { detection, requirement: attestationRequirement(detection.medicaid && active, rows.get(c.id) ?? []) };
}

/** clientId → needs an attestation (scheduler facets). Missing ids = not needed. */
export async function carelonNeededForClients(organizationId: string, clientIds: string[]): Promise<Set<string>> {
  const rows = await loadClientStatusRows(clientOrgFilter(organizationId), organizationId, { clientIds });
  return new Set(rows.filter((r) => r.state !== 'complete' && r.state !== 'not_required').map((r) => r.clientId));
}

// ─── Prefill ─────────────────────────────────────────────────────────────────

async function loadProviderOptions(organizationId: string): Promise<ProviderOption[]> {
  const [bps, practice, org, locations] = await Promise.all([
    prisma.billingProvider
      .findMany({ where: { organizationId: { in: [organizationId, '*'] } }, select: { organizationId: true, npi: true, name: true, label: true, taxId: true, isDefault: true, active: true, locationKeys: true } })
      .catch(() => []),
    prisma.practiceSettings.findUnique({ where: { organizationId }, select: { legalName: true, dbaName: true, organizationNpi: true, taxId: true } }).catch(() => null),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    prisma.location.findMany({ where: { organizationId }, select: { id: true, name: true, code: true, npi: true, npiVerified: true, active: true } }).catch(() => []),
  ]);
  // Organization rows override '*' rows with the same NPI (same rule as Billing > Payer settings)
  const merged = new Map<string, (typeof bps)[number]>();
  for (const r of bps.filter((x) => x.organizationId === '*')) merged.set(r.npi, r);
  for (const r of bps.filter((x) => x.organizationId !== '*')) merged.set(r.npi, r);
  return providerOptions({ billingProviders: [...merged.values()], practice, organizationName: org?.name ?? null, locations });
}

export type CarelonPrefill = {
  participant: ParticipantPrefill;
  provider: ProviderPrefill;
  providerOptions: { key: string; label: string; npi: string | null; tinMasked: string | null; organizationName: string | null; source: string }[];
  defaultOptionKey: string | null;
  blockers: string[];
};

async function buildPrefill(organizationId: string, clientId: string, chosenKey: string | null, detection?: MedicaidDetection): Promise<CarelonPrefill | null> {
  const client = await prisma.client.findFirst({
    where: clientByIdWhere(clientId, organizationId),
    select: { ...MEDICAID_CLIENT_SELECT, legalFirstName: true, legalLastName: true, dateOfBirth: true, location: { select: { id: true, name: true, code: true } } },
  });
  if (!client) return null;
  const det = detection ?? (await detectForClients(organizationId, [client])).get(client.id)!;
  const options = await loadProviderOptions(organizationId);
  const def = defaultProviderOption(options, client.location ?? null);
  const chosen = (chosenKey && options.find((o) => o.key === chosenKey)) || def;
  const participant = participantPrefill(client, det.coverageMemberId);
  const provider = providerPrefill(chosen ?? null);
  return {
    participant,
    provider,
    providerOptions: options.map((o) => ({ key: o.key, label: o.label, npi: o.npi, tinMasked: o.tin ? `•••••${o.tin.slice(-4)}` : null, organizationName: o.organizationName, source: o.source })),
    defaultOptionKey: def?.key ?? null,
    blockers: prefillBlockers(participant, provider),
  };
}

// ─── Serialization ───────────────────────────────────────────────────────────

const FULL_SELECT = {
  id: true,
  organizationId: true,
  clientId: true,
  formKey: true,
  formVersion: true,
  formStatus: true,
  formData: true,
  neededReason: true,
  method: true,
  sentAt: true,
  createdAt: true,
  updatedAt: true,
  clientSignedAt: true,
  providerSignedAt: true,
  submittedAt: true,
  supersededAt: true,
  pdfFileName: true,
  pdfSha256: true,
} satisfies Prisma.ConsentFormSelect;
type FullRow = Prisma.ConsentFormGetPayload<{ select: typeof FULL_SELECT }>;

export type AttestationView = {
  id: string;
  clientId: string;
  status: CarelonStatus;
  statusLabel: string;
  version: string;
  createdAt: string;
  sentAt: string | null;
  method: string;
  neededReasons: string[];
  clientSignedAt: string | null;
  providerSignedAt: string | null;
  submittedAt: string | null;
  supersededAt: string | null;
  formData: CarelonFormData;
  /** Blank fields on the frozen document (Part B blocked until filled) */
  blanks: string[];
  hasStoredPdf: boolean;
};

function formDataOf(row: { formData: unknown; formVersion: string | null }): CarelonFormData {
  return parseFormData(row.formData) ?? emptyFormData(row.formVersion ?? CARELON_CURRENT_VERSION, 'America/New_York', null);
}

function view(row: FullRow): AttestationView {
  const fd = formDataOf(row);
  const status = asCarelonStatus(row.formStatus);
  return {
    id: row.id,
    clientId: row.clientId,
    status,
    statusLabel: CARELON_STATUS_LABEL[status],
    version: row.formVersion ?? fd.version,
    createdAt: row.createdAt.toISOString(),
    sentAt: status === 'NOT_STARTED' ? null : row.sentAt.toISOString(),
    method: row.method,
    neededReasons: fd.neededReasons,
    clientSignedAt: row.clientSignedAt?.toISOString() ?? null,
    providerSignedAt: row.providerSignedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    formData: fd,
    blanks: fd.document ? frozenBlanks(fd.document) : [],
    hasStoredPdf: Boolean(row.pdfFileName),
  };
}

// ─── Staff: load / start ─────────────────────────────────────────────────────

async function scopedClient(actor: CarelonActor, clientId: string) {
  return prisma.client.findFirst({
    where: { AND: [clientByIdWhere(clientId, actor.organizationId), clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role as Role })] },
    select: { id: true, name: true, mrn: true, status: true },
  });
}

export type ClientCarelonView = {
  client: { id: string; name: string; mrn: string | null; status: string };
  medicaid: MedicaidDetection;
  requirement: { state: Requirement['state']; needsAction: boolean; submitted: boolean; currentId: string | null; openId: string | null };
  attestations: AttestationView[];
  prefill: CarelonPrefill;
  timeZone: string;
  permissions: { manage: boolean; signProvider: boolean; markSubmitted: boolean };
};

export async function loadClientCarelon(actor: CarelonActor, clientId: string): Promise<{ ok: true; view: ClientCarelonView } | Fail> {
  const client = await scopedClient(actor, clientId);
  if (!client) return { ok: false, status: 404, error: 'Client not found' };
  const req = await clientCarelonRequirement(actor.organizationId, client.id);
  if (!req) return { ok: false, status: 404, error: 'Client not found' };
  const rows = await prisma.consentForm.findMany({ where: { organizationId: actor.organizationId, clientId: client.id, formKey: CARELON_FORM_KEY }, select: FULL_SELECT, orderBy: { createdAt: 'desc' }, take: 50 });
  const open = rows.find((r) => r.id === req.requirement.open?.id);
  const chosen = open ? formDataOf(open).providerOptionKey : null;
  const [prefill, timeZone] = await Promise.all([buildPrefill(actor.organizationId, client.id, chosen, req.detection), getPracticeTimeZone(actor.organizationId)]);
  return {
    ok: true,
    view: {
      client,
      medicaid: req.detection,
      requirement: { state: req.requirement.state, needsAction: req.requirement.needsAction, submitted: req.requirement.submitted, currentId: req.requirement.current?.id ?? null, openId: req.requirement.open?.id ?? null },
      attestations: rows.map(view),
      prefill: prefill!,
      timeZone,
      permissions: { manage: canManageCarelon(actor.role), signProvider: canSignCarelonProvider(actor.role), markSubmitted: canMarkCarelonSubmitted(actor.role) },
    },
  };
}

function event(action: string, actor: { userId: string | null; role: string | null }, detail?: string) {
  return { at: new Date().toISOString(), action, byId: actor.userId, byRole: actor.role, ...(detail ? { detail: detail.slice(0, 300) } : {}) };
}

/**
 * Open a new attestation request for a client ("new attestation needed"), or add the reason to
 * the request already open. auto=true (program triggers) only acts for Maryland Medicaid clients;
 * staff (auto=false) may open one for any client in their scope.
 */
export async function requestCarelonAttestation(input: {
  organizationId: string;
  clientId: string;
  actorUserId: string | null;
  actorRole: string | null;
  reason: string | null;
  auto: boolean;
}): Promise<{ ok: true; outcome: 'created' | 'already_open' | 'not_medicaid'; id: string | null } | Fail> {
  const req = await clientCarelonRequirement(input.organizationId, input.clientId);
  if (!req) return { ok: false, status: 404, error: 'Client not found' };
  const rows = await prisma.consentForm.findMany({ where: { organizationId: input.organizationId, clientId: input.clientId, formKey: CARELON_FORM_KEY }, select: { ...ROW_SELECT, formData: true, formVersion: true } });
  const decision = requestDecision(req.detection.medicaid, rows.map((r) => ({ ...r, formStatus: r.formStatus ?? 'NOT_STARTED' })), { manual: !input.auto });
  const reason = input.reason?.trim().slice(0, 300) || null;
  const who = { userId: input.actorUserId, role: input.actorRole };
  if (decision === 'not_medicaid') return { ok: true, outcome: 'not_medicaid', id: null };
  if (decision === 'already_open') {
    const open = req.requirement.open ? rows.find((r) => r.id === req.requirement.open!.id) : null;
    if (open && reason) {
      const fd = formDataOf(open);
      if (!fd.neededReasons.includes(reason)) {
        fd.neededReasons.push(reason);
        fd.events.push(event('reason_added', who, reason));
        await prisma.consentForm.update({ where: { id: open.id }, data: { formData: fd as unknown as Prisma.InputJsonValue, neededReason: open.neededReason ?? reason } });
      }
    }
    return { ok: true, outcome: 'already_open', id: open?.id ?? null };
  }
  const timeZone = await getPracticeTimeZone(input.organizationId);
  const fd = emptyFormData(CARELON_CURRENT_VERSION, timeZone, reason);
  fd.events.push(event('created', who, reason ?? undefined));
  const created = await prisma.consentForm.create({
    data: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      type: CARELON_CONSENT_TYPE,
      status: 'PENDING',
      method: 'In-Person',
      createdById: input.actorUserId,
      formKey: CARELON_FORM_KEY,
      formVersion: CARELON_CURRENT_VERSION,
      formStatus: 'NOT_STARTED',
      formData: fd as unknown as Prisma.InputJsonValue,
      neededReason: reason,
    },
    select: { id: true },
  });
  return { ok: true, outcome: 'created', id: created.id };
}

/**
 * Program trigger (PRP / IOP / residential enrollment or referral): never throws into the caller;
 * returns the outcome for its audit row.
 */
export async function triggerCarelonForProgram(input: { organizationId: string; clientId: string | null | undefined; actorUserId: string | null; actorRole: string | null; programLabel: string }) {
  if (!input.clientId) return null;
  try {
    return await requestCarelonAttestation({
      organizationId: input.organizationId,
      clientId: input.clientId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      reason: `Started ${input.programLabel} (service with non-overlap rules)`,
      auto: true,
    });
  } catch (err) {
    console.error('[carelon attestation trigger]', err instanceof Error ? err.name : 'unknown');
    return null;
  }
}

// ─── Staff actions ───────────────────────────────────────────────────────────

export type StaffAction =
  | { action: 'send' }
  | { action: 'sign_participant'; partA: PartAInput }
  | { action: 'sign_provider'; partB: PartBInput }
  | { action: 'mark_submitted'; submittedOn: string; reference?: string | null }
  | { action: 'void'; reason: string }
  | { action: 'set_provider'; optionKey: string }
  | { action: 'set_participant_id'; medicaidId: string }
  | { action: 'fill_blanks' };

async function loadRow(organizationId: string, id: string) {
  return prisma.consentForm.findFirst({ where: { id, organizationId, formKey: CARELON_FORM_KEY }, select: FULL_SELECT });
}

async function save(row: FullRow, next: CarelonStatus | null, fd: CarelonFormData, extra: Prisma.ConsentFormUpdateManyMutationInput = {}) {
  const status = next ?? asCarelonStatus(row.formStatus);
  const res = await prisma.consentForm.updateMany({
    where: { id: row.id, updatedAt: row.updatedAt },
    data: { formStatus: status, status: consentStatusFor(status), formData: fd as unknown as Prisma.InputJsonValue, ...extra },
  });
  return res.count === 1;
}

const CONFLICT: Fail = { ok: false, status: 409, error: 'This attestation was just updated by someone else. Reload it.' };

function partASignature(input: PartAInput, method: PartAMethod, at: Date, tz: string, recordedBy: { id: string; name: string | null } | null) {
  const rep = input.signerType === 'representative';
  return {
    signerType: input.signerType,
    printedName: input.printedName.trim().slice(0, 120),
    relationship: rep ? (input.relationship ?? '').trim().slice(0, 80) : null,
    authority: rep ? (input.authority ?? '').trim().slice(0, 300) : null,
    signature: input.signature.trim().slice(0, 120),
    method,
    signedAt: at.toISOString(),
    dateSigned: formatPracticeMdY(at, tz)!,
    recordedById: recordedBy?.id ?? null,
    recordedByName: recordedBy?.name ?? null,
  };
}

async function userName(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return u?.name?.trim() || u?.email || null;
}

/** Signs Part A on an open row (in office, portal or intake): freezes the exact text + values. */
async function signPartA(row: FullRow, input: PartAInput, method: PartAMethod, by: { userId: string | null; role: string | null; recordedBy: { id: string; name: string | null } | null }, opts: { allowBlanks?: boolean } = {}) {
  const errors = validatePartA(input);
  if (errors.length) return { ok: false as const, status: 400, error: errors[0], errors };
  const t = transition(asCarelonStatus(row.formStatus), 'sign_participant');
  if (t.ok === false) return { ok: false as const, status: 409, error: t.error };
  const fd = formDataOf(row);
  const template = carelonTemplate(fd.version) ?? carelonTemplate()!;
  const prefill = await buildPrefill(row.organizationId, row.clientId, fd.providerOptionKey);
  if (!prefill) return { ok: false as const, status: 404, error: 'Client not found' };
  if (prefill.blockers.length && !opts.allowBlanks) return { ok: false as const, status: 409, error: prefill.blockers[0], errors: prefill.blockers };
  const now = new Date();
  const tz = fd.timeZone || (await getPracticeTimeZone(row.organizationId));
  fd.document = freezeDocument(
    template,
    { participantName: prefill.participant.participantName, participantId: prefill.participant.participantId, dateOfBirth: prefill.participant.dateOfBirth },
    { organizationName: prefill.provider.organizationName, npi: prefill.provider.npi, tin: prefill.provider.tin },
    now
  );
  fd.version = template.version;
  fd.partA = partASignature(input, method, now, tz, by.recordedBy);
  fd.events.push(event(`part_a_signed_${method}`, by, input.signerType));
  const ok = await save(row, t.next, fd, {
    clientSignedAt: now,
    formVersion: template.version,
    method: method === 'portal' ? 'Patient Portal' : method === 'intake' ? 'Intake Packet' : 'In-Person',
    signedByName: fd.partA.printedName,
  });
  return ok ? { ok: true as const } : CONFLICT;
}

export async function applyStaffAction(actor: CarelonActor, id: string, a: StaffAction): Promise<{ ok: true; attestation: AttestationView; pdfStored?: boolean; filled?: string[] } | (Fail & { errors?: string[] })> {
  const row = await loadRow(actor.organizationId, id);
  if (!row) return { ok: false, status: 404, error: 'Attestation not found' };
  const client = await scopedClient(actor, row.clientId);
  if (!client) return { ok: false, status: 404, error: 'Attestation not found' };
  if (!canManageCarelon(actor.role)) return { ok: false, status: 403, error: 'Your role cannot manage this form' };
  const fd = formDataOf(row);
  const current = asCarelonStatus(row.formStatus);
  const who = { userId: actor.userId, role: actor.role };
  const done = async (extra: { pdfStored?: boolean; filled?: string[] } = {}) => ({ ok: true as const, attestation: view((await loadRow(actor.organizationId, id))!), ...extra });

  switch (a.action) {
    case 'send': {
      const t = transition(current, 'send');
      if (t.ok === false) return { ok: false, status: 409, error: t.error };
      const prefill = await buildPrefill(actor.organizationId, row.clientId, fd.providerOptionKey);
      if (prefill?.blockers.length) return { ok: false, status: 409, error: prefill.blockers[0], errors: prefill.blockers };
      fd.events.push(event(current === 'SENT' ? 'resent' : 'sent', who));
      return (await save(row, t.next, fd, { sentAt: new Date(), method: 'Patient Portal' })) ? done() : CONFLICT;
    }
    case 'sign_participant': {
      const r = await signPartA(row, a.partA, 'in_office', { ...who, recordedBy: { id: actor.userId, name: await userName(actor.userId) } });
      if (r.ok === false) return r as Fail & { errors?: string[] };
      return done();
    }
    case 'fill_blanks': {
      if (current !== 'CLIENT_SIGNED' || !fd.document) return { ok: false, status: 409, error: 'Only a signed Part A with blank fields can be completed.' };
      const prefill = await buildPrefill(actor.organizationId, row.clientId, fd.providerOptionKey);
      const res = fillBlanks(fd.document, prefill?.participant ?? {}, prefill?.provider ?? {});
      if (!res.filled.length) return { ok: false, status: 409, error: frozenBlanks(fd.document).length ? `Still missing: ${frozenBlanks(fd.document).join(', ')}. Add them to the client or practice settings first.` : 'Nothing to fill.' };
      fd.document = res.doc;
      fd.events.push(event('blanks_filled', who, res.filled.join(',')));
      return (await save(row, null, fd)) ? done({ filled: res.filled }) : CONFLICT;
    }
    case 'sign_provider': {
      if (!canSignCarelonProvider(actor.role)) return { ok: false, status: 403, error: 'Your role cannot sign for the provider' };
      const errors = validatePartB(a.partB);
      if (errors.length) return { ok: false, status: 400, error: errors[0], errors };
      const t = transition(current, 'sign_provider');
      if (t.ok === false) return { ok: false, status: 409, error: t.error };
      if (!fd.document) return { ok: false, status: 409, error: 'Part A has not been signed.' };
      const blanks = frozenBlanks(fd.document);
      if (blanks.length) return { ok: false, status: 409, error: `Complete the form before the provider signs. Missing: ${blanks.join(', ')}.` };
      const now = new Date();
      const tz = fd.timeZone || (await getPracticeTimeZone(actor.organizationId));
      fd.partB = {
        printedName: a.partB.printedName.trim().slice(0, 120),
        title: a.partB.title.trim().slice(0, 120),
        signature: a.partB.signature.trim().slice(0, 120),
        signedAt: now.toISOString(),
        dateSigned: formatPracticeMdY(now, tz)!,
        userId: actor.userId,
        role: actor.role,
      };
      fd.events.push(event('part_b_signed', who));
      // Signed PDF, stored with the client's documents (regenerated from the frozen record if the write fails)
      const stored = await storePdf(row.id, fd, tz, now);
      const ok = await save(row, t.next, fd, {
        providerSignedAt: now,
        providerSignedById: actor.userId,
        signedAt: now,
        ...(stored ? { pdfFileName: stored.fileName, pdfSha256: stored.sha256 } : {}),
      });
      if (!ok) return CONFLICT;
      // A newer completed attestation supersedes the older ones
      await prisma.consentForm.updateMany({
        where: { organizationId: actor.organizationId, clientId: row.clientId, formKey: CARELON_FORM_KEY, formStatus: { in: ['COMPLETE', 'SUBMITTED'] }, id: { not: row.id } },
        data: { formStatus: 'SUPERSEDED', status: 'EXPIRED', supersededAt: now, supersededById: actor.userId },
      });
      return done({ pdfStored: Boolean(stored) });
    }
    case 'mark_submitted': {
      if (!canMarkCarelonSubmitted(actor.role)) return { ok: false, status: 403, error: 'Your role cannot record the Carelon submission' };
      const t = transition(current, 'mark_submitted');
      if (t.ok === false) return { ok: false, status: 409, error: t.error };
      const tz = fd.timeZone || (await getPracticeTimeZone(actor.organizationId));
      const ymd = parseSubmittedOn(a.submittedOn);
      if (!ymd) return { ok: false, status: 400, error: 'Enter the submission date as MM/DD/YYYY.' };
      const today = practiceToday(tz);
      const signedDay = row.providerSignedAt ? formatPracticeMdY(row.providerSignedAt, tz)! : null;
      if (ymd > today) return { ok: false, status: 400, error: 'The submission date cannot be in the future.' };
      if (signedDay && ymd < mdyToYmd(signedDay)) return { ok: false, status: 400, error: 'The submission date cannot be before the provider signed.' };
      const [y, m, d] = ymd.split('-');
      fd.submission = {
        submittedOn: `${m}/${d}/${y}`,
        recordedAt: new Date().toISOString(),
        recordedById: actor.userId,
        recordedByName: await userName(actor.userId),
        reference: a.reference?.trim().slice(0, 80) || null,
      };
      fd.events.push(event('submitted_to_carelon', who));
      return (await save(row, t.next, fd, { submittedAt: new Date(`${ymd}T12:00:00Z`), submittedById: actor.userId })) ? done() : CONFLICT;
    }
    case 'void': {
      const t = transition(current, 'void');
      if (t.ok === false) return { ok: false, status: 409, error: t.error };
      const reason = a.reason.trim();
      if (reason.length < 3) return { ok: false, status: 400, error: 'Give a reason for cancelling (3+ characters).' };
      fd.events.push(event('cancelled', who, reason));
      return (await save(row, t.next, fd)) ? done() : CONFLICT;
    }
    case 'set_provider': {
      if (fd.document) return { ok: false, status: 409, error: 'The provider cannot change after Part A is signed.' };
      const options = await loadProviderOptions(actor.organizationId);
      if (!options.some((o) => o.key === a.optionKey)) return { ok: false, status: 400, error: 'Unknown provider NPI option' };
      fd.providerOptionKey = a.optionKey;
      fd.events.push(event('provider_selected', who, a.optionKey));
      return (await save(row, null, fd)) ? done() : CONFLICT;
    }
    case 'set_participant_id': {
      const ma = a.medicaidId.replace(/\s/g, '');
      if (!/^\d{11}$/.test(ma)) return { ok: false, status: 400, error: 'The Maryland Medicaid (MA) number is 11 digits.' };
      if (current === 'COMPLETE' || current === 'SUBMITTED' || current === 'SUPERSEDED' || current === 'VOIDED') return { ok: false, status: 409, error: 'This attestation is closed.' };
      const c = await prisma.client.findUnique({ where: { id: row.clientId }, select: { medicaidId: true } });
      if (c?.medicaidId && /^\d{11}$/.test(c.medicaidId.trim()) && c.medicaidId.trim() !== ma) {
        return { ok: false, status: 409, error: 'A different MA number is already on the client. Correct it in the client demographics.' };
      }
      await prisma.client.update({ where: { id: row.clientId }, data: { medicaidId: ma } });
      fd.events.push(event('participant_id_entered', who));
      if (fd.document && !fd.document.participant.participantId) {
        fd.document = { ...fd.document, participant: { ...fd.document.participant, participantId: ma } };
      }
      return (await save(row, null, fd)) ? done({ filled: ['participantId'] }) : CONFLICT;
    }
  }
}

function mdyToYmd(mdy: string) {
  const [m, d, y] = mdy.split('/');
  return `${y}-${m}-${d}`;
}

/** MM/DD/YYYY or YYYY-MM-DD → YYYY-MM-DD (valid calendar date) or null */
export function parseSubmittedOn(raw: string): string | null {
  const s = (raw || '').trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (mt) [m, d, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

function pdfInputFrom(id: string, fd: CarelonFormData, tz: string, generatedAt: Date, fallback?: { template: CarelonTemplate; prefill: CarelonPrefill }) {
  const doc = fd.document;
  return {
    template: doc?.template ?? fallback?.template ?? carelonTemplate(fd.version) ?? carelonTemplate()!,
    participant: doc?.participant ?? {
      participantName: fallback?.prefill.participant.participantName ?? null,
      participantId: fallback?.prefill.participant.participantId ?? null,
      dateOfBirth: fallback?.prefill.participant.dateOfBirth ?? null,
    },
    provider: doc?.provider ?? {
      organizationName: fallback?.prefill.provider.organizationName ?? null,
      npi: fallback?.prefill.provider.npi ?? null,
      tin: fallback?.prefill.provider.tin ?? null,
    },
    partA: fd.partA,
    partB: fd.partB,
    submission: fd.submission,
    recordId: id,
    timeZone: tz,
    generatedAt,
  };
}

async function storePdf(id: string, fd: CarelonFormData, tz: string, at: Date): Promise<{ fileName: string; sha256: string } | null> {
  try {
    const bytes = await buildCarelonPdf(pdfInputFrom(id, fd, tz, at));
    const fileName = `${id}-carelon-attestation.pdf`;
    const abs = signedFormPath(fileName);
    if (!abs) return null;
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    return { fileName, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (err) {
    console.error('[carelon attestation pdf store]', err instanceof Error ? err.name : 'unknown');
    return null;
  }
}

/**
 * PDF for download: the stored signed file when present and intact, else rebuilt from the frozen
 * record (an unsigned / not-started form prints with the live prefill for a wet signature).
 */
export async function attestationPdf(actor: CarelonActor, id: string): Promise<{ ok: true; bytes: Uint8Array; fileName: string; clientId: string; source: 'stored' | 'generated'; status: CarelonStatus } | Fail> {
  const row = await loadRow(actor.organizationId, id);
  if (!row) return { ok: false, status: 404, error: 'Attestation not found' };
  if (!(await scopedClient(actor, row.clientId))) return { ok: false, status: 404, error: 'Attestation not found' };
  const status = asCarelonStatus(row.formStatus);
  const fileName = `carelon-nonoverlap-attestation-${row.id}.pdf`;
  if (row.pdfFileName && row.pdfSha256) {
    const abs = signedFormPath(row.pdfFileName);
    if (abs) {
      try {
        const buf = await readFile(abs);
        if (createHash('sha256').update(buf).digest('hex') === row.pdfSha256) {
          return { ok: true, bytes: new Uint8Array(buf), fileName, clientId: row.clientId, source: 'stored', status };
        }
      } catch {
        // fall through: rebuild from the frozen record
      }
    }
  }
  const fd = formDataOf(row);
  const tz = fd.timeZone || (await getPracticeTimeZone(actor.organizationId));
  const fallback = fd.document ? undefined : { template: carelonTemplate(fd.version) ?? carelonTemplate()!, prefill: (await buildPrefill(actor.organizationId, row.clientId, fd.providerOptionKey))! };
  const bytes = await buildCarelonPdf(pdfInputFrom(row.id, fd, tz, row.providerSignedAt ?? new Date(), fallback));
  return { ok: true, bytes, fileName, clientId: row.clientId, source: 'generated', status };
}

/** Completed attestations listed with the chart documents (download goes through the audited route). */
export async function chartAttestationDocuments(organizationId: string, clientId: string) {
  const rows = await prisma.consentForm.findMany({
    where: { organizationId, clientId, formKey: CARELON_FORM_KEY, formStatus: { in: ['COMPLETE', 'SUBMITTED', 'SUPERSEDED'] } },
    select: { id: true, formStatus: true, providerSignedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return rows.map((r) => ({
    id: `carelon:${r.id}`,
    name: `Carelon non-overlap attestation (${CARELON_STATUS_LABEL[asCarelonStatus(r.formStatus)]})`,
    category: 'Consent',
    size: '—',
    uploadedAt: (r.providerSignedAt ?? r.createdAt).toISOString().slice(0, 10),
    filesTo: 'Consents',
    url: `/api/consents/carelon/${r.id}/pdf`,
  }));
}

// ─── Patient portal ──────────────────────────────────────────────────────────

type PatientCtx = { clientId: string; organizationId: string };
const PATIENT_VISIBLE: CarelonStatus[] = ['SENT', 'CLIENT_SIGNED', 'COMPLETE', 'SUBMITTED'];

export type PatientAttestationDoc = {
  id: string;
  kind: 'carelon-attestation';
  title: string;
  status: 'AWAITING' | 'SIGNED';
  sentAt: string | null;
  clinicianName: null;
  signedAt: string | null;
  signedName: string | null;
  declinedAt: null;
  declineReason: null;
  carelon?: {
    template: CarelonTemplate;
    participant: { participantName: string | null; participantId: string | null; dateOfBirth: string | null };
    provider: { organizationName: string | null; npi: string | null; tin: string | null };
    partA: CarelonFormData['partA'];
    /** Guardian / personal representative on the chart (prefills the representative fields) */
    guardian: { name: string | null; relationship: string | null } | null;
  };
};

async function patientDoc(row: FullRow, withForm: boolean): Promise<PatientAttestationDoc> {
  const fd = formDataOf(row);
  const status = asCarelonStatus(row.formStatus);
  const base: PatientAttestationDoc = {
    id: row.id,
    kind: 'carelon-attestation',
    title: 'Carelon attestation: ending overlapping authorizations (Maryland Medicaid)',
    status: status === 'SENT' ? 'AWAITING' : 'SIGNED',
    sentAt: row.sentAt.toISOString(),
    clinicianName: null,
    signedAt: row.clientSignedAt?.toISOString() ?? null,
    signedName: fd.partA?.printedName ?? null,
    declinedAt: null,
    declineReason: null,
  };
  if (!withForm) return base;
  const template = fd.document?.template ?? carelonTemplate(fd.version) ?? carelonTemplate()!;
  let participant = fd.document?.participant;
  let provider = fd.document?.provider;
  if (!participant || !provider) {
    const prefill = await buildPrefill(row.organizationId, row.clientId, fd.providerOptionKey);
    participant = { participantName: prefill?.participant.participantName ?? null, participantId: prefill?.participant.participantId ?? null, dateOfBirth: prefill?.participant.dateOfBirth ?? null };
    provider = { organizationName: prefill?.provider.organizationName ?? null, npi: prefill?.provider.npi ?? null, tin: prefill?.provider.tin ?? null };
  }
  const g = await prisma.client.findUnique({ where: { id: row.clientId }, select: { guardianName: true, guardianRelationship: true } });
  return {
    ...base,
    carelon: {
      template,
      participant,
      provider,
      partA: fd.partA,
      guardian: g?.guardianName ? { name: g.guardianName, relationship: g.guardianRelationship } : null,
    },
  };
}

export async function listPatientAttestations(ctx: PatientCtx): Promise<PatientAttestationDoc[]> {
  const rows = await prisma.consentForm.findMany({
    where: { organizationId: ctx.organizationId, clientId: ctx.clientId, formKey: CARELON_FORM_KEY, formStatus: { in: PATIENT_VISIBLE } },
    select: FULL_SELECT,
    orderBy: { sentAt: 'desc' },
    take: 20,
  });
  return Promise.all(rows.map((r) => patientDoc(r, false)));
}

export async function getPatientAttestation(ctx: PatientCtx, id: string): Promise<PatientAttestationDoc | null> {
  const row = await prisma.consentForm.findFirst({
    where: { id, organizationId: ctx.organizationId, clientId: ctx.clientId, formKey: CARELON_FORM_KEY, formStatus: { in: PATIENT_VISIBLE } },
    select: FULL_SELECT,
  });
  return row ? patientDoc(row, true) : null;
}

/** Portal e-sign of Part A (the participant or their Authorized Representative). */
export async function patientSignAttestation(ctx: PatientCtx & { accountId: string }, id: string, input: PartAInput): Promise<{ ok: true; document: PatientAttestationDoc } | (Fail & { errors?: string[] })> {
  const row = await prisma.consentForm.findFirst({ where: { id, organizationId: ctx.organizationId, clientId: ctx.clientId, formKey: CARELON_FORM_KEY }, select: FULL_SELECT });
  if (!row || asCarelonStatus(row.formStatus) !== 'SENT') return { ok: false, status: row ? 409 : 404, error: row ? 'This form is not waiting for your signature.' : 'Document not found' };
  const r = await signPartA(row, input, 'portal', { userId: null, role: 'PATIENT', recordedBy: null });
  if (r.ok === false) return r as Fail & { errors?: string[] };
  const fresh = await loadRow(ctx.organizationId, id);
  return { ok: true, document: await patientDoc(fresh!, true) };
}

// ─── Intake packet ───────────────────────────────────────────────────────────

/**
 * Public intake: when the new client is Maryland Medicaid and they completed the attestation
 * section, record Part A (method intake). Values the new chart does not have yet (e.g. the MA
 * number) stay blank on the frozen form; staff fill them from the chart before Part B.
 */
export async function recordIntakeAttestation(input: { organizationId: string; clientId: string; staffOwnerId: string | null; partA: PartAInput }): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const req = await clientCarelonRequirement(input.organizationId, input.clientId);
  if (!req) return { ok: false, reason: 'client_not_found' };
  if (!req.detection.medicaid) return { ok: false, reason: 'not_medicaid' };
  const opened = await requestCarelonAttestation({
    organizationId: input.organizationId,
    clientId: input.clientId,
    actorUserId: input.staffOwnerId,
    actorRole: null,
    reason: 'New Medicaid client (intake packet)',
    auto: true,
  });
  if (opened.ok === false || !opened.id) return { ok: false, reason: 'not_opened' };
  const row = await loadRow(input.organizationId, opened.id);
  if (!row) return { ok: false, reason: 'not_found' };
  const r = await signPartA(row, input.partA, 'intake', { userId: null, role: 'PATIENT', recordedBy: null }, { allowBlanks: true });
  if (r.ok === false) return { ok: false, reason: (r as Fail).error };
  return { ok: true, id: opened.id };
}
