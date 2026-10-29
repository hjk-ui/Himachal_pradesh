import type { PriorAuth, PriorAuthStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';

export const PRIOR_AUTH_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'DENIED',
  'EXPIRED',
] as const satisfies readonly PriorAuthStatus[];

export const PRIOR_AUTH_READ_ROLES: Role[] = [
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'BILLING',
  'FRONT_DESK',
  'OFFICE_MANAGER',
  'THERAPIST',
  'NP',
  'PSYCHIATRIST',
  'CLINICIAN',
];

export const PRIOR_AUTH_WRITE_ROLES: Role[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING', 'OFFICE_MANAGER'];

export type PriorAuthListItem = {
  id: string;
  organizationId: string;
  clientId: string;
  clientName: string;
  payer: string;
  authNumber: string | null;
  cptCodes: string[];
  unitsApproved: number;
  unitsUsed: number;
  status: PriorAuthStatus;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  /** 'valant' when imported from Valant's authorization export, else null */
  source: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PriorAuthActor = {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
};

export function canAccessPriorAuths(role: Role | undefined | null) {
  return Boolean(role && PRIOR_AUTH_READ_ROLES.includes(role));
}

export function canWritePriorAuths(role: Role | undefined | null) {
  return Boolean(role && PRIOR_AUTH_WRITE_ROLES.includes(role));
}

function dateOnly(d: Date | null | undefined) {
  return d ? d.toISOString().slice(0, 10) : null;
}

function parseDate(value?: string | null) {
  if (value == null || value === '') return null;
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function serialize(
  row: PriorAuth & { client: { name: string } }
): PriorAuthListItem {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    clientName: row.client.name,
    payer: row.payer,
    authNumber: row.authNumber,
    cptCodes: row.cptCodes,
    unitsApproved: row.unitsApproved,
    unitsUsed: row.unitsUsed,
    status: row.status,
    startDate: dateOnly(row.startDate),
    endDate: dateOnly(row.endDate),
    notes: row.notes,
    source: row.vendor === 'valant' ? 'valant' : null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadScoped(actor: PriorAuthActor, id: string) {
  const row = await prisma.priorAuth.findFirst({
    where: {
      id,
      organizationId: actor.organizationId,
      client: clientAccessWhere(actor),
    },
    include: { client: { select: { name: true } } },
  });
  return row;
}

export async function listPriorAuths(actor: PriorAuthActor) {
  const rows = await prisma.priorAuth.findMany({
    where: {
      organizationId: actor.organizationId,
      client: clientAccessWhere(actor),
    },
    include: { client: { select: { name: true } } },
    // Open auths first (enum order puts APPROVED before DENIED / EXPIRED), soonest ending first.
    // Valant imports add ~1,000 auths, many expired, so expired ones must not crowd out active ones.
    orderBy: [{ status: 'asc' }, { endDate: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });
  return rows.map(serialize);
}

export async function createPriorAuth(
  actor: PriorAuthActor,
  input: {
    clientId: string;
    payer: string;
    authNumber?: string | null;
    cptCodes: string[];
    unitsApproved: number;
    unitsUsed?: number;
    status?: PriorAuthStatus;
    startDate?: string | null;
    endDate?: string | null;
    notes?: string | null;
  }
) {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientAccessWhere(actor) },
    select: { id: true },
  });
  if (!client) {
    return { ok: false as const, error: 'Client not found', status: 404 as const };
  }

  const unitsApproved = Math.trunc(input.unitsApproved);
  const unitsUsed = Math.trunc(input.unitsUsed ?? 0);
  if (unitsApproved < 0) {
    return { ok: false as const, error: 'unitsApproved cannot be negative', status: 400 as const };
  }
  if (unitsUsed < 0) {
    return { ok: false as const, error: 'unitsUsed cannot be negative', status: 400 as const };
  }
  if (unitsUsed > unitsApproved) {
    return {
      ok: false as const,
      error: 'Cannot set unitsUsed greater than unitsApproved',
      status: 400 as const,
    };
  }

  const startDate = parseDate(input.startDate);
  const endDate = parseDate(input.endDate);
  if (startDate === undefined || endDate === undefined) {
    return { ok: false as const, error: 'Invalid date', status: 400 as const };
  }

  const row = await prisma.priorAuth.create({
    data: {
      organizationId: actor.organizationId,
      clientId: client.id,
      payer: input.payer.trim(),
      authNumber: input.authNumber?.trim() || null,
      cptCodes: input.cptCodes.map((c) => c.trim()).filter(Boolean),
      unitsApproved,
      unitsUsed,
      status: input.status ?? 'DRAFT',
      startDate,
      endDate,
      notes: input.notes?.trim() || null,
      createdById: actor.actorUserId,
    },
    include: { client: { select: { name: true } } },
  });
  return { ok: true as const, auth: serialize(row) };
}

export async function updatePriorAuth(
  actor: PriorAuthActor,
  id: string,
  input: {
    payer?: string;
    authNumber?: string | null;
    cptCodes?: string[];
    unitsApproved?: number;
    unitsUsed?: number;
    useUnits?: number;
    status?: PriorAuthStatus;
    startDate?: string | null;
    endDate?: string | null;
    notes?: string | null;
  }
) {
  const existing = await loadScoped(actor, id);
  if (!existing) {
    return { ok: false as const, error: 'Prior auth not found', status: 404 as const };
  }

  const unitsApproved =
    input.unitsApproved != null ? Math.trunc(input.unitsApproved) : existing.unitsApproved;
  if (unitsApproved < 0) {
    return { ok: false as const, error: 'unitsApproved cannot be negative', status: 400 as const };
  }

  let unitsUsed = existing.unitsUsed;
  if (input.useUnits != null) {
    const delta = Math.trunc(input.useUnits);
    unitsUsed = existing.unitsUsed + delta;
  } else if (input.unitsUsed != null) {
    unitsUsed = Math.trunc(input.unitsUsed);
  }

  if (unitsUsed < 0) {
    return { ok: false as const, error: 'unitsUsed cannot be negative', status: 400 as const };
  }
  if (unitsUsed > unitsApproved) {
    return {
      ok: false as const,
      error: 'Cannot set unitsUsed greater than unitsApproved',
      status: 400 as const,
    };
  }

  const startDate =
    input.startDate === undefined ? existing.startDate : parseDate(input.startDate);
  const endDate = input.endDate === undefined ? existing.endDate : parseDate(input.endDate);
  if (startDate === undefined || endDate === undefined) {
    return { ok: false as const, error: 'Invalid date', status: 400 as const };
  }

  const row = await prisma.priorAuth.update({
    where: { id: existing.id },
    data: {
      payer: input.payer?.trim() ?? existing.payer,
      authNumber:
        input.authNumber === undefined ? existing.authNumber : input.authNumber?.trim() || null,
      cptCodes: input.cptCodes
        ? input.cptCodes.map((c) => c.trim()).filter(Boolean)
        : existing.cptCodes,
      unitsApproved,
      unitsUsed,
      status: input.status ?? existing.status,
      startDate,
      endDate,
      notes: input.notes === undefined ? existing.notes : input.notes?.trim() || null,
    },
    include: { client: { select: { name: true } } },
  });
  return { ok: true as const, auth: serialize(row) };
}
