import type { LabStandingOrder, LabVendor, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientByIdWhere } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { addInterval, nextDueAfterOrder, standingDueState, type StandingDueState, type StandingIntervalUnit } from './standing';
import type { LabActor } from './manage';

export type StandingTest = { key: string | null; name: string; icd10Codes: string[] };

export type StandingOrderDto = {
  id: string;
  clientId: string;
  clientName: string;
  tests: StandingTest[];
  icd10Codes: string[];
  intervalUnit: StandingIntervalUnit;
  intervalCount: number;
  startDate: string;
  endDate: string | null;
  nextDueAt: string;
  lastOrderedAt: string | null;
  lastOrderId: string | null;
  orderSetKey: string | null;
  lab: LabVendor;
  note: string | null;
  active: boolean;
  createdByName: string | null;
  dueState: StandingDueState;
};

function parseTests(raw: unknown): StandingTest[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
    .map((t) => ({
      key: typeof t.key === 'string' ? t.key : null,
      name: String(t.name ?? ''),
      icd10Codes: Array.isArray(t.icd10Codes) ? t.icd10Codes.map(String) : [],
    }))
    .filter((t) => t.name);
}

function serialize(row: LabStandingOrder & { client?: { name: string } | null }, now = new Date()): StandingOrderDto {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client?.name ?? '',
    tests: parseTests(row.tests),
    icd10Codes: row.icd10Codes,
    intervalUnit: row.intervalUnit as StandingIntervalUnit,
    intervalCount: row.intervalCount,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate ? row.endDate.toISOString() : null,
    nextDueAt: row.nextDueAt.toISOString(),
    lastOrderedAt: row.lastOrderedAt ? row.lastOrderedAt.toISOString() : null,
    lastOrderId: row.lastOrderId,
    orderSetKey: row.orderSetKey,
    lab: row.lab,
    note: row.note,
    active: row.active,
    createdByName: row.createdByName,
    dueState: standingDueState(row, now),
  };
}

/**
 * Standing orders in scope (org + caseload / care team). Uses Client relation-less lookup because
 * lab_standing_orders has no FK relation in Prisma: names are joined in a second query.
 */
export async function listStandingOrders(actor: LabActor, opts?: { clientId?: string; activeOnly?: boolean }) {
  try {
    const scopedClients = await prisma.client.findMany({
      where: { AND: [clientAccessWhere(actor), ...(opts?.clientId ? [{ id: opts.clientId }] : [])] },
      select: { id: true, name: true },
      take: opts?.clientId ? 1 : 5000,
    });
    if (!scopedClients.length) return [];
    const names = new Map(scopedClients.map((c) => [c.id, c.name]));
    const rows = await prisma.labStandingOrder.findMany({
      where: {
        organizationId: actor.organizationId,
        clientId: { in: [...names.keys()] },
        ...(opts?.activeOnly !== false ? { active: true } : {}),
      },
      orderBy: { nextDueAt: 'asc' },
      take: 500,
    });
    const locked = await lockedSensitiveClientIds({
      organizationId: actor.organizationId,
      userId: actor.actorUserId,
      role: actor.actorRole,
      clientIds: [...new Set(rows.map((r) => r.clientId))],
    });
    const now = new Date();
    return rows.filter((r) => !locked.has(r.clientId)).map((r) => serialize({ ...r, client: { name: names.get(r.clientId) ?? '' } }, now));
  } catch (err) {
    // Table missing before the 20261018_lab_catalog migration: no standing orders yet
    console.error('[labs/standing] unavailable', err);
    return [];
  }
}

export type CreateStandingInput = {
  clientId: string;
  tests: StandingTest[];
  intervalUnit: StandingIntervalUnit;
  intervalCount: number;
  startDate?: string | null;
  endDate?: string | null;
  /** First due date; defaults to one interval after the start (the start's order is placed now) */
  firstDueAt?: string | null;
  orderSetKey?: string | null;
  lab?: LabVendor;
  note?: string | null;
};

export async function createStandingOrder(actor: LabActor, input: CreateStandingInput, actorName: string | null) {
  const client = await prisma.client.findFirst({
    where: { AND: [clientByIdWhere(input.clientId, actor.organizationId), clientAccessWhere(actor)] },
    select: { id: true, name: true },
  });
  if (!client) return { ok: false as const, status: 404 as const, error: 'Client not found in your caseload' };
  const start = input.startDate ? new Date(input.startDate) : new Date();
  if (Number.isNaN(start.getTime())) return { ok: false as const, status: 400 as const, error: 'Invalid start date' };
  const end = input.endDate ? new Date(input.endDate) : null;
  if (end && (Number.isNaN(end.getTime()) || end.getTime() < start.getTime())) {
    return { ok: false as const, status: 400 as const, error: 'End date must be after the start date' };
  }
  const due = input.firstDueAt ? new Date(input.firstDueAt) : addInterval(start, input.intervalUnit, input.intervalCount);
  if (Number.isNaN(due.getTime())) return { ok: false as const, status: 400 as const, error: 'Invalid first due date' };
  const codes = [...new Set(input.tests.flatMap((t) => t.icd10Codes))];
  const row = await prisma.labStandingOrder.create({
    data: {
      organizationId: actor.organizationId,
      clientId: client.id,
      tests: input.tests as unknown as Prisma.InputJsonValue,
      icd10Codes: codes,
      intervalUnit: input.intervalUnit,
      intervalCount: Math.max(1, Math.floor(input.intervalCount)),
      startDate: start,
      endDate: end,
      nextDueAt: due,
      orderSetKey: input.orderSetKey ?? null,
      lab: input.lab ?? 'QUEST',
      note: input.note?.trim() || null,
      createdById: actor.actorUserId,
      createdByName: actorName,
    },
  });
  return { ok: true as const, standing: serialize({ ...row, client }) };
}

export async function updateStandingOrder(
  actor: LabActor,
  id: string,
  input: { active?: boolean; nextDueAt?: string | null; endDate?: string | null; note?: string | null }
) {
  const row = await prisma.labStandingOrder.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!row) return { ok: false as const, status: 404 as const, error: 'Standing order not found' };
  const client = await prisma.client.findFirst({ where: { AND: [{ id: row.clientId }, clientAccessWhere(actor)] }, select: { id: true, name: true } });
  if (!client) return { ok: false as const, status: 404 as const, error: 'Standing order not found' };
  const data: Prisma.LabStandingOrderUpdateInput = {};
  if (input.active !== undefined) data.active = input.active;
  if (input.note !== undefined) data.note = input.note?.trim() || null;
  if (input.nextDueAt) {
    const d = new Date(input.nextDueAt);
    if (Number.isNaN(d.getTime())) return { ok: false as const, status: 400 as const, error: 'Invalid next due date' };
    data.nextDueAt = d;
  }
  if (input.endDate !== undefined) {
    const d = input.endDate ? new Date(input.endDate) : null;
    if (d && Number.isNaN(d.getTime())) return { ok: false as const, status: 400 as const, error: 'Invalid end date' };
    data.endDate = d;
  }
  const updated = await prisma.labStandingOrder.update({ where: { id }, data });
  return { ok: true as const, standing: serialize({ ...updated, client }) };
}

/** After an order is placed from a standing order: record it and move the next due date */
export async function markStandingOrderPlaced(actor: LabActor, standingId: string, orderId: string, placedAt: Date) {
  const row = await prisma.labStandingOrder.findFirst({ where: { id: standingId, organizationId: actor.organizationId } });
  if (!row) return;
  const next = nextDueAfterOrder(placedAt, row.intervalUnit as StandingIntervalUnit, row.intervalCount);
  const ended = row.endDate ? next.getTime() > row.endDate.getTime() : false;
  await prisma.labStandingOrder.update({
    where: { id: row.id },
    data: { lastOrderedAt: placedAt, lastOrderId: orderId, nextDueAt: next, ...(ended ? { active: false } : {}) },
  });
}
