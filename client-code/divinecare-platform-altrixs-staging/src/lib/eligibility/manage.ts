import type { EligibilityCheckStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { checkLiveEligibility } from '@/lib/integrations/availity/provider';
import { AvailityAuthError } from '@/lib/integrations/availity/auth';
import { AvailityEligibilityError } from '@/lib/integrations/availity/errors';
import type { EligibilityBenefits } from '@/lib/integrations/availity/types';
import {
  WAYSTAR_ELIGIBILITY_CHANNEL,
  WAYSTAR_REALTIME_NOTE,
  eligibilityChannels,
  requestWaystarEligibility,
  type EligibilityChannel,
} from './waystar';
import type { EligibilityServiceType } from '@/lib/billing/waystarInbound/codes';

const ELIGIBILITY_ROLES: Role[] = [
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'BILLING',
  'FRONT_DESK',
  'OFFICE_MANAGER',
  'NP',
  'THERAPIST',
  'PSYCHIATRIST',
  'CLINICIAN',
];

export function canAccessEligibility(role: Role | undefined | null) {
  return Boolean(role && ELIGIBILITY_ROLES.includes(role));
}

export type EligibilityListItem = {
  id: string;
  clientId: string;
  clientName: string;
  payerName: string;
  memberId: string | null;
  dos: string;
  status: EligibilityCheckStatus;
  checkedAt: string;
  benefits: EligibilityBenefits;
  /** Which clearinghouse answered (null for older rows) */
  channel: EligibilityChannel | null;
  /** Waystar batch: 270 sent, 271 not received yet */
  awaitingResponse: boolean;
  statusText: string | null;
  error: string | null;
  details: null | {
    sentAt: string | null;
    batchId: string | null;
    coinsurancePercent: number | null;
    planBegin: string | null;
    planEnd: string | null;
    planName: string | null;
    priorAuthRequired: boolean;
    benefitSource: string | null;
    rejections: string[];
    notes: string[];
  };
};

const emptyBenefits: EligibilityBenefits = {
  deductible: 0,
  deductibleMet: 0,
  copay: 0,
  oopMax: 0,
  oopMet: 0,
  coveredServices: [],
};

function parseBenefits(raw: Prisma.JsonValue | null | undefined): EligibilityBenefits {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyBenefits;
  const obj = raw as Record<string, unknown>;
  const benefits =
    obj.benefits && typeof obj.benefits === 'object' && !Array.isArray(obj.benefits)
      ? (obj.benefits as Record<string, unknown>)
      : obj;
  const services = Array.isArray(benefits.coveredServices)
    ? benefits.coveredServices.filter((s): s is string => typeof s === 'string')
    : [];
  return {
    deductible: typeof benefits.deductible === 'number' ? benefits.deductible : 0,
    deductibleMet: typeof benefits.deductibleMet === 'number' ? benefits.deductibleMet : 0,
    copay: typeof benefits.copay === 'number' ? benefits.copay : 0,
    oopMax: typeof benefits.oopMax === 'number' ? benefits.oopMax : 0,
    oopMet: typeof benefits.oopMet === 'number' ? benefits.oopMet : 0,
    coveredServices: services,
  };
}

function jsonObj(raw: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function serialize(row: {
  id: string;
  clientId: string;
  payerName: string;
  memberId: string | null;
  dos: Date;
  status: EligibilityCheckStatus;
  checkedAt: Date;
  rawRequest?: Prisma.JsonValue | null;
  rawResponse: Prisma.JsonValue | null;
  client: { name: string };
}): EligibilityListItem {
  const req = jsonObj(row.rawRequest);
  const res = jsonObj(row.rawResponse);
  const isWaystar = req.channel === WAYSTAR_ELIGIBILITY_CHANNEL || res.channel === WAYSTAR_ELIGIBILITY_CHANNEL;
  const w = jsonObj(res.waystar as Prisma.JsonValue);
  const awaiting = isWaystar && row.status === 'PENDING' && Boolean(req.batchId);
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    payerName: row.payerName,
    memberId: row.memberId,
    dos: row.dos.toISOString().slice(0, 10),
    status: row.status,
    checkedAt: row.checkedAt.toISOString().slice(0, 10),
    benefits: parseBenefits(row.rawResponse),
    channel: isWaystar ? 'waystar' : row.rawRequest || row.rawResponse ? 'availity' : null,
    awaitingResponse: awaiting,
    statusText: awaiting ? 'Sent to Waystar — awaiting 271' : strOrNull(w.statusText),
    error: strOrNull(res.error),
    details: isWaystar
      ? {
          sentAt: strOrNull(req.sentAt),
          batchId: strOrNull(req.batchId),
          coinsurancePercent: typeof w.coinsurancePercent === 'number' ? w.coinsurancePercent : null,
          planBegin: strOrNull(w.planBegin),
          planEnd: strOrNull(w.planEnd),
          planName: strOrNull(w.planName),
          priorAuthRequired: w.priorAuthRequired === true,
          benefitSource: strOrNull(w.benefitSource),
          rejections: strList(w.rejections),
          notes: strList(w.notes),
        }
      : null,
  };
}

/**
 * Channel / awaiting-271 / prior-auth flag of a stored check (same reading as the eligibility list).
 * Used by the front desk huddle (src/lib/frontOffice); no benefit amounts.
 */
export function eligibilityResponseFacts(row: {
  status: EligibilityCheckStatus;
  rawRequest: Prisma.JsonValue | null;
  rawResponse: Prisma.JsonValue | null;
}): { channel: EligibilityChannel | null; awaitingResponse: boolean; priorAuthRequired: boolean } {
  const req = jsonObj(row.rawRequest);
  const res = jsonObj(row.rawResponse);
  const isWaystar = req.channel === WAYSTAR_ELIGIBILITY_CHANNEL || res.channel === WAYSTAR_ELIGIBILITY_CHANNEL;
  const w = jsonObj(res.waystar as Prisma.JsonValue);
  return {
    channel: isWaystar ? 'waystar' : row.rawRequest || row.rawResponse ? 'availity' : null,
    awaitingResponse: isWaystar && row.status === 'PENDING' && Boolean(req.batchId),
    priorAuthRequired: w.priorAuthRequired === true,
  };
}

export async function listEligibilityChecks(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}) {
  const rows = await prisma.eligibilityCheck.findMany({
    where: {
      organizationId: input.organizationId,
      client: clientAccessWhere(input),
    },
    include: { client: { select: { name: true } } },
    orderBy: { checkedAt: 'desc' },
    take: 100,
  });
  return rows.map(serialize);
}

/** Channels for the eligibility page: Waystar batch by default when live; Availity when configured. */
export function eligibilityChannelInfo() {
  const c = eligibilityChannels();
  return { ...c, waystarNote: c.waystar ? WAYSTAR_REALTIME_NOTE : null };
}

export async function runEligibilityCheck(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
  payerName?: string | null;
  memberId?: string | null;
  dos?: string | null;
  /** waystar (batch 270/271) or availity (real-time); defaults to Waystar when its SFTP channel is live */
  channel?: EligibilityChannel | null;
  payerId?: string | null;
  serviceTypes?: EligibilityServiceType[];
}) {
  const channels = eligibilityChannels();
  const channel = input.channel ?? channels.defaultChannel;
  if (input.channel && !channels.channels.includes(input.channel)) {
    return { ok: false as const, error: `${input.channel === 'waystar' ? 'Waystar' : 'Availity'} eligibility is not configured on this server`, status: 400 as const };
  }
  if (channel === 'waystar') {
    const sent = await requestWaystarEligibility(input, [
      { clientId: input.clientId, payerName: input.payerName, memberId: input.memberId, dos: input.dos, payerId: input.payerId, serviceTypes: input.serviceTypes },
    ]);
    const id = sent.checkIds[0];
    if (!id) {
      const f = sent.failed[0];
      return { ok: false as const, error: f?.errors.join('; ') || 'Client not found', status: (f?.errors[0] === 'Client not found' ? 404 : 400) as 404 | 400 };
    }
    const row = await prisma.eligibilityCheck.findUniqueOrThrow({ where: { id }, include: { client: { select: { name: true } } } });
    return { ok: true as const, check: serialize(row), mode: 'batch' as const, channel: 'waystar' as const, batch: sent.batch };
  }

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientAccessWhere(input) },
    select: {
      id: true,
      name: true,
      dateOfBirth: true,
      gender: true,
      state: true,
      insurancePayer: true,
      insuranceMemberId: true,
      insuranceGroupNumber: true,
    },
  });
  if (!client) {
    return { ok: false as const, error: 'Client not found', status: 404 as const };
  }

  const payerName = (input.payerName || client.insurancePayer || '').trim();
  if (!payerName) {
    return { ok: false as const, error: 'Payer is required', status: 400 as const };
  }

  const memberId = (input.memberId ?? client.insuranceMemberId)?.trim() || null;
  const dos = input.dos ? new Date(`${input.dos}T12:00:00`) : new Date();
  if (Number.isNaN(dos.getTime())) {
    return { ok: false as const, error: 'Invalid date of service', status: 400 as const };
  }

  const provider = await prisma.user.findFirst({
    where: { id: input.actorUserId, organizationId: input.organizationId },
    select: { npi: true, name: true },
  });

  const pending = await prisma.eligibilityCheck.create({
    data: {
      organizationId: input.organizationId,
      clientId: client.id,
      payerName,
      memberId,
      dos,
      status: 'PENDING',
      checkedById: input.actorUserId,
    },
  });

  try {
    const result = await checkLiveEligibility({
      payerName,
      insurancePayer: payerName,
      memberId,
      dateOfService: dos,
      clientName: client.name,
      insuranceGroupNumber: client.insuranceGroupNumber,
      dateOfBirth: client.dateOfBirth,
      gender: client.gender,
      state: client.state,
      providerNpi: provider?.npi ?? null,
      providerName: provider?.name ?? null,
    });
    const updated = await prisma.eligibilityCheck.update({
      where: { id: pending.id },
      data: {
        status: result.status,
        rawRequest: result.rawRequest as Prisma.InputJsonValue,
        rawResponse: { ...result.rawResponse, benefits: result.benefits } as Prisma.InputJsonValue,
        checkedAt: new Date(),
      },
      include: { client: { select: { name: true } } },
    });
    return { ok: true as const, check: serialize(updated), mode: result.mode, channel: 'availity' as const, batch: null };
  } catch (err) {
    const message =
      err instanceof AvailityEligibilityError || err instanceof AvailityAuthError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Eligibility check failed';
    const details =
      err instanceof AvailityEligibilityError && err.details?.length ? err.details : undefined;

    const updated = await prisma.eligibilityCheck.update({
      where: { id: pending.id },
      data: {
        status: 'ERROR',
        rawRequest: {
          transaction: 'coverages',
          payerName,
          memberIdPresent: Boolean(memberId),
          dateOfService: dos.toISOString().slice(0, 10),
        } as Prisma.InputJsonValue,
        rawResponse: {
          error: message,
          ...(details ? { details } : {}),
        } as Prisma.InputJsonValue,
        checkedAt: new Date(),
      },
      include: { client: { select: { name: true } } },
    });
    return { ok: true as const, check: serialize(updated), mode: 'live' as const, channel: 'availity' as const, batch: null };
  }
}
