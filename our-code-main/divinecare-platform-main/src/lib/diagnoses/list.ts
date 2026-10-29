import { Prisma, type ClientDiagnosis, type Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { DIAGNOSIS_COPY } from './copy';
import {
  isCurrentStatus,
  CURRENT_DIAGNOSIS_STATUSES,
  type DiagnosisActor,
  type DiagnosisDto,
  type DiagnosisHistoryDto,
  type DiagnosisStatus,
} from './types';

export type DiagnosisResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

type Tx = Prisma.TransactionClient;

export type DiagnosisActorWithRole = DiagnosisActor & { role: Role };

const ICD10_CM = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;

/** "f411" → "F41.1"; returns null when the result is not a plausible ICD-10-CM code. */
export function normalizeIcdCode(raw: string | null | undefined): string | null {
  const compact = (raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!compact) return null;
  const dotted = compact.includes('.') || compact.length <= 3 ? compact : `${compact.slice(0, 3)}.${compact.slice(3)}`;
  return ICD10_CM.test(dotted) ? dotted : null;
}

export function toDiagnosisDto(row: ClientDiagnosis): DiagnosisDto {
  return {
    id: row.id,
    clientId: row.clientId,
    code: row.code,
    description: row.description,
    dsm5Name: row.dsm5Name,
    status: row.status as DiagnosisStatus,
    isPrimary: row.isPrimary,
    rank: row.rank,
    onsetDate: row.onsetDate ? row.onsetDate.toISOString().slice(0, 10) : null,
    resolvedDate: row.resolvedDate ? row.resolvedDate.toISOString().slice(0, 10) : null,
    needsCoding: row.needsCoding,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function fail(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}

function parseDateOnly(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** The client must exist in this clinic and be visible to the actor. */
export async function findAccessibleClientId(
  actor: DiagnosisActorWithRole,
  clientId: string
): Promise<boolean> {
  const row = await prisma.client.findFirst({
    where: {
      id: clientId,
      AND: [
        clientAccessWhere({
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
        }),
      ],
    },
    select: { id: true },
  });
  return Boolean(row);
}

async function lockClient(tx: Tx, clientId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Client" WHERE "id" = ${clientId} FOR UPDATE`);
}

async function logEvent(
  tx: Tx,
  actor: DiagnosisActor,
  clientId: string,
  event: {
    action: string;
    diagnosisId?: string | null;
    code?: string | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    detail?: Prisma.InputJsonValue;
  }
) {
  await tx.clientDiagnosisEvent.create({
    data: {
      organizationId: actor.organizationId,
      clientId,
      diagnosisId: event.diagnosisId ?? null,
      action: event.action,
      code: event.code ?? null,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus ?? null,
      detail: event.detail,
      actorId: actor.userId,
      actorName: actor.userName ?? null,
    },
  });
}

export async function listDiagnoses(organizationId: string, clientId: string): Promise<DiagnosisDto[]> {
  const rows = await prisma.clientDiagnosis.findMany({
    where: { organizationId, clientId },
    orderBy: [{ isPrimary: 'desc' }, { rank: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toDiagnosisDto);
}

/** Current (ACTIVE|PROVISIONAL) diagnoses, primary first. */
export async function listCurrentDiagnoses(organizationId: string, clientId: string): Promise<DiagnosisDto[]> {
  const rows = await prisma.clientDiagnosis.findMany({
    where: { organizationId, clientId, status: { in: [...CURRENT_DIAGNOSIS_STATUSES] } },
    orderBy: [{ isPrimary: 'desc' }, { rank: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toDiagnosisDto);
}

/** When the list was last confirmed or changed by staff (any history event except a dismissed suggestion). */
export async function lastDiagnosisReviewAt(organizationId: string, clientId: string): Promise<Date | null> {
  const row = await prisma.clientDiagnosisEvent.findFirst({
    where: { organizationId, clientId, action: { not: 'SUGGESTION_DISMISSED' } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

export type AddDiagnosisInput = {
  code: string;
  description: string;
  dsm5Name?: string | null;
  status?: 'ACTIVE' | 'PROVISIONAL';
  isPrimary?: boolean;
  onsetDate?: string | null;
  needsCoding?: boolean;
  eventAction?: string;
};

export async function addDiagnosis(
  actor: DiagnosisActor,
  clientId: string,
  input: AddDiagnosisInput
): Promise<DiagnosisResult<DiagnosisDto>> {
  const code = normalizeIcdCode(input.code);
  if (!code) return fail(400, DIAGNOSIS_COPY.invalidCode);
  const description = input.description.trim();
  if (!description) return fail(400, 'A description is required.');
  const onset = parseDateOnly(input.onsetDate);

  return prisma.$transaction(async (tx): Promise<DiagnosisResult<DiagnosisDto>> => {
    await lockClient(tx, clientId);
    const current = await tx.clientDiagnosis.findMany({
      where: { organizationId: actor.organizationId, clientId, status: { in: [...CURRENT_DIAGNOSIS_STATUSES] } },
    });
    if (current.some((d) => d.code === code)) return fail(409, DIAGNOSIS_COPY.duplicateCurrent);

    const hasPrimary = current.some((d) => d.isPrimary);
    const makePrimary = input.isPrimary === true || !hasPrimary;
    if (makePrimary && hasPrimary) {
      await tx.clientDiagnosis.updateMany({
        where: { organizationId: actor.organizationId, clientId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    const maxRank = await tx.clientDiagnosis.aggregate({
      where: { organizationId: actor.organizationId, clientId },
      _max: { rank: true },
    });
    const created = await tx.clientDiagnosis.create({
      data: {
        organizationId: actor.organizationId,
        clientId,
        code,
        description: description.slice(0, 300),
        dsm5Name: input.dsm5Name?.trim() || null,
        status: input.status ?? 'ACTIVE',
        isPrimary: makePrimary,
        rank: (maxRank._max.rank ?? -1) + 1,
        onsetDate: onset ?? null,
        needsCoding: input.needsCoding ?? false,
        createdById: actor.userId,
      },
    });
    await logEvent(tx, actor, clientId, {
      action: input.eventAction ?? 'ADDED',
      diagnosisId: created.id,
      code,
      toStatus: created.status,
      detail: { isPrimary: created.isPrimary },
    });
    return { ok: true, value: toDiagnosisDto(created) };
  });
}

export type UpdateDiagnosisInput = {
  code?: string;
  description?: string;
  dsm5Name?: string | null;
  status?: DiagnosisStatus;
  isPrimary?: boolean;
  onsetDate?: string | null;
  resolvedDate?: string | null;
  needsCoding?: boolean;
};

export async function updateDiagnosis(
  actor: DiagnosisActor,
  clientId: string,
  diagnosisId: string,
  patch: UpdateDiagnosisInput
): Promise<DiagnosisResult<DiagnosisDto>> {
  return prisma.$transaction(async (tx): Promise<DiagnosisResult<DiagnosisDto>> => {
    await lockClient(tx, clientId);
    const row = await tx.clientDiagnosis.findFirst({
      where: { id: diagnosisId, clientId, organizationId: actor.organizationId },
    });
    if (!row) return fail(404, 'Diagnosis not found');

    if (patch.code !== undefined) {
      const nextCode = normalizeIcdCode(patch.code);
      if (nextCode !== row.code) return fail(400, DIAGNOSIS_COPY.codeImmutable);
    }

    const fromStatus = row.status as DiagnosisStatus;
    const toStatus = patch.status ?? fromStatus;
    if (fromStatus === 'ENTERED_IN_ERROR' && toStatus !== 'ENTERED_IN_ERROR') {
      return fail(409, 'An entry marked in error cannot be reopened. Add the diagnosis again.');
    }
    const wasCurrent = isCurrentStatus(fromStatus);
    const willBeCurrent = isCurrentStatus(toStatus);

    if (!wasCurrent && willBeCurrent) {
      const dup = await tx.clientDiagnosis.findFirst({
        where: {
          organizationId: actor.organizationId,
          clientId,
          code: row.code,
          id: { not: row.id },
          status: { in: [...CURRENT_DIAGNOSIS_STATUSES] },
        },
        select: { id: true },
      });
      if (dup) return fail(409, DIAGNOSIS_COPY.duplicateCurrent);
    }

    let nextPrimary = row.isPrimary;
    let promotedId: string | null = null;
    if (patch.isPrimary === true) {
      if (!willBeCurrent) return fail(400, 'Only a current diagnosis can be primary.');
      nextPrimary = true;
    } else if (patch.isPrimary === false && row.isPrimary && willBeCurrent) {
      return fail(400, DIAGNOSIS_COPY.primaryRequired);
    }
    if (!willBeCurrent) nextPrimary = false;

    // Demote first so the one-primary index is never violated.
    if (nextPrimary && !row.isPrimary) {
      await tx.clientDiagnosis.updateMany({
        where: { organizationId: actor.organizationId, clientId, isPrimary: true, id: { not: row.id } },
        data: { isPrimary: false },
      });
    }

    const resolvedDate =
      toStatus === 'RESOLVED'
        ? (parseDateOnly(patch.resolvedDate) ?? row.resolvedDate ?? new Date())
        : willBeCurrent
          ? null
          : (parseDateOnly(patch.resolvedDate) ?? row.resolvedDate);

    const updated = await tx.clientDiagnosis.update({
      where: { id: row.id },
      data: {
        description: patch.description !== undefined ? patch.description.trim().slice(0, 300) || row.description : undefined,
        dsm5Name: patch.dsm5Name !== undefined ? patch.dsm5Name?.trim() || null : undefined,
        status: toStatus,
        isPrimary: nextPrimary,
        onsetDate: parseDateOnly(patch.onsetDate),
        resolvedDate,
        needsCoding: patch.needsCoding,
      },
    });

    // The primary left the current list: promote the next current diagnosis so one primary always exists.
    if (row.isPrimary && !nextPrimary) {
      const next = await tx.clientDiagnosis.findFirst({
        where: {
          organizationId: actor.organizationId,
          clientId,
          id: { not: row.id },
          status: { in: [...CURRENT_DIAGNOSIS_STATUSES] },
        },
        orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
      });
      if (next) {
        await tx.clientDiagnosis.update({ where: { id: next.id }, data: { isPrimary: true } });
        promotedId = next.id;
      }
    }

    if (fromStatus !== toStatus) {
      await logEvent(tx, actor, clientId, {
        action: 'STATUS_CHANGED',
        diagnosisId: row.id,
        code: row.code,
        fromStatus,
        toStatus,
      });
    }
    if (nextPrimary !== row.isPrimary) {
      await logEvent(tx, actor, clientId, {
        action: 'PRIMARY_CHANGED',
        diagnosisId: row.id,
        code: row.code,
        detail: { isPrimary: nextPrimary, promotedDiagnosisId: promotedId },
      });
    }
    const touched = ['description', 'dsm5Name', 'onsetDate', 'resolvedDate', 'needsCoding'].filter(
      (k) => (patch as Record<string, unknown>)[k] !== undefined
    );
    if (touched.length > 0) {
      await logEvent(tx, actor, clientId, {
        action: 'UPDATED',
        diagnosisId: row.id,
        code: row.code,
        detail: { fields: touched },
      });
    }
    return { ok: true, value: toDiagnosisDto(updated) };
  });
}

/** Set display order. `ids` must all belong to this client; they take ranks 0..n-1 in the order given. */
export async function reorderDiagnoses(
  actor: DiagnosisActor,
  clientId: string,
  ids: string[]
): Promise<DiagnosisResult<DiagnosisDto[]>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return fail(400, 'Nothing to reorder.');
  return prisma.$transaction(async (tx): Promise<DiagnosisResult<DiagnosisDto[]>> => {
    await lockClient(tx, clientId);
    const rows = await tx.clientDiagnosis.findMany({
      where: { id: { in: unique }, clientId, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (rows.length !== unique.length) return fail(400, 'One or more diagnoses are not on this list.');
    for (let i = 0; i < unique.length; i += 1) {
      await tx.clientDiagnosis.update({ where: { id: unique[i] }, data: { rank: i } });
    }
    await logEvent(tx, actor, clientId, { action: 'REORDERED', detail: { ids: unique } });
    const all = await tx.clientDiagnosis.findMany({
      where: { organizationId: actor.organizationId, clientId },
      orderBy: [{ isPrimary: 'desc' }, { rank: 'asc' }, { createdAt: 'asc' }],
    });
    return { ok: true, value: all.map(toDiagnosisDto) };
  });
}

/** "Reviewed — no change": records that staff confirmed the list as it stands. */
export async function markDiagnosesReviewed(actor: DiagnosisActor, clientId: string): Promise<Date> {
  const event = await prisma.clientDiagnosisEvent.create({
    data: {
      organizationId: actor.organizationId,
      clientId,
      action: 'REVIEWED',
      actorId: actor.userId,
      actorName: actor.userName ?? null,
    },
    select: { createdAt: true },
  });
  return event.createdAt;
}

export async function listDiagnosisHistory(
  organizationId: string,
  clientId: string,
  take = 200
): Promise<DiagnosisHistoryDto[]> {
  const rows = await prisma.clientDiagnosisEvent.findMany({
    where: { organizationId, clientId },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    diagnosisId: r.diagnosisId,
    action: r.action,
    code: r.code,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    detail: r.detail,
    actorName: r.actorName,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Record a dismissed suggestion in history (used by the suggestions route). */
export async function logSuggestionEvent(
  actor: DiagnosisActor,
  clientId: string,
  action: 'SUGGESTION_ACCEPTED' | 'SUGGESTION_DISMISSED',
  code: string
) {
  await prisma.clientDiagnosisEvent.create({
    data: {
      organizationId: actor.organizationId,
      clientId,
      action,
      code,
      actorId: actor.userId,
      actorName: actor.userName ?? null,
    },
  });
}
