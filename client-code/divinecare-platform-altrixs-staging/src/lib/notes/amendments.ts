/**
 * Patient-requested amendments (45 CFR 164.526). The covered entity acts within 60 days (one
 * 30-day extension with a written reason). Accepting adds the amendment to the signed note as an
 * addendum (the original is never changed); denying requires the basis in writing, and the
 * client's statement of disagreement can be recorded with the denial.
 */
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { addNoteAddendum, isElevatedNoteActor } from '@/lib/clients/notes';
import { AMENDMENT_ADDENDUM_REASON } from '@/lib/notes/noteMeta';
import { amendmentDueOn } from '@/lib/notes/standard';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const createAmendmentSchema = z.object({
  clientId: z.string().min(1).max(128),
  noteId: z.string().min(1).max(128).nullish(),
  requestedBy: z.string().trim().min(1, 'Who made the request?').max(200),
  requestedOn: ymd,
  requestText: z.string().trim().min(1, 'Describe the requested amendment').max(8000),
});

export const decideAmendmentSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), amendmentText: z.string().trim().min(1, 'Enter the amendment text').max(8000), reason: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal('deny'), reason: z.string().trim().min(5, 'State the basis for the denial').max(4000) }),
  z.object({ action: z.literal('extend'), reason: z.string().trim().min(5, 'State the reason for the extension').max(2000) }),
  z.object({ action: z.literal('disagreement'), statement: z.string().trim().min(1).max(8000) }),
]);

type Actor = { organizationId: string; actorUserId: string; actorRole: Role; actorBaseRole?: Role | null };

export function serializeAmendment(a: {
  id: string;
  clientId: string;
  noteId: string | null;
  requestedBy: string;
  requestedOn: Date;
  requestText: string;
  status: string;
  dueOn: Date;
  extendedOn: Date | null;
  extensionReason: string | null;
  decisionReason: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  addendumId: string | null;
  disagreementStatement: string | null;
  createdAt: Date;
}) {
  return {
    id: a.id,
    clientId: a.clientId,
    noteId: a.noteId,
    requestedBy: a.requestedBy,
    requestedOn: a.requestedOn.toISOString().slice(0, 10),
    requestText: a.requestText,
    status: a.status,
    dueOn: a.dueOn.toISOString().slice(0, 10),
    extendedOn: a.extendedOn ? a.extendedOn.toISOString().slice(0, 10) : null,
    extensionReason: a.extensionReason,
    decisionReason: a.decisionReason,
    decidedByName: a.decidedByName,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    addendumId: a.addendumId,
    disagreementStatement: a.disagreementStatement,
    createdAt: a.createdAt.toISOString(),
  };
}

async function accessibleClient(actor: Actor, clientId: string) {
  return prisma.client.findFirst({ where: { id: clientId, ...clientAccessWhere(actor) }, select: { id: true } });
}

export async function listAmendmentRequests(actor: Actor, filter: { clientId?: string | null; status?: string | null }) {
  const rows = await prisma.noteAmendmentRequest.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: [{ status: 'asc' }, { dueOn: 'asc' }],
    take: 200,
  });
  // Caseload scope: only clients the actor can open
  const clientIds = [...new Set(rows.map((r) => r.clientId))];
  const allowed = clientIds.length
    ? new Set((await prisma.client.findMany({ where: { id: { in: clientIds }, ...clientAccessWhere(actor) }, select: { id: true } })).map((c) => c.id))
    : new Set<string>();
  return rows.filter((r) => allowed.has(r.clientId)).map(serializeAmendment);
}

export async function createAmendmentRequest(actor: Actor, input: z.infer<typeof createAmendmentSchema>) {
  const client = await accessibleClient(actor, input.clientId);
  if (!client) return { ok: false as const, status: 404, error: 'Client not found' };
  if (input.noteId) {
    const note = await prisma.progressNote.findFirst({ where: { id: input.noteId, clientId: client.id }, select: { id: true } });
    if (!note) return { ok: false as const, status: 404, error: 'Note not found for this client' };
  }
  const row = await prisma.noteAmendmentRequest.create({
    data: {
      organizationId: actor.organizationId,
      clientId: client.id,
      noteId: input.noteId ?? null,
      requestedBy: input.requestedBy,
      requestedOn: new Date(`${input.requestedOn}T00:00:00.000Z`),
      requestText: input.requestText,
      dueOn: new Date(`${amendmentDueOn(input.requestedOn)}T00:00:00.000Z`),
      createdById: actor.actorUserId,
    },
  });
  return { ok: true as const, request: serializeAmendment(row) };
}

export async function decideAmendmentRequest(actor: Actor, id: string, input: z.infer<typeof decideAmendmentSchema>) {
  const row = await prisma.noteAmendmentRequest.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!row) return { ok: false as const, status: 404, error: 'Amendment request not found' };
  if (!(await accessibleClient(actor, row.clientId))) return { ok: false as const, status: 404, error: 'Amendment request not found' };

  // Decisions: the note's author, or an administrator / director (privacy officer workflow)
  const note = row.noteId ? await prisma.progressNote.findUnique({ where: { id: row.noteId }, select: { id: true, clinicianId: true } }) : null;
  const elevated = isElevatedNoteActor(actor.actorRole, actor.actorBaseRole);
  if (!elevated && note?.clinicianId !== actor.actorUserId) {
    return { ok: false as const, status: 403, error: 'Only the note author or an administrator / director can decide an amendment request.' };
  }
  const decider = await prisma.user.findUnique({ where: { id: actor.actorUserId }, select: { name: true, email: true } });
  const decidedByName = decider?.name?.trim() || decider?.email || null;

  if (input.action === 'disagreement') {
    if (row.status !== 'DENIED') return { ok: false as const, status: 409, error: 'A statement of disagreement is recorded after a denial.' };
    const updated = await prisma.noteAmendmentRequest.update({ where: { id }, data: { disagreementStatement: input.statement } });
    return { ok: true as const, request: serializeAmendment(updated), clientId: row.clientId };
  }
  if (row.status !== 'PENDING') return { ok: false as const, status: 409, error: `This request was already ${row.status.toLowerCase()}.` };

  if (input.action === 'extend') {
    if (row.extendedOn) return { ok: false as const, status: 409, error: 'Only one 30-day extension is allowed (45 CFR 164.526(b)(2)(ii)).' };
    const requestedOn = row.requestedOn.toISOString().slice(0, 10);
    const updated = await prisma.noteAmendmentRequest.update({
      where: { id },
      data: { extendedOn: new Date(), extensionReason: input.reason, dueOn: new Date(`${amendmentDueOn(requestedOn, true)}T00:00:00.000Z`) },
    });
    return { ok: true as const, request: serializeAmendment(updated), clientId: row.clientId };
  }

  if (input.action === 'deny') {
    const updated = await prisma.noteAmendmentRequest.update({
      where: { id },
      data: { status: 'DENIED', decisionReason: input.reason, decidedById: actor.actorUserId, decidedByName, decidedAt: new Date() },
    });
    return { ok: true as const, request: serializeAmendment(updated), clientId: row.clientId };
  }

  // accept: the amendment is linked to the signed note as an addendum (original retained)
  let addendumId: string | null = null;
  if (note) {
    const added = await addNoteAddendum({
      noteId: note.id,
      organizationId: actor.organizationId,
      actorUserId: actor.actorUserId,
      actorRole: actor.actorRole,
      actorBaseRole: actor.actorBaseRole,
      reason: AMENDMENT_ADDENDUM_REASON,
      text: `Amendment at the client's request (received ${row.requestedOn.toISOString().slice(0, 10)}, from ${row.requestedBy}):\n${input.amendmentText}`,
    });
    if (added.ok === false) return { ok: false as const, status: added.status, error: added.error };
    addendumId = added.addendum.id;
  }
  const updated = await prisma.noteAmendmentRequest.update({
    where: { id },
    data: { status: 'ACCEPTED', decisionReason: input.reason || null, decidedById: actor.actorUserId, decidedByName, decidedAt: new Date(), addendumId },
  });
  return { ok: true as const, request: serializeAmendment(updated), clientId: row.clientId };
}
