import type { Claim, ClaimStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { reasonCodeFromText } from '@/features/billing/denialCategories';
import { extractNoteCpt } from '@/lib/billing/noteCoding';

export const CLAIM_STATUSES = [
  'DRAFT',
  'READY',
  'SUBMITTED',
  'ACCEPTED',
  'DENIED',
  'PAID',
] as const satisfies readonly ClaimStatus[];

const BILLING_CORE: Role[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'];

export function canAccessClaims(role: Role | undefined | null) {
  return Boolean(role && BILLING_CORE.includes(role));
}

export function canMutateClaims(role: Role | undefined | null) {
  return canAccessClaims(role);
}

const DRAFT_CLAIM_ROLES: Role[] = [
  'ADMIN',
  'DIRECTOR',
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
} as const;

export type ClaimListItem = {
  availityClaimId?: string | null;
  clearinghouseClaimId?: string | null;
  clearinghouseProvider?: string | null;
  submissionInProgress?: boolean;
  submissionError?: string | null;
  clearinghouseDemo?: boolean;
  submissionData?: { payerId: string; diagnosisCodes: string[]; placeOfService: string; claimFilingCode: 'MC' | 'MB' | 'BL' | 'CI' } | null;

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

import {
  baseCptCode,
  chargeAmountCents,
  cptByCode,
  cptDescription,
} from '@/lib/constants/cpt';

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
    appointment: { startsAt: Date; clinician: { name: string } | null } | null;
  }
): ClaimListItem {
  return {
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
    clinicianName: row.appointment?.clinician?.name ?? null,
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
    serviceDate: row.appointment?.startsAt.toISOString() ?? row.createdAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function amountForCpt(cpt: string, units = 1) {
  return chargeAmountCents(cpt, units);
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
  markReady?: boolean;
};

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
    select: { id: true, name: true, insurancePayer: true, insuranceMemberId: true },
  });
  if (!client) {
    return { ok: false as const, error: 'Patient not found', status: 404 as const };
  }

  const base = baseCptCode(input.cptCode);
  if (!cptByCode(base)) {
    return { ok: false as const, error: `Unknown CPT/HCPCS code: ${input.cptCode}`, status: 400 as const };
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

  const units = Math.max(1, Math.min(99, Number(input.units) || 1));
  const pos = (input.placeOfService || '11').trim() || '11';
  const mods = (input.modifiers || [])
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);

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

  const submissionData = {
    payerId: '',
    diagnosisCodes: dx,
    placeOfService: pos,
    claimFilingCode: 'CI' as const,
    modifiers: mods,
    memberId: input.memberId?.trim() || client.insuranceMemberId || null,
    serviceDate: input.serviceDate || null,
    clinicianLabel: input.clinicianLabel || null,
    source: 'manual_claim_modal',
  };

  const row = await prisma.claim.create({
    data: {
      organizationId: actor.organizationId,
      clientId: client.id,
      progressNoteId: null,
      cptCode: cptStored,
      units,
      amountCents: amountForCpt(base, units),
      payer: input.payer?.trim() || client.insurancePayer?.trim() || null,
      status: input.markReady ? 'READY' : 'DRAFT',
      submissionData,
    },
    include: claimInclude,
  });

  return { ok: true as const, claim: serialize(row) };
}

async function findCompletedAppointment(clientId: string, around: Date) {
  const dayStart = new Date(around);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const sameDay = await prisma.appointment.findFirst({
    where: {
      clientId,
      status: 'COMPLETED',
      startsAt: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { startsAt: 'desc' },
  });
  if (sameDay) return sameDay;

  const windowStart = new Date(around.getTime() - 2 * 86_400_000);
  const windowEnd = new Date(around.getTime() + 2 * 86_400_000);
  return prisma.appointment.findFirst({
    where: {
      clientId,
      status: 'COMPLETED',
      startsAt: { gte: windowStart, lte: windowEnd },
    },
    orderBy: { startsAt: 'desc' },
  });
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
    include: {
      client: { select: { name: true } },
      appointment: {
        select: {
          startsAt: true,
          clinician: { select: { name: true } },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
  return rows.map(serialize);
}

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
    include: {
      workflow: { select: { status: true } },
      client: { select: { id: true, name: true, insurancePayer: true } },
    },
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

  const existing = await prisma.claim.findUnique({
    where: { progressNoteId: note.id },
    include: claimInclude,
  });

  const appointment = await findCompletedAppointment(note.clientId, note.createdAt);
  const requestedCpt = opts?.cptCode?.trim().toUpperCase();
  const cptCode = requestedCpt || (existing ? existing.cptCode : extractNoteCpt(note.body, appointment?.type));
  const nextStatus =
    opts?.markReady && (!existing || existing.status === 'DRAFT') ? 'READY' : existing?.status ?? 'DRAFT';

  if (existing) {
    const shouldUpdate =
      (requestedCpt && requestedCpt !== existing.cptCode) ||
      (opts?.markReady && existing.status === 'DRAFT');
    if (shouldUpdate && (existing.status === 'DRAFT' || existing.status === 'READY')) {
      const row = await prisma.claim.update({
        where: { id: existing.id },
        data: {
          cptCode,
          amountCents: amountForCpt(baseCptCode(cptCode), existing.units || 1),
          status: nextStatus,
        },
        include: claimInclude,
      });
      return { ok: true as const, claim: serialize(row), alreadyExisted: true };
    }
    return { ok: true as const, claim: serialize(existing), alreadyExisted: true };
  }

  const row = await prisma.claim.create({
    data: {
      organizationId: actor.organizationId,
      clientId: note.clientId,
      appointmentId: appointment?.id ?? null,
      progressNoteId: note.id,
      cptCode,
      units: 1,
      amountCents: amountForCpt(baseCptCode(cptCode), 1),
      payer: note.client.insurancePayer?.trim() || null,
      status: nextStatus,
    },
    include: claimInclude,
  });
  return { ok: true as const, claim: serialize(row), alreadyExisted: false };
}

export async function generateClaimFromAppointment(actor: ClaimActor, appointmentId: string) {
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      client: clientOrgFilter(actor.organizationId),
    },
    include: {
      client: { select: { id: true, insurancePayer: true } },
    },
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

  const dayStart = new Date(appointment.startsAt);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 2);

  const lockedNote = await prisma.progressNote.findFirst({
    where: {
      clientId: appointment.clientId,
      workflow: { status: 'LOCKED' },
      createdAt: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!lockedNote) {
    return {
      ok: false as const,
      error: 'No locked progress note found for this completed visit',
      status: 400 as const,
    };
  }
  return generateClaimFromNote(actor, lockedNote.id);
}

const ALLOWED: Record<ClaimStatus, ClaimStatus[]> = {
  DRAFT: ['READY', 'DENIED'],
  READY: ['SUBMITTED', 'DRAFT', 'DENIED'],
  SUBMITTED: ['ACCEPTED', 'DENIED'],
  ACCEPTED: ['PAID', 'DENIED'],
  DENIED: ['DRAFT', 'READY', 'SUBMITTED'],
  PAID: [],
};

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

  const row = await prisma.claim.update({
    where: { id: existing.id },
    data: {
      status,
      denialReason:
        status === 'DENIED'
          ? denialReason?.trim() || existing.denialReason || 'Denied'
          : existing.denialReason,
    },
    include: {
      client: { select: { name: true } },
      appointment: {
        select: { startsAt: true, clinician: { select: { name: true } } },
      },
    },
  });

  if (status === 'DENIED') {
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
