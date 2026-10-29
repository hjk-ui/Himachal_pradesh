import { randomBytes } from 'node:crypto';
import type { Claim, ClaimStatus, Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { loadPrpSettingsRow } from '@/lib/prp/settings';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { releasePriorAuthUsage } from '@/lib/billing/priorAuthUsage';
import { loadPayerMappings } from '@/lib/billing/waystarConfig';
import {
  CONTROL_NUMBER_RE,
  FILING_CODES,
  RELATIONSHIP_CODES,
  cobProblems,
  eraAdjudicationFromPayments,
  type CobAdjudication,
  findPayerMapping,
  type PayerMappingConfig,
} from '@/lib/billing/waystarSftpClaims';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { reasonCodeFromText } from '@/features/billing/denialCategories';
import type { WaystarSftpClaimInfo } from '@/features/billing/claimsApi';
import { extractNoteCpt } from '@/lib/billing/noteCoding';
import { claimDiagnosesFromNote } from '@/lib/billing/noteDiagnoses';
import {
  normalizeClaimLines,
  serviceLineData,
  type ClaimLineInput,
  type LineMeta,
} from '@/lib/billing/claimLines';
import { claimLineCpt, pickFee, priceClaimLines, visitContext } from '@/lib/billing/feeSchedule';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import {
  COSIGN_PENDING_MESSAGE,
  cosignPending,
  noteClaimFindings,
  notePracticeDate,
  prpClaimBlock,
  prpIrpProblem,
} from '@/lib/billing/claimRules';
import { loadFeeSchedule } from '@/lib/billing/feeScheduleDb';
import { groupNoteBilling } from '@/lib/groups/claimGate';
import { isBillingCore } from './billingAccess';

/** The practice's confirmed PRP billing model (null = not confirmed; PRP claims are held). */
async function prpBillingModelFor(organizationId: string): Promise<string | null> {
  return (await loadPrpSettingsRow(organizationId))?.prpBillingModel ?? null;
}

export const CLAIM_STATUSES = [
  'DRAFT',
  'READY',
  'SUBMITTED',
  'ACCEPTED',
  'DENIED',
  'PAID',
] as const satisfies readonly ClaimStatus[];

/** Billing core only (Admin, Director, Practice Director, Billing): billingAccess.isBillingCore. */
export function canAccessClaims(role: Role | undefined | null) {
  return isBillingCore(role);
}

export function canMutateClaims(role: Role | undefined | null) {
  return canAccessClaims(role);
}

const DRAFT_CLAIM_ROLES: Role[] = [
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'BILLING',
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
  'CLINICIAN',
];

/** Billing staff plus licensed clinicians who lock notes / accept coding. */
export function canGenerateDraftClaim(role: Role | undefined | null) {
  return Boolean(role && DRAFT_CLAIM_ROLES.includes(role));
}

const claimInclude = {
  client: { select: { name: true } },
  appointment: {
    select: {
      startsAt: true,
      clinician: { select: { name: true } },
    },
  },
  // Date of service and rendering clinician come from the note (B1); the appointment is a cross-check
  progressNote: { select: { dateOfService: true, clinician: { select: { name: true } } } },
} as const;

export type ClaimListItem = {
  availityClaimId?: string | null;
  clearinghouseClaimId?: string | null;
  clearinghouseProvider?: string | null;
  submissionInProgress?: boolean;
  submissionError?: string | null;
  clearinghouseDemo?: boolean;
  submissionData?: { payerId: string; diagnosisCodes: string[]; placeOfService: string; claimFilingCode: 'MC' | 'MB' | 'BL' | 'CI'; waystarSftp?: WaystarSftpClaimInfo } | null;

  /** CLM01 sent to Waystar (<= 20 chars) */
  claimControlNumber?: string | null;
  /** 1 original, 7 corrected (replacement), 8 void */
  frequencyCode?: string;
  /** P / S / T */
  payerResponsibility?: string;
  payerClaimControlNumber?: string | null;
  primaryClaimId?: string | null;
  priorAuthNumber?: string | null;
  placeOfService?: string | null;
  billingNpi?: string | null;
  /** Waystar payer mapping for the claim's payer (null = unmapped) */
  waystarPayer?: { payerId: string; claimFilingCode: string; verified: boolean; payerName: string } | null;

  id: string;
  displayId: string;
  clientId: string;
  clientName: string;
  clinicianName: string | null;
  appointmentId: string | null;
  progressNoteId: string | null;
  cptCode: string;
  cptDescription: string;
  units: number;
  amountCents: number | null;
  payer: string | null;
  status: ClaimStatus;
  uiStatus: 'approved' | 'pending' | 'denied';
  denialReason: string | null;
  serviceDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClaimActor = {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
};

import { cptByCode, cptDescription } from '@/lib/constants/cpt';

function claimUiStatus(status: ClaimStatus): 'approved' | 'pending' | 'denied' {
  if (status === 'DENIED') return 'denied';
  if (status === 'ACCEPTED' || status === 'PAID') return 'approved';
  return 'pending';
}

function claimDisplayId(id: string) {
  return `CLM-${id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase()}`;
}

function serialize(
  row: Claim & {
    client: { name: string };
    appointment: { startsAt: Date; clinician: { name: string | null } | null } | null;
    progressNote?: { dateOfService: Date | null; clinician: { name: string | null } | null } | null;
  },
  mappings?: PayerMappingConfig[]
): ClaimListItem {
  const mapped = mappings ? findPayerMapping(mappings, row.payer) : null;
  return {
    claimControlNumber: row.claimControlNumber,
    frequencyCode: row.frequencyCode,
    payerResponsibility: row.payerResponsibility,
    payerClaimControlNumber: row.payerClaimControlNumber,
    primaryClaimId: row.primaryClaimId,
    priorAuthNumber: row.priorAuthNumber,
    placeOfService: row.placeOfService,
    billingNpi: row.billingNpi,
    ...(mappings
      ? { waystarPayer: mapped ? { payerId: mapped.waystarPayerId, claimFilingCode: mapped.claimFilingCode, verified: mapped.verified, payerName: mapped.payerName } : null }
      : {}),
    availityClaimId: row.availityClaimId,
    clearinghouseClaimId: row.clearinghouseClaimId,
    clearinghouseProvider: row.clearinghouseProvider,
    submissionInProgress: row.submissionInProgress, submissionError: row.submissionError,
    clearinghouseDemo: row.clearinghouseDemo,
    submissionData: row.submissionData as ClaimListItem['submissionData'],
    id: row.id,
    displayId: claimDisplayId(row.id),
    clientId: row.clientId,
    clientName: row.client.name,
    clinicianName: row.progressNote?.clinician?.name ?? row.appointment?.clinician?.name ?? null,
    appointmentId: row.appointmentId,
    progressNoteId: row.progressNoteId,
    cptCode: row.cptCode,
    cptDescription: cptDescription(row.cptCode),
    units: row.units,
    amountCents: row.amountCents,
    payer: row.payer,
    status: row.status,
    uiStatus: claimUiStatus(row.status),
    denialReason: row.denialReason,
    serviceDate: row.progressNote?.dateOfService?.toISOString() ?? row.appointment?.startsAt.toISOString() ?? row.createdAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type ManualClaimInput = {
  clientId: string;
  cptCode: string;
  diagnosisCodes: string[];
  placeOfService?: string;
  units?: number;
  modifiers?: string[];
  telehealth?: boolean;
  payer?: string | null;
  memberId?: string | null;
  serviceDate?: string | null;
  clinicianLabel?: string | null;
  /** Staff user chosen in the rendering-provider dropdown; their NPI becomes Claim.renderingNpi (837P 2310B) */
  renderingUserId?: string | null;
  groupNumber?: string | null;
  markReady?: boolean;
  /**
   * Service lines. When present, line 1 replaces cptCode/units/modifiers on the
   * claim header and every line is stored in ClaimServiceLine.
   */
  lines?: ClaimLineInput[];
};

/** Active staff member in the org with a valid 10-digit NPI (User.npi, else the HR profile NPI). */
async function renderingProviderFor(organizationId: string, userId: string) {
  const u = await prisma.user.findFirst({
    where: { id: userId, organizationId, status: 'ACTIVE' },
    select: { id: true, name: true, email: true, npi: true, credentials: true, staffHrProfile: { select: { npi: true } } },
  });
  if (!u) return null;
  const npi = [u.npi, u.staffHrProfile?.npi].map((v) => (v || '').replace(/\D/g, '')).find((v) => v.length === 10);
  if (!npi) return null;
  const name = [u.name || u.email, u.credentials].filter(Boolean).join(', ');
  return { npi, label: `${name} — NPI ${npi}` };
}

/**
 * Create a DRAFT/READY claim from the Billing "New Claim" modal (no note required).
 * CPT, units, POS, modifiers, and diagnoses persist on the row / submissionData.
 */
export async function createManualClaim(actor: ClaimActor, input: ManualClaimInput) {
  if (!canMutateClaims(actor.actorRole)) {
    return { ok: false as const, error: 'Forbidden', status: 403 as const };
  }

  const access = clientAccessWhere({
    organizationId: actor.organizationId,
    actorUserId: actor.actorUserId,
    actorRole: actor.actorRole,
  });

  const client = await prisma.client.findFirst({
    where: {
      AND: [{ id: input.clientId }, clientOrgFilter(actor.organizationId), access],
    },
    select: { id: true, name: true, insurancePayer: true, insuranceMemberId: true, dateOfBirth: true, insuranceEffectiveTo: true },
  });
  if (!client) {
    return { ok: false as const, error: 'Patient not found', status: 404 as const };
  }

  const rendering = input.renderingUserId ? await renderingProviderFor(actor.organizationId, input.renderingUserId) : null;
  if (input.renderingUserId && !rendering) {
    return {
      ok: false as const,
      error: 'The selected rendering provider is not active in this practice or has no valid 10-digit NPI',
      status: 400 as const,
    };
  }

  const dx = (input.diagnosisCodes || [])
    .map((d) => d.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 4);
  if (dx.length < 1) {
    return {
      ok: false as const,
      error: 'At least one ICD-10 diagnosis code is required',
      status: 400 as const,
    };
  }

  // Line 1 drives the legacy single-line columns; extra lines go to ClaimServiceLine.
  const lineInputs: ClaimLineInput[] = input.lines?.length
    ? input.lines
    : [
        {
          cptCode: input.cptCode,
          modifiers: (input.modifiers || []).map((m) => m.trim().toUpperCase()).filter(Boolean),
          units: Number(input.units) || 1,
          serviceDate: input.serviceDate || null,
        },
      ];
  const pos = (input.placeOfService || '11').trim() || '11';
  const payerName = input.payer?.trim() || client.insurancePayer?.trim() || null;

  // Charges default from the org fee schedule (variant by telehealth / self-pay / child on DOS);
  // the payer gets the fee item's billed CPT, never the Valant suffix code.
  const priced = priceClaimLines(await loadFeeSchedule(actor.organizationId, { activeOnly: true }), lineInputs, {
    ...visitContext(client, {
      serviceDate: input.serviceDate || null,
      payer: payerName,
      telehealth: Boolean(input.telehealth || pos === '02' || pos === '10'),
    }),
  });
  if ('error' in priced) {
    return { ok: false as const, error: priced.error, status: 400 as const };
  }
  const normalized = normalizeClaimLines(priced.lines, dx.length, { isKnownCode: priced.isKnownCode });
  if (!normalized.ok) {
    return { ok: false as const, error: normalized.error, status: 400 as const };
  }
  const lines = normalized.lines;
  const first = lines[0];
  const prp = prpClaimBlock(lines.map((l) => l.cptCode), await prpBillingModelFor(actor.organizationId));
  if (prp) return blocked([prp, ...(await prpIrpMessages(client.id, input.serviceDate || null))]);

  const base = first.cptCode;
  if (!cptByCode(base) && !priced.isKnownCode(base)) {
    return { ok: false as const, error: `Unknown CPT/HCPCS code: ${input.cptCode}`, status: 400 as const };
  }

  const units = first.units;
  const mods = [...first.modifiers];

  let cptStored = base;
  if (input.telehealth || pos === '02' || pos === '10') {
    for (const m of ['GT', '95']) {
      if (!mods.includes(m)) mods.push(m);
    }
  }
  // Encode first modifier on cptCode for legacy submitters that split on '-'
  if (mods[0] && !cptStored.includes('-')) {
    cptStored = `${base}-${mods[0]}`;
  }
  first.modifiers = mods;

  const totalCents = lines.reduce((t, l) => t + l.chargeCents, 0);

  // Waystar payer ID + filing indicator from the payer mapping (blank when unmapped; pre-send reports it)
  const mapped = findPayerMapping(await loadPayerMappingsSafe(actor.organizationId), payerName);
  const submissionData = {
    payerId: mapped?.waystarPayerId ?? '',
    diagnosisCodes: dx,
    placeOfService: pos,
    claimFilingCode: (mapped?.claimFilingCode ?? 'CI') as 'MC' | 'MB' | 'BL' | 'CI',
    modifiers: mods,
    memberId: input.memberId?.trim() || client.insuranceMemberId || null,
    groupNumber: input.groupNumber?.trim() || null,
    serviceDate: input.serviceDate || null,
    clinicianLabel: rendering?.label ?? (input.clinicianLabel || null),
    source: 'manual_claim_modal',
    feeSchedule: priced.summary,
  };

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.claim.create({
      data: {
        organizationId: actor.organizationId,
        clientId: client.id,
        progressNoteId: null,
        cptCode: cptStored,
        units,
        amountCents: totalCents,
        payer: payerName,
        placeOfService: pos,
        icd10Codes: dx,
        status: input.markReady ? 'READY' : 'DRAFT',
        ...(rendering ? { renderingNpi: rendering.npi } : {}),
        submissionData,
      },
    });
    const lineMeta: Record<string, LineMeta> = {};
    for (const line of lines) {
      const sl = await tx.claimServiceLine.create({ data: serviceLineData(created.id, line) });
      const fee = priced.summary.lines[lines.indexOf(line)];
      lineMeta[sl.id] = {
        serviceDate: line.serviceDate || input.serviceDate || null,
        diagnosisPointers: line.diagnosisPointers,
        feeCode: fee?.code ?? null,
        feeSource: fee?.source ?? null,
      };
    }
    return tx.claim.update({
      where: { id: created.id },
      data: { submissionData: { ...submissionData, lineMeta } },
      include: claimInclude,
    });
  });

  return { ok: true as const, claim: serialize(row) };
}

export async function listClaims(
  actor: ClaimActor,
  opts?: { status?: ClaimStatus; q?: string }
) {
  const q = opts?.q?.trim();
  const rows = await prisma.claim.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(q
        ? {
            OR: [
              { id: { contains: q, mode: 'insensitive' } },
              { cptCode: { contains: q, mode: 'insensitive' } },
              { payer: { contains: q, mode: 'insensitive' } },
              { denialReason: { contains: q, mode: 'insensitive' } },
              { client: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    include: claimInclude,
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
  const mappings = await loadPayerMappingsSafe(actor.organizationId);
  return rows.map((row) => serialize(row, mappings));
}

/**
 * Fee schedule price for a note / appointment claim: telehealth from the note, self-pay when the
 * client has no active payer, child when under 18 on the date of service. Keeps "-GT"-style
 * modifier segments and swaps the base for the fee item's billed CPT.
 */
async function noteFee(
  organizationId: string,
  cptCode: string,
  units: number,
  opts: {
    client: { dateOfBirth: Date | null; insurancePayer: string | null; insuranceEffectiveTo: Date | null };
    serviceDate: Date;
    telehealth: boolean;
  }
) {
  const visit = visitContext(opts.client, { serviceDate: opts.serviceDate, telehealth: opts.telehealth });
  const [base, ...mods] = cptCode.trim().toUpperCase().split('-');
  const q = pickFee(await loadFeeSchedule(organizationId, { activeOnly: true }), { cpt: base, ...visit });
  const lc = claimLineCpt(q, { selfPay: visit.selfPay });
  return {
    cptCode: [lc.cpt, ...mods].join('-'),
    amountCents: q.feeCents * Math.max(1, units),
    info: {
      context: visit,
      lines: [{ requestedCpt: base, lineCpt: lc.cpt, code: q.code, source: q.source, variantLabel: q.variantLabel, feeCents: q.feeCents, insuranceBillable: q.insuranceBillable, chargeFromFeeSchedule: true }],
      warnings: [...q.warnings, ...(lc.warning ? [lc.warning] : [])],
    },
  };
}

/** PRP: current IRP required (reported with the PRP block; PRP claims are blocked until the billing model is confirmed). */
async function prpIrpMessages(clientId: string, serviceDate: string | null): Promise<string[]> {
  const wf = await prisma.prpWorkflow
    .findFirst({ where: { clientId }, orderBy: { updatedAt: 'desc' }, select: { stage: true, irpEffectiveDate: true, irpReviewDueDate: true } })
    .catch(() => null);
  const problem = prpIrpProblem(wf, serviceDate);
  return problem ? [problem] : [];
}

/** Claim-creation failure with the scrubber-style reasons (400). */
function blocked(messages: string[]) {
  return { ok: false as const, error: messages.join(' '), status: 400 as const };
}

const noteClaimInclude = {
  workflow: { select: { status: true, cosignRequired: true, cosignedAt: true } },
  client: { select: { id: true, name: true, insurancePayer: true, dateOfBirth: true, insuranceEffectiveTo: true } },
  appointment: { select: { id: true, clinicianId: true, startsAt: true } },
} as const;

/**
 * Draft claim from a signed note. The note is the source of truth (B1): date of service =
 * note.dateOfService (practice date), rendering = note.clinician, CPT = the note's own code
 * (B6: never guessed). The appointment the note was started from (note.appointmentId) is linked
 * for the cross-check only. Blocked while a supervisor co-signature is pending (B2) and for PRP
 * codes until the PRP billing model is confirmed.
 */
export async function generateClaimFromNote(
  actor: ClaimActor,
  noteId: string,
  opts?: { cptCode?: string; markReady?: boolean }
) {
  const note = await prisma.progressNote.findFirst({
    where: {
      id: noteId,
      client: clientOrgFilter(actor.organizationId),
    },
    include: noteClaimInclude,
  });
  if (!note) {
    return { ok: false as const, error: 'Note not found', status: 404 as const };
  }
  const status = note.workflow?.status;
  if (status !== 'LOCKED' && status !== 'SIGNED') {
    return {
      ok: false as const,
      error: 'A signed note is required to create a billing claim',
      status: 400 as const,
    };
  }
  if (cosignPending(note.workflow)) return blocked([COSIGN_PENDING_MESSAGE]);

  const existing = await prisma.claim.findUnique({
    where: { progressNoteId: note.id },
    include: claimInclude,
  });

  const requestedCpt = opts?.cptCode?.trim().toUpperCase() || null;
  // The note's CPT column, else the code the clinician recorded in an older note's metadata comment
  const noteCpt = note.cptCode?.trim().toUpperCase() || extractNoteCpt(note.body);
  const cptCode = requestedCpt || (existing ? existing.cptCode : noteCpt);
  if (!cptCode) {
    return blocked(['No CPT on the signed note. The clinician records the CPT on the note (or an addendum); codes are never guessed.']);
  }
  const addOn = !requestedCpt && !existing ? note.addOnCptCode?.trim().toUpperCase() || null : null;
  const prp = prpClaimBlock([cptCode, addOn], await prpBillingModelFor(actor.organizationId));
  if (prp) return blocked([prp, ...(await prpIrpMessages(note.clientId, notePracticeDate(note.dateOfService)))]);
  // Note written from a group session (src/lib/groups): only an attendee who attended with enough
  // minutes, in a per-session group, within the recorded group-size cap. Absent members never bill.
  const group = existing ? null : await groupNoteBilling(note.id);
  if (group?.errors.length) return blocked(group.errors);

  const timeZone = await getPracticeTimeZone(actor.organizationId);
  const noteProblems = noteClaimFindings({ ...note, cptCode }, note.appointment, { timeZone }).filter((f) => f.severity === 'error');
  // Missing date of service / clinician: nothing can be billed; appointment mismatches only stop READY
  const hard = noteProblems.filter((f) => f.code === 'NOTE_DOS_MISSING' || f.code === 'NOTE_CLINICIAN_MISSING');
  if (hard.length) return blocked(hard.map((f) => f.message));
  const wantsReady = Boolean(opts?.markReady) && (!existing || existing.status === 'DRAFT');
  if (wantsReady && noteProblems.length) return blocked(noteProblems.map((f) => f.message));

  const nextStatus = wantsReady ? 'READY' : existing?.status ?? 'DRAFT';
  const telehealth =
    note.telehealth || note.audioOnly || ['02', '10'].includes(note.placeOfService ?? '') || /-(GT|95|93|FQ)/.test(cptCode);
  const feeOpts = { client: note.client, serviceDate: note.dateOfService!, telehealth };
  const fee = await noteFee(actor.organizationId, cptCode, existing?.units || 1, feeOpts);

  if (existing) {
    const shouldUpdate =
      (requestedCpt && requestedCpt !== existing.cptCode) ||
      (opts?.markReady && existing.status === 'DRAFT');
    if (shouldUpdate && (existing.status === 'DRAFT' || existing.status === 'READY')) {
      const row = await prisma.claim.update({
        where: { id: existing.id },
        data: {
          cptCode: fee.cptCode,
          amountCents: fee.amountCents,
          status: nextStatus,
          submissionData: {
            ...(existing.submissionData && typeof existing.submissionData === 'object' && !Array.isArray(existing.submissionData)
              ? (existing.submissionData as Record<string, unknown>)
              : {}),
            feeSchedule: fee.info,
          } as Prisma.InputJsonValue,
        },
        include: claimInclude,
      });
      return { ok: true as const, claim: serialize(row), alreadyExisted: true };
    }
    return { ok: true as const, claim: serialize(existing), alreadyExisted: true };
  }

  // Psychiatric E/M note with a psychotherapy add-on: two lines (E/M + add-on), 1 unit each
  const addOnFee = addOn ? await noteFee(actor.organizationId, addOn, 1, feeOpts) : null;
  const notePayer = note.client.insurancePayer?.trim() || null;
  const mapped = findPayerMapping(await loadPayerMappingsSafe(actor.organizationId), notePayer);
  const dos = notePracticeDate(note.dateOfService);
  // Diagnoses the clinician linked on the note (Service details), in their pointer order, primary
  // first, max 12. None linked: unchanged behavior (billing enters them; scrubber uses the chart).
  const noteDx = claimDiagnosesFromNote(
    (
      await prisma.progressNoteServiceDetail
        .findUnique({ where: { noteId: note.id }, select: { diagnosisCodes: true } })
        .catch(() => null)
    )?.diagnosisCodes
  );
  const submissionData = {
    ...(mapped ? { payerId: mapped.waystarPayerId, claimFilingCode: mapped.claimFilingCode, payerIdSource: 'waystar_payer_mapping' } : {}),
    ...(noteDx ? { diagnosisCodes: noteDx.codes, diagnosisPointers: noteDx.linePointers, diagnosisSource: 'note_service_detail' } : {}),
    serviceDate: dos,
    feeSchedule: addOnFee
      ? { ...fee.info, lines: [...fee.info.lines, ...addOnFee.info.lines], warnings: [...fee.info.warnings, ...addOnFee.info.warnings] }
      : fee.info,
    // Group size and attendance recorded on the claim (some payers cap group size)
    ...(group ? { group: { ...group.info, warnings: group.warnings } } : {}),
  };
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.claim.create({
      data: {
        organizationId: actor.organizationId,
        clientId: note.clientId,
        // The note's own linked appointment (cross-check only); never a nearby appointment
        appointmentId: note.appointmentId ?? null,
        progressNoteId: note.id,
        cptCode: fee.cptCode,
        units: 1,
        amountCents: fee.amountCents + (addOnFee?.amountCents ?? 0),
        payer: notePayer,
        status: nextStatus,
        submissionData,
        ...(noteDx ? { icd10Codes: noteDx.codes } : {}),
        ...(note.telehealth && note.placeOfService ? { placeOfService: note.placeOfService } : {}),
      },
    });
    if (addOnFee) {
      const pointers = noteDx?.linePointers ?? [1];
      const lineMeta: Record<string, { serviceDate: string | null; diagnosisPointers: number[] }> = {};
      for (const f of [fee, addOnFee]) {
        const [base, ...mods] = f.cptCode.split('-');
        const line = await tx.claimServiceLine.create({
          data: serviceLineData(created.id, { cptCode: base, modifiers: mods, units: 1, chargeCents: f.amountCents, serviceDate: dos, diagnosisPointers: pointers }),
        });
        lineMeta[line.id] = { serviceDate: dos ?? null, diagnosisPointers: pointers };
      }
      // Line pointers live in submissionData.lineMeta (read by the 837P builder and the claim editor)
      if (noteDx) {
        await tx.claim.update({
          where: { id: created.id },
          data: { submissionData: { ...submissionData, lineMeta } as Prisma.InputJsonValue },
        });
      }
    }
    return tx.claim.findUniqueOrThrow({ where: { id: created.id }, include: claimInclude });
  });
  return { ok: true as const, claim: serialize(row), alreadyExisted: false };
}

/**
 * Claim for a completed appointment: the signed note started from THIS appointment
 * (ProgressNote.appointmentId). Notes are never matched to an appointment by date.
 */
export async function generateClaimFromAppointment(actor: ClaimActor, appointmentId: string) {
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      client: clientOrgFilter(actor.organizationId),
    },
    select: { id: true, status: true },
  });
  if (!appointment) {
    return { ok: false as const, error: 'Appointment not found', status: 404 as const };
  }
  if (appointment.status !== 'COMPLETED') {
    return {
      ok: false as const,
      error: 'Appointment must be completed before generating a claim',
      status: 400 as const,
    };
  }

  const notes = await prisma.progressNote.findMany({
    where: { appointmentId: appointment.id, workflow: { status: { in: ['LOCKED', 'SIGNED'] } } },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
    take: 2,
  });
  if (!notes.length) {
    return {
      ok: false as const,
      error: 'No signed progress note is linked to this appointment. Start the note from the appointment (or link it) before billing.',
      status: 400 as const,
    };
  }
  if (notes.length > 1) {
    return {
      ok: false as const,
      error: 'More than one signed note is linked to this appointment; create the claim from the note instead.',
      status: 409 as const,
    };
  }
  return generateClaimFromNote(actor, notes[0].id);
}

const ALLOWED: Record<ClaimStatus, ClaimStatus[]> = {
  DRAFT: ['READY', 'DENIED'],
  READY: ['SUBMITTED', 'DRAFT', 'DENIED'],
  SUBMITTED: ['ACCEPTED', 'DENIED'],
  ACCEPTED: ['PAID', 'DENIED'],
  DENIED: ['DRAFT', 'READY', 'SUBMITTED'],
  PAID: [],
};

/**
 * Payer adjudicated (835 posted) and denied: sending the same claim again as an original
 * (frequency 1) is a duplicate to the payer. It goes back as a corrected claim (7) or an appeal.
 */
export function payerAdjudicatedDenial(claim: Pick<Claim, 'status' | 'eraProcessedAt' | 'submissionData' | 'frequencyCode'>): boolean {
  if (claim.status !== 'DENIED') return false;
  return Boolean(claim.eraProcessedAt || jsonObj(claim.submissionData).era);
}

/** Why a claim cannot be marked READY: co-signature pending (B2), PRP codes, payer-denied resend. */
export async function readyBlockers(claim: Claim, lineCpts?: string[]): Promise<string[]> {
  const out: string[] = [];
  if (payerAdjudicatedDenial(claim)) {
    out.push('The payer denied this claim on a remittance (835). Send it as a corrected claim (Send corrected claim) or appeal it; it cannot be resent as an original.');
  }
  const [note, lines] = await Promise.all([
    claim.progressNoteId
      ? prisma.progressNoteWorkflow.findUnique({ where: { noteId: claim.progressNoteId }, select: { cosignRequired: true, cosignedAt: true } })
      : Promise.resolve(null),
    lineCpts ? Promise.resolve(lineCpts.map((cptCode) => ({ cptCode }))) : prisma.claimServiceLine.findMany({ where: { claimId: claim.id }, select: { cptCode: true } }),
  ]);
  if (cosignPending(note)) out.push(COSIGN_PENDING_MESSAGE);
  const prp = prpClaimBlock([claim.cptCode, ...lines.map((l) => l.cptCode)], await prpBillingModelFor(claim.organizationId));
  if (prp) out.push(prp);
  return out;
}

export async function updateClaimStatus(
  actor: ClaimActor,
  id: string,
  status: ClaimStatus,
  denialReason?: string | null
) {
  const existing = await prisma.claim.findFirst({
    where: {
      id,
      organizationId: actor.organizationId,
      client: clientAccessWhere(actor),
    },
  });
  if (!existing) {
    return { ok: false as const, error: 'Claim not found', status: 404 as const };
  }

  if (status === 'SUBMITTED') return { ok: false as const, error: 'Use the clearinghouse submission action', status: 400 as const };
  if (existing.submissionInProgress) return { ok: false as const, error: 'Reconcile the pending clearinghouse submission before editing this claim', status: 409 as const };
  const allowed = ALLOWED[existing.status] || [];
  if (!allowed.includes(status)) {
    return {
      ok: false as const,
      error: `Cannot move claim from ${existing.status} to ${status}`,
      status: 400 as const,
    };
  }
  if (status === 'READY') {
    const problems = await readyBlockers(existing);
    if (problems.length) return { ok: false as const, error: problems.join(' '), status: 400 as const };
  }

  const row = await prisma.claim.update({
    where: { id: existing.id },
    data: {
      status,
      denialReason:
        status === 'DENIED'
          ? denialReason?.trim() || existing.denialReason || 'Denied'
          : existing.denialReason,
    },
    include: claimInclude,
  });

  if (status === 'DENIED') {
    await releasePriorAuthUsage({ organizationId: actor.organizationId, claimId: row.id, reason: 'claim denied', actorUserId: actor.actorUserId });
    try {
      const open = await prisma.claimDenial.findFirst({
        where: { claimId: row.id, status: 'OPEN' },
        select: { id: true },
      });
      if (!open) {
        await prisma.claimDenial.create({
          data: {
            organizationId: actor.organizationId,
            claimId: row.id,
            reasonCode: reasonCodeFromText(row.denialReason),
            reasonText: row.denialReason || 'Claim denied',
            status: 'OPEN',
          },
        });
      }
    } catch (err) {
      console.error('[claims] denial row skipped', err);
    }
  }

  return { ok: true as const, claim: serialize(row) };
}

// ─── Waystar claim control numbers (CLM01) ───────────────────────────────────

/** Payer mappings, or [] when the table is not migrated yet (claims keep working). */
async function loadPayerMappingsSafe(organizationId: string): Promise<PayerMappingConfig[]> {
  try {
    return await loadPayerMappings(organizationId);
  } catch (err) {
    console.warn('[claims] waystar payer mappings unavailable:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** New CLM01: 'AX' + 16 hex characters (18 chars, within the 20 payers keep). */
export function newClaimControlNumber() {
  return `AX${randomBytes(8).toString('hex').toUpperCase()}`;
}

/**
 * Claim for a CLM01 echoed back by Waystar (277CA TRN*2 / 835 CLP01).
 * Matches, in order: the claim's current control number, any earlier control
 * number it was sent under (claim_control_numbers, e.g. before a corrected
 * claim), and finally Claim.id (claims sent before control numbers existed used
 * the claim id as CLM01). Pass organizationId to keep the lookup tenant-scoped.
 *
 * Used by the Waystar inbound (999 / 277CA / 835) processing.
 */
export async function claimByControlNumber(ctrl: string, opts: { organizationId?: string } = {}): Promise<Claim | null> {
  const value = (ctrl || '').trim();
  if (!value) return null;
  const org = opts.organizationId ? { organizationId: opts.organizationId } : {};
  const upper = value.toUpperCase();
  if (CONTROL_NUMBER_RE.test(upper)) {
    const current = await prisma.claim.findFirst({ where: { claimControlNumber: upper, ...org } });
    if (current) return current;
    const earlier = await prisma.claimControlNumber.findUnique({ where: { controlNumber: upper }, select: { claimId: true } });
    if (earlier) {
      const claim = await prisma.claim.findFirst({ where: { id: earlier.claimId, ...org } });
      if (claim) return claim;
    }
  }
  return prisma.claim.findFirst({ where: { id: value, ...org } });
}

/** Records a control number in the claim's CLM01 history (idempotent). */
async function rememberControlNumber(tx: Prisma.TransactionClient, claimId: string, controlNumber: string | null, frequencyCode: string) {
  if (!controlNumber) return;
  await tx.claimControlNumber.upsert({
    where: { controlNumber },
    update: {},
    create: { controlNumber, claimId, frequencyCode },
  });
}

/** Ensures each claim has a CLM01 and that it is in the history table. Returns id -> control number. */
export async function ensureClaimControlNumbers(claimIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rows = await prisma.claim.findMany({ where: { id: { in: claimIds } }, select: { id: true, claimControlNumber: true, frequencyCode: true } });
  for (const row of rows) {
    let ctrl = row.claimControlNumber;
    for (let attempt = 0; !ctrl && attempt < 3; attempt++) {
      const candidate = newClaimControlNumber();
      try {
        await prisma.claim.updateMany({ where: { id: row.id, claimControlNumber: null }, data: { claimControlNumber: candidate } });
        ctrl = (await prisma.claim.findUnique({ where: { id: row.id }, select: { claimControlNumber: true } }))?.claimControlNumber ?? null;
      } catch {
        // unique collision: try another number
      }
    }
    if (!ctrl) continue;
    const value = ctrl;
    await prisma.$transaction((tx) => rememberControlNumber(tx, row.id, value, row.frequencyCode));
    out.set(row.id, value);
  }
  return out;
}

function jsonObj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function claimRowInclude() {
  return claimInclude;
}

async function loadScopedClaim(actor: ClaimActor, id: string) {
  return prisma.claim.findFirst({
    where: { id, organizationId: actor.organizationId, client: clientAccessWhere(actor) },
    include: { serviceLines: true },
  });
}

type Fail = { ok: false; error: string; status: 400 | 403 | 404 | 409 };
const fail = (error: string, status: Fail['status']): Fail => ({ ok: false, error, status });

// ─── Corrected (7) / void (8) claims ─────────────────────────────────────────

const SENT_STATUSES: ClaimStatus[] = ['SUBMITTED', 'ACCEPTED', 'DENIED', 'PAID'];

/** Payer claim control number stored for a claim (column, then what inbound processing left in submissionData). */
export function storedPayerClaimControlNumber(claim: Pick<Claim, 'payerClaimControlNumber' | 'submissionData'>): string | null {
  if (claim.payerClaimControlNumber) return claim.payerClaimControlNumber;
  const sd = jsonObj(claim.submissionData);
  const era = jsonObj(sd.era);
  const sftp = jsonObj(sd.waystarSftp);
  for (const v of [era.payerClaimControlNumber, sftp.payerClaimControlNumber, sftp.payerClaimNumber]) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export const claimCorrectionSchema = z.object({
  kind: z.enum(['replace', 'void']),
  payerClaimControlNumber: z.string().trim().max(50).regex(/^[A-Za-z0-9-]*$/, 'Letters, digits and dashes only').optional().nullable(),
});

/**
 * "Send corrected claim" / "Void claim": puts a sent claim back to READY as a
 * replacement (CLM05-3 = 7) or void (8) with REF*F8 = the payer's claim control
 * number, under a NEW CLM01 (the old one stays in claim_control_numbers so late
 * 277CA / 835 files still match). The claim is then sent like any READY claim.
 */
export async function startClaimCorrection(actor: ClaimActor, id: string, input: unknown) {
  if (!canMutateClaims(actor.actorRole)) return fail('Forbidden', 403);
  const data = claimCorrectionSchema.parse(input);
  const claim = await loadScopedClaim(actor, id);
  if (!claim) return fail('Claim not found', 404);
  if (claim.submissionInProgress) return fail('A submission is pending for this claim; reconcile it first', 409);
  if (!SENT_STATUSES.includes(claim.status) || !claim.submittedAt) {
    return fail('Only claims already sent to the payer can be corrected or voided', 409);
  }
  const pcn = data.payerClaimControlNumber?.trim() || storedPayerClaimControlNumber(claim);
  if (!pcn) {
    return fail("Enter the payer's claim control number (ICN/DCN from the 277CA or remittance) for REF*F8", 400);
  }
  const frequencyCode = data.kind === 'replace' ? '7' : '8';
  const sd = jsonObj(claim.submissionData);
  const history = Array.isArray(sd.waystarSftpHistory) ? [...(sd.waystarSftpHistory as unknown[])] : [];
  if (sd.waystarSftp) history.push(sd.waystarSftp);
  delete sd.waystarSftp;
  sd.waystarSftpHistory = history.slice(-10);
  sd.correction = {
    kind: data.kind,
    at: new Date().toISOString(),
    by: actor.actorUserId,
    previousStatus: claim.status,
    previousFrequencyCode: claim.frequencyCode,
    previousControlNumber: claim.claimControlNumber,
  };
  const newCtrl = newClaimControlNumber();
  const row = await prisma
    .$transaction(async (tx) => {
      await rememberControlNumber(tx, claim.id, claim.claimControlNumber, claim.frequencyCode);
      const guard = await tx.claim.updateMany({
        where: { id: claim.id, organizationId: actor.organizationId, status: claim.status, submissionInProgress: false },
        data: {
          status: 'READY',
          frequencyCode,
          payerClaimControlNumber: pcn,
          claimControlNumber: newCtrl,
          submissionError: null,
          submissionKey: null,
          submissionData: sd as Prisma.InputJsonValue,
        },
      });
      if (!guard.count) throw new Error('CLAIM_CHANGED');
      await rememberControlNumber(tx, claim.id, newCtrl, frequencyCode);
      return tx.claim.findUniqueOrThrow({ where: { id: claim.id }, include: claimRowInclude() });
    })
    .catch((err) => {
      if (err instanceof Error && err.message === 'CLAIM_CHANGED') return null;
      throw err;
    });
  if (!row) return fail('Claim changed while preparing the correction; reload and retry', 409);
  await writeAuditLog({
    action: data.kind === 'replace' ? 'claim_correction_started' : 'claim_void_started',
    actorUserId: actor.actorUserId,
    organizationId: actor.organizationId,
    resourceType: 'Claim',
    resourceId: claim.id,
    patientId: claim.clientId,
    metadata: { frequencyCode, previousStatus: claim.status, controlNumber: newCtrl, previousControlNumber: claim.claimControlNumber },
  });
  return { ok: true as const, claim: serialize(row, await loadPayerMappingsSafe(actor.organizationId)) };
}

/** Undoes startClaimCorrection before the corrected / void claim was sent. */
export async function cancelClaimCorrection(actor: ClaimActor, id: string) {
  if (!canMutateClaims(actor.actorRole)) return fail('Forbidden', 403);
  const claim = await loadScopedClaim(actor, id);
  if (!claim) return fail('Claim not found', 404);
  const sd = jsonObj(claim.submissionData);
  const correction = jsonObj(sd.correction);
  if (claim.status !== 'READY' || claim.submissionInProgress || !correction.previousStatus) {
    return fail('There is no unsent correction or void to cancel on this claim', 409);
  }
  const history = Array.isArray(sd.waystarSftpHistory) ? [...(sd.waystarSftpHistory as unknown[])] : [];
  const last = history.pop();
  if (last) sd.waystarSftp = last;
  sd.waystarSftpHistory = history;
  delete sd.correction;
  const prevCtrl = typeof correction.previousControlNumber === 'string' ? correction.previousControlNumber : null;
  const row = await prisma.claim.update({
    where: { id: claim.id },
    data: {
      status: correction.previousStatus as ClaimStatus,
      frequencyCode: typeof correction.previousFrequencyCode === 'string' ? correction.previousFrequencyCode : '1',
      ...(prevCtrl ? { claimControlNumber: prevCtrl } : {}),
      submissionData: sd as Prisma.InputJsonValue,
    },
    include: claimRowInclude(),
  });
  await writeAuditLog({
    action: 'claim_correction_cancelled',
    actorUserId: actor.actorUserId,
    organizationId: actor.organizationId,
    resourceType: 'Claim',
    resourceId: claim.id,
    patientId: claim.clientId,
    metadata: { restoredStatus: row.status },
  });
  return { ok: true as const, claim: serialize(row, await loadPayerMappingsSafe(actor.organizationId)) };
}

// ─── Secondary / tertiary claims (COB) ───────────────────────────────────────

const NEXT_RANK: Record<string, 'S' | 'T' | undefined> = { P: 'S', S: 'T' };

/**
 * Creates the claim to the next payer (secondary after primary, tertiary after
 * secondary) once the previous payer adjudicated it. Lines, diagnoses, POS and
 * providers are copied; the payer, member and payer ID come from the client's
 * coverage + payer mapping. COB amounts come from the previous claim's 835
 * (submissionData.era) at send time, or from staff entry (saveClaimCob).
 */
export async function createSecondaryClaim(actor: ClaimActor, primaryId: string) {
  if (!canMutateClaims(actor.actorRole)) return fail('Forbidden', 403);
  const primary = await loadScopedClaim(actor, primaryId);
  if (!primary) return fail('Claim not found', 404);
  if (!['ACCEPTED', 'PAID', 'DENIED'].includes(primary.status)) {
    return fail('The previous payer has to adjudicate this claim first (accepted, paid or denied)', 409);
  }
  const rank = NEXT_RANK[primary.payerResponsibility];
  if (!rank) return fail('There is no payer after tertiary', 409);
  // The 835 showed a Medicare -> Medicaid crossover: the payer already forwarded the claim
  const crossover = jsonObj(jsonObj(primary.submissionData).crossover);
  if (crossover.detected) {
    return fail(`The payer forwarded this claim to the next payer automatically (crossover: ${String(crossover.reason || 'detected on the 835')}). Do not file a manual secondary claim; wait for that payer's remittance.`, 409);
  }
  const existing = await prisma.claim.findFirst({ where: { primaryClaimId: primary.id, organizationId: actor.organizationId }, select: { id: true } });
  if (existing) return fail(`A ${rank === 'S' ? 'secondary' : 'tertiary'} claim already exists (${existing.id})`, 409);
  const coverage = await prisma.clientInsuranceCoverage.findFirst({ where: { clientId: primary.clientId, organizationId: actor.organizationId, rank, active: true } });
  if (!coverage?.payerName || !coverage.memberId) {
    return fail(`Add the client's ${rank === 'S' ? 'secondary' : 'tertiary'} insurance (payer and member ID) first`, 400);
  }
  const mapped = findPayerMapping(await loadPayerMappingsSafe(actor.organizationId), coverage.payerName);
  const psd = jsonObj(primary.submissionData);
  const keep = ['diagnosisCodes', 'placeOfService', 'modifiers', 'serviceDate', 'clinicianLabel', 'department', 'telehealth'];
  const sd: Record<string, unknown> = Object.fromEntries(keep.filter((k) => psd[k] !== undefined).map((k) => [k, psd[k]]));
  sd.payerId = mapped?.waystarPayerId ?? '';
  sd.claimFilingCode = coverage.claimFilingCode || mapped?.claimFilingCode || '';
  sd.source = 'secondary_from_claim';
  const oldMeta = jsonObj(psd.lineMeta);
  const lines = [...primary.serviceLines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.claim.create({
      data: {
        organizationId: actor.organizationId,
        clientId: primary.clientId,
        appointmentId: primary.appointmentId,
        progressNoteId: null,
        cptCode: primary.cptCode,
        units: primary.units,
        amountCents: primary.amountCents,
        payer: coverage.payerName,
        status: 'DRAFT',
        icd10Codes: primary.icd10Codes,
        placeOfService: primary.placeOfService,
        renderingNpi: primary.renderingNpi,
        billingNpi: primary.billingNpi,
        payerResponsibility: rank,
        primaryClaimId: primary.id,
        submissionData: sd as Prisma.InputJsonValue,
      },
    });
    const lineMeta: Record<string, unknown> = {};
    // Created in the primary's line order; cuid ids sort in creation order, so LX numbering matches
    for (const l of lines) {
      const sl = await tx.claimServiceLine.create({
        data: { claimId: created.id, cptCode: l.cptCode, modifier: l.modifier, units: l.units, unitCharge: l.unitCharge, totalCharge: l.totalCharge },
      });
      if (oldMeta[l.id]) lineMeta[sl.id] = oldMeta[l.id];
    }
    return tx.claim.update({
      where: { id: created.id },
      data: { submissionData: { ...sd, lineMeta } as Prisma.InputJsonValue },
      include: claimRowInclude(),
    });
  });
  await writeAuditLog({
    action: 'claim_secondary_created',
    actorUserId: actor.actorUserId,
    organizationId: actor.organizationId,
    resourceType: 'Claim',
    resourceId: row.id,
    patientId: primary.clientId,
    metadata: { primaryClaimId: primary.id, payerResponsibility: rank, payerMapped: Boolean(mapped) },
  });
  return { ok: true as const, claim: serialize(row, await loadPayerMappingsSafe(actor.organizationId)) };
}

const casSchema = z.object({
  group: z.enum(['CO', 'CR', 'OA', 'PI', 'PR']),
  reason: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,5}$/, 'Reason is a CARC code (e.g. 45)'),
  amount: z.number().finite(),
});

export const claimCobSchema = z.object({
  /** Rank of the payer that adjudicated (P when this claim is the secondary) */
  rank: z.enum(['P', 'S']),
  paidAmount: z.number().finite().min(0),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adjustments: z.array(casSchema).max(30).default([]),
  lines: z
    .array(
      z.object({
        lineNumber: z.number().int().min(1).max(50),
        paidAmount: z.number().finite().min(0),
        adjustments: z.array(casSchema).max(30).default([]),
        paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
    )
    .max(50)
    .optional(),
  /** Waystar payer ID of that payer, when its mapping is missing */
  payerId: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,15}$/).optional().nullable(),
});

/** Staff entry of the previous payer's adjudication (2320 / 2430) for a secondary or tertiary claim. */
export async function saveClaimCob(actor: ClaimActor, id: string, input: unknown) {
  if (!canMutateClaims(actor.actorRole)) return fail('Forbidden', 403);
  const data = claimCobSchema.parse(input);
  const claim = await loadScopedClaim(actor, id);
  if (!claim) return fail('Claim not found', 404);
  if (claim.payerResponsibility === 'P') return fail('COB applies to secondary and tertiary claims only', 400);
  if (data.rank === 'S' && claim.payerResponsibility !== 'T') return fail('Only a tertiary claim carries the secondary payer adjudication', 400);
  if (!['DRAFT', 'READY', 'DENIED'].includes(claim.status) || claim.submissionInProgress) return fail('Submitted claims cannot be edited', 409);
  const lineCharges = [...claim.serviceLines]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((l) => l.totalCharge);
  const charges = lineCharges.length ? lineCharges : [(claim.amountCents ?? 0) / 100];
  const problems = cobProblems({ source: 'staff', ...data, lines: data.lines?.length ? data.lines : undefined }, charges, 'COB');
  if (problems.length) return fail(problems.join('; '), 400);
  const sd = jsonObj(claim.submissionData);
  sd.cob = { ...jsonObj(sd.cob), [data.rank]: { ...data, enteredBy: actor.actorUserId, enteredAt: new Date().toISOString() } };
  const row = await prisma.claim.update({ where: { id: claim.id }, data: { submissionData: sd as Prisma.InputJsonValue }, include: claimRowInclude() });
  await writeAuditLog({
    action: 'claim_cob_saved',
    actorUserId: actor.actorUserId,
    organizationId: actor.organizationId,
    resourceType: 'Claim',
    resourceId: claim.id,
    patientId: claim.clientId,
    metadata: { rank: data.rank, adjustmentCount: data.adjustments.length, lineLevel: Boolean(data.lines?.length) },
  });
  return { ok: true as const, claim: serialize(row, await loadPayerMappingsSafe(actor.organizationId)) };
}

/**
 * The previous payer's adjudication of a claim from its posted 835 payment(s)
 * (era_claim_payments, written by Waystar inbound). Null when nothing is posted
 * or the ERA tables are not migrated.
 */
export async function previousPayerAdjudication(
  previousClaimId: string,
  lineCpts: string[],
  payer: { payerId?: string | null; claimFilingCode?: string | null } = {}
): Promise<CobAdjudication | null> {
  try {
    const rows = await prisma.eraClaimPayment.findMany({
      where: { claimId: previousClaimId, postingStatus: 'posted' },
      include: { remittance: { select: { paymentDate: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return eraAdjudicationFromPayments(
      rows.map((r) => ({
        paidAmount: Number(r.paidAmount),
        paidDate: (r.remittance.paymentDate ?? r.postedAt)?.toISOString().slice(0, 10) ?? null,
        claimAdjustments: r.claimAdjustments,
        serviceLines: r.serviceLines,
      })),
      lineCpts,
      payer
    );
  } catch (err) {
    console.warn('[claims] ERA lookup unavailable:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** What the claim's COB will use: the previous claim's 835 when stored, else the staff entry. */
export async function claimCobSource(actor: ClaimActor, id: string) {
  if (!canAccessClaims(actor.actorRole)) return fail('Forbidden', 403);
  const claim = await loadScopedClaim(actor, id);
  if (!claim) return fail('Claim not found', 404);
  if (claim.payerResponsibility === 'P' || !claim.primaryClaimId) return { ok: true as const, required: false as const, clientId: claim.clientId };
  const previous = await prisma.claim.findFirst({
    where: { id: claim.primaryClaimId, organizationId: actor.organizationId },
    select: { id: true, status: true, submissionData: true, payer: true },
  });
  const lineCpts = [...claim.serviceLines]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((l) => l.cptCode.split('-')[0]);
  const era = previous ? await previousPayerAdjudication(previous.id, lineCpts.length ? lineCpts : [claim.cptCode.split('-')[0]]) : null;
  const staff = jsonObj(jsonObj(claim.submissionData).cob);
  return {
    ok: true as const,
    required: true as const,
    clientId: claim.clientId,
    previousClaimId: previous?.id ?? null,
    previousPayer: previous?.payer ?? null,
    previousStatus: previous?.status ?? null,
    era,
    staff: Object.keys(staff).length ? staff : null,
  };
}

// ─── Client insurance coverages (subscriber / secondary policies) ────────────

export const coverageInputSchema = z
  .object({
    rank: z.enum(['P', 'S', 'T']),
    payerName: z.string().trim().max(200).optional().nullable(),
    memberId: z.string().trim().max(80).regex(/^[A-Za-z0-9-]*$/, 'Member ID: letters, digits and dashes only').optional().nullable(),
    groupNumber: z.string().trim().max(50).optional().nullable(),
    claimFilingCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => !v || FILING_CODES.has(v), 'Not a valid claim filing indicator')
      .optional()
      .nullable(),
    subscriberRelationship: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => Boolean(RELATIONSHIP_CODES[v]), 'Not an X12 relationship code')
      .default('18'),
    subscriberFirstName: z.string().trim().max(35).optional().nullable(),
    subscriberLastName: z.string().trim().max(60).optional().nullable(),
    subscriberMiddleInitial: z.string().trim().max(1).optional().nullable(),
    subscriberDob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')),
    subscriberGender: z.enum(['M', 'F', 'U']).optional().nullable().or(z.literal('')),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.subscriberRelationship !== '18' && (!v.subscriberFirstName || !v.subscriberLastName)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Policyholder first and last name are required when the patient is not the subscriber' });
    }
    if (v.rank !== 'P' && v.active && (!v.payerName || !v.memberId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Secondary / tertiary insurance needs the payer and member ID' });
    }
  });

async function scopedClient(actor: ClaimActor, clientId: string) {
  return prisma.client.findFirst({
    where: { AND: [{ id: clientId }, clientOrgFilter(actor.organizationId), clientAccessWhere(actor)] },
    select: { id: true, insurancePayer: true, insuranceMemberId: true, insuranceGroupNumber: true, insuranceType: true },
  });
}

export async function listClientCoverages(actor: ClaimActor, clientId: string) {
  if (!canAccessClaims(actor.actorRole)) return fail('Forbidden', 403);
  const client = await scopedClient(actor, clientId);
  if (!client) return fail('Patient not found', 404);
  const rows = await prisma.clientInsuranceCoverage.findMany({ where: { clientId, organizationId: actor.organizationId }, orderBy: { rank: 'asc' } });
  return {
    ok: true as const,
    primaryOnClient: {
      payerName: client.insurancePayer,
      memberId: client.insuranceMemberId,
      groupNumber: client.insuranceGroupNumber,
      insuranceType: client.insuranceType,
    },
    coverages: rows.map((r) => ({
      rank: r.rank,
      payerName: r.payerName,
      memberId: r.memberId,
      groupNumber: r.groupNumber,
      claimFilingCode: r.claimFilingCode,
      subscriberRelationship: r.subscriberRelationship,
      subscriberFirstName: r.subscriberFirstName,
      subscriberLastName: r.subscriberLastName,
      subscriberMiddleInitial: r.subscriberMiddleInitial,
      subscriberDob: r.subscriberDob ? r.subscriberDob.toISOString().slice(0, 10) : null,
      subscriberGender: r.subscriberGender,
      active: r.active,
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

/** Upserts the client's coverage of one rank. Rank P may carry only the subscriber; payer/member stay on Client. */
export async function saveClientCoverage(actor: ClaimActor, clientId: string, input: unknown) {
  if (!canMutateClaims(actor.actorRole)) return fail('Forbidden', 403);
  const data = coverageInputSchema.parse(input);
  const client = await scopedClient(actor, clientId);
  if (!client) return fail('Patient not found', 404);
  const self = data.subscriberRelationship === '18';
  const values = {
    payerName: data.payerName || null,
    memberId: data.memberId || null,
    groupNumber: data.groupNumber || null,
    claimFilingCode: data.claimFilingCode || null,
    subscriberRelationship: data.subscriberRelationship,
    subscriberFirstName: self ? null : data.subscriberFirstName || null,
    subscriberLastName: self ? null : data.subscriberLastName || null,
    subscriberMiddleInitial: self ? null : data.subscriberMiddleInitial?.toUpperCase() || null,
    subscriberDob: !self && data.subscriberDob ? new Date(`${data.subscriberDob}T00:00:00.000Z`) : null,
    subscriberGender: !self && data.subscriberGender ? data.subscriberGender : null,
    active: data.active,
    updatedBy: actor.actorUserId,
  };
  await prisma.clientInsuranceCoverage.upsert({
    where: { clientId_rank: { clientId, rank: data.rank } },
    update: values,
    create: { organizationId: actor.organizationId, clientId, rank: data.rank, ...values },
  });
  await writeAuditLog({
    action: 'client_insurance_coverage_saved',
    actorUserId: actor.actorUserId,
    organizationId: actor.organizationId,
    resourceType: 'Client',
    resourceId: clientId,
    patientId: clientId,
    metadata: { rank: data.rank, relationship: data.subscriberRelationship, active: data.active },
  });
  return listClientCoverages(actor, clientId);
}
