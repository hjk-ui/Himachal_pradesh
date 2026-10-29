/**
 * Identifying Information (Oct 25) — server-side loading and chart write-back.
 * DB access lives here so the route stays thin and the rest of the module stays pure.
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { isPsychotherapyNote, receivesProgressNoteBody } from '@/lib/clients/chartVisibility';
import {
  canAccessClientChartNotes,
  canEditClientProfile,
  clientAccessWhere,
} from '@/lib/clients/orgScope';
import { isSudNote, parseNoteMeta } from '@/lib/ehr/noteTemplates';
import { NOT_DISMISSED } from '@/lib/notes/dismiss';
import { loadWorkflowStatuses } from '@/lib/notes/workflow-store';
import { assertClientPhiAccess } from '@/lib/privacy/sensitiveAccess';
import { resolveIdentifyingNoteType, parseIdentifyingSection } from './fields';
import { modalityFromAppointment, PRIOR_EVALUATION_FIELDS } from './prefill';
import type {
  ChartDemographicsChanges,
  IdentifyingInfoPayload,
  IdentifyingPriorEvaluation,
  IdentifyingValues,
  IdentifyingVitals,
} from './types';

export type IdentifyingActor = {
  userId: string;
  role: Role;
  /** Real account role (Admin Role Preview still reads the chart as the admin). */
  baseRole?: Role | null;
  organizationId: string;
};

function isElevatedBaseRole(baseRole: Role | null | undefined): boolean {
  return baseRole === 'ADMIN' || baseRole === 'PRACTICE_DIRECTOR';
}

/** Same gate as the chart Notes tab. */
export function canReadIdentifyingInfo(actor: Pick<IdentifyingActor, 'role' | 'baseRole'>): boolean {
  return canAccessClientChartNotes(actor.role) || isElevatedBaseRole(actor.baseRole);
}

function scopeRole(actor: IdentifyingActor): Role {
  return isElevatedBaseRole(actor.baseRole) ? (actor.baseRole as Role) : actor.role;
}

async function findClient(clientId: string, actor: IdentifyingActor) {
  return prisma.client.findFirst({
    where: {
      id: clientId,
      AND: [
        clientAccessWhere({
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          actorRole: scopeRole(actor),
        }),
      ],
    },
    select: { id: true, namePrefix: true, gender: true, dateOfBirth: true },
  });
}

async function latestVitals(clientId: string): Promise<IdentifyingVitals | null> {
  const rows = await prisma.medicalVital.findMany({
    where: { clientId },
    orderBy: { recordedAt: 'desc' },
    take: 10,
    select: { weightLbs: true, heightInches: true, bmi: true, recordedAt: true },
  });
  const row = rows.find((r) => r.weightLbs != null || r.heightInches != null || r.bmi != null);
  if (!row) return null;
  return {
    weightLbs: row.weightLbs,
    heightInches: row.heightInches,
    bmi: row.bmi,
    recordedAt: row.recordedAt.toISOString(),
  };
}

/**
 * Last signed evaluation that carried an Identifying Information section.
 * 42 CFR Part 2 notes (SUD / part2 flag) and other authors' psychotherapy notes are never used as a prior.
 */
async function lastSignedEvaluation(
  clientId: string,
  actorUserId: string
): Promise<IdentifyingPriorEvaluation | null> {
  const notes = await prisma.progressNote.findMany({
    where: { clientId, ...NOT_DISMISSED },
    orderBy: { createdAt: 'desc' },
    take: 80,
    select: { id: true, body: true, clinicianId: true, createdAt: true },
  });
  if (notes.length === 0) return null;
  const workflow = await loadWorkflowStatuses(notes.map((n) => n.id));

  let best: IdentifyingPriorEvaluation | null = null;
  for (const note of notes) {
    const wf = workflow.get(note.id);
    if (!wf || (wf.status !== 'Signed' && wf.status !== 'Locked')) continue;

    const meta = parseNoteMeta(note.body);
    if (!resolveIdentifyingNoteType(meta.noteType)) continue;
    if (isSudNote(meta.noteType ?? '', meta.sudConfidential === true)) continue;
    if (isPsychotherapyNote(meta.noteType, note.body) && note.clinicianId !== actorUserId) continue;

    const parsed = parseIdentifyingSection(meta.displayBody);
    const values: IdentifyingValues = {};
    for (const key of PRIOR_EVALUATION_FIELDS) {
      if (parsed[key]) values[key] = parsed[key];
    }
    if (Object.keys(values).length === 0) continue;

    const date = wf.signedAt ?? wf.lockedAt ?? note.createdAt.toISOString();
    if (!best || date > best.date) best = { noteId: note.id, date, values };
  }
  return best;
}

export type LoadIdentifyingResult =
  | { ok: true; payload: IdentifyingInfoPayload }
  | { ok: false; status: number; error: string };

export async function loadIdentifyingInfo(input: {
  clientId: string;
  appointmentId?: string | null;
  actor: IdentifyingActor;
}): Promise<LoadIdentifyingResult> {
  const { actor, clientId } = input;
  if (!canReadIdentifyingInfo(actor)) return { ok: false, status: 403, error: 'Forbidden' };

  const client = await findClient(clientId, actor);
  if (!client) return { ok: false, status: 404, error: 'Client not found' };

  await assertClientPhiAccess({
    organizationId: actor.organizationId,
    userId: actor.userId,
    role: actor.role,
    clientId,
    path: 'identifying-info',
  });

  const [vitals, prior, visit] = await Promise.all([
    latestVitals(clientId),
    receivesProgressNoteBody(actor.role) || isElevatedBaseRole(actor.baseRole)
      ? lastSignedEvaluation(clientId, actor.userId)
      : Promise.resolve(null),
    input.appointmentId
      ? prisma.appointment
          .findFirst({
            where: { id: input.appointmentId, clientId },
            select: { id: true, isVirtual: true, telehealthPlatform: true },
          })
          .then((a) =>
            a ? { appointmentId: a.id, modality: modalityFromAppointment(a) } : null
          )
      : Promise.resolve(null),
  ]);

  return {
    ok: true,
    payload: {
      chart: {
        namePrefix: client.namePrefix,
        gender: client.gender,
        dateOfBirth: client.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      },
      vitals,
      prior,
      visit,
      canUpdateChart: canEditClientProfile(actor.role),
    },
  };
}

export type ApplyChartResult =
  | { ok: true; fields: string[] }
  | { ok: false; status: number; error: string };

/** Chart columns written by each change key. Blank values never reach here (Zod rejects them). */
const CHART_COLUMN: Record<keyof ChartDemographicsChanges, 'namePrefix' | 'gender'> = {
  title: 'namePrefix',
  genderIdentity: 'gender',
};

export async function applyChartDemographics(input: {
  clientId: string;
  changes: ChartDemographicsChanges;
  actor: IdentifyingActor;
}): Promise<ApplyChartResult> {
  const { actor, clientId, changes } = input;
  if (!canEditClientProfile(actor.role)) return { ok: false, status: 403, error: 'Forbidden' };

  const client = await findClient(clientId, actor);
  if (!client) return { ok: false, status: 404, error: 'Client not found' };

  await assertClientPhiAccess({
    organizationId: actor.organizationId,
    userId: actor.userId,
    role: actor.role,
    clientId,
    path: 'identifying-info',
  });

  const data: { namePrefix?: string; gender?: string } = {};
  for (const key of Object.keys(CHART_COLUMN) as (keyof ChartDemographicsChanges)[]) {
    const value = changes[key]?.trim();
    if (value) data[CHART_COLUMN[key]] = value;
  }
  const fields = Object.keys(data);
  if (fields.length === 0) return { ok: false, status: 400, error: 'No changes provided' };

  await prisma.client.update({ where: { id: client.id }, data });
  return { ok: true, fields };
}
