import { randomUUID } from 'node:crypto';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientByIdWhere } from '@/lib/clients/orgScope';
import { recordPhiAudit } from '@/lib/audit/phiAudit';

const RECORD_ROLES: Role[] = ['OFFICE_MANAGER', 'BILLING', 'ADMIN', 'PRACTICE_DIRECTOR'];
const READ_ALL_ROLES: Role[] = ['ADMIN', 'PRACTICE_DIRECTOR'];
const CASELOAD_READ_ROLES: Role[] = [
  'THERAPIST',
  'CLINICIAN',
  'PSYCHIATRIST',
  'NP',
  'PRP_SPECIALIST',
  'CASE_MANAGER',
  'CRISIS_RESPONDER',
];

export type DisclosureRow = {
  id: string;
  clientId: string;
  clientName: string;
  recipient: string;
  purpose: string;
  disclosedAt: string;
  recordedBy: string;
  recordedRole: string;
};

function canRecord(role: Role) {
  return RECORD_ROLES.includes(role);
}

function canReadAll(role: Role) {
  return READ_ALL_ROLES.includes(role);
}

function canReadCaseload(role: Role) {
  return CASELOAD_READ_ROLES.includes(role);
}

export function canExportDisclosures(role: Role | null | undefined) {
  return role === 'ADMIN' || role === 'PRACTICE_DIRECTOR';
}

async function clientVisible(actor: { organizationId: string; userId: string; role: Role }, clientId: string) {
  const where = canReadCaseload(actor.role)
    ? { AND: [clientByIdWhere(clientId, actor.organizationId), clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role })] }
    : clientByIdWhere(clientId, actor.organizationId);
  return prisma.client.findFirst({ where, select: { id: true, name: true } });
}

async function deny(actor: { organizationId: string; userId: string; role: Role }, clientId: string | null, action: string) {
  await recordPhiAudit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    action,
    resourceType: 'disclosure',
    patientId: clientId,
    outcome: 'DENIED',
  });
}

export async function recordDisclosure(
  actor: { organizationId: string; userId: string; role: Role },
  input: { clientId: string; recipient: string; purpose: string; disclosedAt?: string | null }
) {
  if (!canRecord(actor.role)) {
    await deny(actor, input.clientId, 'disclosure.record');
    return { ok: false as const, status: 403 as const, error: 'Forbidden' };
  }
  const client = await clientVisible(actor, input.clientId);
  if (!client) {
    await deny(actor, input.clientId, 'disclosure.record');
    return { ok: false as const, status: 403 as const, error: 'Forbidden' };
  }
  const id = randomUUID();
  const disclosedAt = input.disclosedAt ? new Date(input.disclosedAt) : new Date();
  if (Number.isNaN(disclosedAt.getTime())) {
    return { ok: false as const, status: 400 as const, error: 'Invalid disclosure date' };
  }
  const row: DisclosureRow = {
    id,
    clientId: client.id,
    clientName: client.name,
    recipient: input.recipient.trim(),
    purpose: input.purpose.trim(),
    disclosedAt: disclosedAt.toISOString(),
    recordedBy: actor.userId,
    recordedRole: actor.role,
  };
  if (!row.recipient || !row.purpose) {
    return { ok: false as const, status: 400 as const, error: 'Recipient and purpose are required' };
  }
  await prisma.clinicModuleState.create({
    data: {
      organizationId: actor.organizationId,
      module: `disclosure:${id}`,
      data: row,
    },
  });
  await recordPhiAudit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'disclosure.record',
    resourceType: 'disclosure',
    resourceId: id,
    patientId: client.id,
    outcome: 'SUCCESS',
  });
  return { ok: true as const, disclosure: { id, disclosedAt: row.disclosedAt } };
}

export async function listDisclosures(
  actor: { organizationId: string; userId: string; role: Role },
  clientId: string
) {
  const allowed = canReadAll(actor.role) || canReadCaseload(actor.role);
  if (!allowed) {
    await deny(actor, clientId, 'disclosure.read');
    return { ok: false as const, status: 403 as const, error: 'Forbidden' };
  }
  const client = await clientVisible(actor, clientId);
  if (!client) {
    await deny(actor, clientId, 'disclosure.read');
    return { ok: false as const, status: 403 as const, error: 'Forbidden' };
  }
  const rows = await prisma.clinicModuleState.findMany({
    where: { organizationId: actor.organizationId, module: { startsWith: 'disclosure:' } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const disclosures = rows
    .map((row) => row.data as DisclosureRow)
    .filter((row) => row && row.clientId === clientId);
  return { ok: true as const, disclosures };
}

export async function exportDisclosureAccounting(actor: { organizationId: string; userId: string; role: Role }) {
  if (!canExportDisclosures(actor.role)) {
    await deny(actor, null, 'disclosure.export');
    return { ok: false as const, status: 403 as const, error: 'Forbidden' };
  }
  const rows = await prisma.clinicModuleState.findMany({
    where: { organizationId: actor.organizationId, module: { startsWith: 'disclosure:' } },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  });
  const disclosures = rows.map((row) => row.data as DisclosureRow).filter(Boolean);
  return { ok: true as const, disclosures };
}
