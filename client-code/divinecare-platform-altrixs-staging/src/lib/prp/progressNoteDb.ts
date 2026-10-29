/**
 * PRP progress note detail storage (progress_note_prp_details, 20261027_prp_note_detail.sql) and
 * the editor context (current IRP objectives, the previous PRP note's objectives, the next booked
 * appointment). Draft-only edits, like Service details; frozen with the note once signed.
 */
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { clinicDate } from '@/lib/workflows/dates';
import {
  EMPTY_PRP_DETAIL,
  PRP_COLLABORATOR_VALUES,
  PRP_INTERVENTION_VALUES,
  PRP_LOCATION_VALUES,
  PRP_PARTICIPANT_VALUES,
  PRP_PROGRESS_VALUES,
  PRP_SIGNATURE_REASON_VALUES,
  carryForwardObjectives,
  irpObjectiveOptions,
  irpOverdue,
  normalizeParticipants,
  type IrpObjectiveOption,
  type IrpState,
  type PrpNoteDetail,
  type PrpObjectiveRef,
} from '@/lib/prp/progressNote';

const text = (max: number) => z.string().trim().max(max).nullish();
const enumOf = <T extends string>(vals: readonly T[]) => z.enum(vals as unknown as [T, ...T[]]);

export const prpDetailSchema = z.object({
  location: enumOf(PRP_LOCATION_VALUES).nullish(),
  communityLocation: text(200),
  participants: z.array(enumOf(PRP_PARTICIPANT_VALUES)).max(10).optional(),
  participantsOther: text(200),
  objectives: z.array(z.object({ key: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(300) })).max(20).optional(),
  objectiveOther: text(500),
  interventions: z.array(enumOf(PRP_INTERVENTION_VALUES)).max(20).optional(),
  progress: enumOf(PRP_PROGRESS_VALUES).nullish(),
  collaboration: z.array(enumOf(PRP_COLLABORATOR_VALUES)).max(10).optional(),
  collaborationNote: text(500),
  patientSignatureStatus: z.enum(['signed', 'not_obtained']).nullish(),
  patientSignatureName: text(120),
  patientSignatureReason: enumOf(PRP_SIGNATURE_REASON_VALUES).nullish(),
  patientSignatureReasonOther: text(300),
});
export type PrpDetailInput = z.infer<typeof prpDetailSchema>;

type Row = {
  location: string | null;
  communityLocation: string | null;
  participants: string[];
  participantsOther: string | null;
  objectives: unknown;
  objectiveOther: string | null;
  interventions: string[];
  progress: string | null;
  collaboration: string[];
  collaborationNote: string | null;
  patientSignatureStatus: string | null;
  patientSignatureName: string | null;
  patientSignedAt: Date | null;
  patientSignatureReason: string | null;
  patientSignatureReasonOther: string | null;
};

const pick = <T extends string>(vals: readonly T[], v: string | null | undefined): T | null => ((vals as readonly string[]).includes(String(v)) ? (v as T) : null);
const pickAll = <T extends string>(vals: readonly T[], list: string[] | null | undefined): T[] => (list ?? []).filter((v): v is T => (vals as readonly string[]).includes(v));

function objectivesOf(raw: unknown): PrpObjectiveRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is { key: string; label: string } => !!o && typeof o === 'object' && typeof (o as { key?: unknown }).key === 'string' && typeof (o as { label?: unknown }).label === 'string')
    .map((o) => ({ key: o.key, label: o.label }));
}

export function serializePrpDetail(row: Row | null | undefined): PrpNoteDetail {
  if (!row) return { ...EMPTY_PRP_DETAIL };
  return {
    location: pick(PRP_LOCATION_VALUES, row.location),
    communityLocation: row.communityLocation,
    participants: normalizeParticipants(row.participants),
    participantsOther: row.participantsOther,
    objectives: objectivesOf(row.objectives),
    objectiveOther: row.objectiveOther,
    interventions: pickAll(PRP_INTERVENTION_VALUES, row.interventions),
    progress: pick(PRP_PROGRESS_VALUES, row.progress),
    collaboration: pickAll(PRP_COLLABORATOR_VALUES, row.collaboration),
    collaborationNote: row.collaborationNote,
    patientSignatureStatus: row.patientSignatureStatus === 'signed' || row.patientSignatureStatus === 'not_obtained' ? row.patientSignatureStatus : null,
    patientSignatureName: row.patientSignatureName,
    patientSignedAt: row.patientSignedAt ? row.patientSignedAt.toISOString() : null,
    patientSignatureReason: pick(PRP_SIGNATURE_REASON_VALUES, row.patientSignatureReason),
    patientSignatureReasonOther: row.patientSignatureReasonOther,
  };
}

/** Saved detail, or null when none / the table is missing (migration not run). */
export async function getPrpNoteDetail(noteId: string): Promise<PrpNoteDetail | null> {
  try {
    const row = await prisma.progressNotePrpDetail.findUnique({ where: { noteId } });
    return row ? serializePrpDetail(row) : null;
  } catch {
    return null;
  }
}

/** Save on a DRAFT note only. The participant signature time is stamped by the server. */
export async function savePrpNoteDetail(input: {
  noteId: string;
  actorUserId: string;
  detail: PrpDetailInput;
}): Promise<{ ok: true; detail: PrpNoteDetail } | { ok: false; status: number; error: string }> {
  const wf = await prisma.progressNoteWorkflow.findUnique({ where: { noteId: input.noteId }, select: { status: true } });
  if (wf && wf.status !== 'DRAFT') {
    return { ok: false, status: 409, error: 'A signed note is immutable. Use an addendum for corrections.' };
  }
  const d = input.detail;
  const existing = await prisma.progressNotePrpDetail.findUnique({
    where: { noteId: input.noteId },
    select: { patientSignatureStatus: true, patientSignatureName: true, patientSignedAt: true },
  });
  const set = <K extends keyof PrpDetailInput>(k: K, v: unknown) => (d[k] !== undefined ? { [k]: v } : {});
  // Signature stamp: set when the participant signs (or the typed name changes), cleared otherwise
  let signedAt: Date | null | undefined;
  if (d.patientSignatureStatus !== undefined || d.patientSignatureName !== undefined) {
    const status = d.patientSignatureStatus !== undefined ? d.patientSignatureStatus : existing?.patientSignatureStatus;
    const name = (d.patientSignatureName !== undefined ? d.patientSignatureName : existing?.patientSignatureName)?.trim() || null;
    if (status === 'signed' && name) {
      signedAt = existing?.patientSignatureStatus === 'signed' && existing.patientSignatureName === name && existing.patientSignedAt ? existing.patientSignedAt : new Date();
    } else signedAt = null;
  }
  const data = {
    ...set('location', d.location ?? null),
    ...set('communityLocation', d.communityLocation || null),
    ...(d.participants !== undefined ? { participants: normalizeParticipants(d.participants) } : {}),
    ...set('participantsOther', d.participantsOther || null),
    ...(d.objectives !== undefined ? { objectives: d.objectives as object } : {}),
    ...set('objectiveOther', d.objectiveOther || null),
    ...(d.interventions !== undefined ? { interventions: [...new Set(d.interventions)] } : {}),
    ...set('progress', d.progress ?? null),
    ...(d.collaboration !== undefined ? { collaboration: [...new Set(d.collaboration)] } : {}),
    ...set('collaborationNote', d.collaborationNote || null),
    ...set('patientSignatureStatus', d.patientSignatureStatus ?? null),
    ...set('patientSignatureName', d.patientSignatureName || null),
    ...(signedAt !== undefined ? { patientSignedAt: signedAt } : {}),
    ...set('patientSignatureReason', d.patientSignatureReason ?? null),
    ...set('patientSignatureReasonOther', d.patientSignatureReasonOther || null),
    updatedById: input.actorUserId,
  };
  const row = await prisma.progressNotePrpDetail.upsert({
    where: { noteId: input.noteId },
    create: { noteId: input.noteId, ...data },
    update: data,
  });
  return { ok: true, detail: serializePrpDetail(row) };
}

export type PrpNoteContext = {
  irp: IrpState & { objectives: IrpObjectiveOption[] };
  /** Objectives of the previous PRP note still on the IRP (suggestion) */
  suggestedObjectives: PrpObjectiveRef[];
  previousNoteDate: string | null;
  nextAppointment: { id: string; startsAt: string; type: string; clinicianName: string | null } | null;
  /** Visit defaults (location) when the note is linked to an appointment */
  appointment: { telehealth: boolean; locationId: string | null } | null;
};

/** Editor context (org + caseload scoped). Null when the client is not in scope. */
export async function loadPrpNoteContext(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
  noteId?: string | null;
  appointmentId?: string | null;
}): Promise<PrpNoteContext | null> {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientAccessWhere(input) },
    select: { id: true },
  });
  if (!client) return null;
  const today = clinicDate(new Date());
  const [wf, prevNotes, next, appt] = await Promise.all([
    // PrpWorkflow has no organizationId: read only for a client already in scope (above)
    prisma.prpWorkflow.findFirst({
      where: { clientId: client.id },
      orderBy: { updatedAt: 'desc' },
      select: { irpData: true, irpReviewDueDate: true },
    }),
    prisma.progressNote.findMany({
      where: { clientId: client.id, noteType: 'PRP', dismissedAt: null, ...(input.noteId ? { id: { not: input.noteId } } : {}) },
      orderBy: [{ dateOfService: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, dateOfService: true, createdAt: true },
      take: 5,
    }),
    prisma.appointment.findFirst({
      where: { clientId: client.id, startsAt: { gt: new Date() }, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
      orderBy: { startsAt: 'asc' },
      select: { id: true, startsAt: true, type: true, clinician: { select: { name: true } } },
    }),
    input.appointmentId
      ? prisma.appointment.findFirst({ where: { id: input.appointmentId, clientId: client.id }, select: { isVirtual: true, audioOnly: true, locationId: true } })
      : Promise.resolve(null),
  ]);
  const data = wf?.irpData && typeof wf.irpData === 'object' ? (wf.irpData as Record<string, unknown>) : null;
  const status: IrpState['status'] = !data || !Object.keys(data).length ? 'none' : data.status === 'final' ? 'final' : 'draft';
  let reviewDue: Date | string | null = wf?.irpReviewDueDate ?? null;
  if (!reviewDue && typeof data?.nextIRPReviewDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(data.nextIRPReviewDate)) reviewDue = data.nextIRPReviewDate;
  const reviewDueDate = reviewDue ? (typeof reviewDue === 'string' ? reviewDue.slice(0, 10) : reviewDue.toISOString().slice(0, 10)) : null;
  // Draft IRPs are listed too (with the warning) so a contact can still be documented
  const objectives = status === 'none' ? [] : irpObjectiveOptions(data);

  let suggestedObjectives: PrpObjectiveRef[] = [];
  let previousNoteDate: string | null = null;
  if (prevNotes.length) {
    const details = await prisma.progressNotePrpDetail
      .findMany({ where: { noteId: { in: prevNotes.map((n) => n.id) } }, select: { noteId: true, objectives: true } })
      .catch(() => []);
    for (const n of prevNotes) {
      const d = details.find((x) => x.noteId === n.id);
      if (!d) continue;
      suggestedObjectives = carryForwardObjectives(objectivesOf(d.objectives), objectives);
      previousNoteDate = (n.dateOfService ?? n.createdAt).toISOString().slice(0, 10);
      break;
    }
  }
  return {
    irp: { status, reviewDueDate, overdue: irpOverdue(reviewDueDate, today), objectives },
    suggestedObjectives,
    previousNoteDate,
    nextAppointment: next ? { id: next.id, startsAt: next.startsAt.toISOString(), type: next.type, clinicianName: next.clinician?.name ?? null } : null,
    appointment: appt ? { telehealth: appt.isVirtual || appt.audioOnly, locationId: appt.locationId } : null,
  };
}
