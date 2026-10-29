import type { EligibilityCheckStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { checkLiveEligibility } from '@/lib/integrations/availity/provider';
import { AvailityAuthError } from '@/lib/integrations/availity/auth';
import { AvailityEligibilityError } from '@/lib/integrations/availity/errors';
import type { EligibilityBenefits } from '@/lib/integrations/availity/types';

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

function serialize(row: {
  id: string;
  clientId: string;
  payerName: string;
  memberId: string | null;
  dos: Date;
  status: EligibilityCheckStatus;
  checkedAt: Date;
  rawResponse: Prisma.JsonValue | null;
  client: { name: string };
}): EligibilityListItem {
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

export async function runEligibilityCheck(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
  payerName?: string | null;
  memberId?: string | null;
  dos?: string | null;
}) {
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
    return { ok: true as const, check: serialize(updated), mode: result.mode };
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
    return { ok: true as const, check: serialize(updated), mode: 'live' as const };
  }
}
