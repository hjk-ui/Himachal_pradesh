/**
 * Progress note service details (ProgressNoteServiceDetail): start / end time, telehealth modality,
 * patient location + state, telehealth consent, and the chart diagnoses linked to the visit.
 * Defaults come from the linked appointment and the chart; nothing is invented.
 */
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { loadDiagnosisList } from '@/lib/diagnoses/store';
import { currentInOrder } from '@/lib/diagnoses/model';
import { resolvePracticeTimeZone, toPracticeWallTime } from '@/lib/time/practiceTime';
import { consentOnFile } from '@/lib/consents/onFile';
import { loadPlannedPlan } from '@/lib/appointments/plannedCodesDb';
import type { PlannedLine } from '@/lib/appointments/plannedCodes';

export type ServiceDetail = {
  startTime: string | null;
  endTime: string | null;
  telehealthModality: 'audio_video' | 'audio_only' | null;
  patientLocationType: 'home' | 'other' | null;
  patientLocationState: string | null;
  telehealthConsent: boolean | null;
  diagnosisCodes: string[];
};

export const EMPTY_SERVICE_DETAIL: ServiceDetail = {
  startTime: null,
  endTime: null,
  telehealthModality: null,
  patientLocationType: null,
  patientLocationState: null,
  telehealthConsent: null,
  diagnosisCodes: [],
};

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM')
  .nullish();

export const serviceDetailSchema = z.object({
  startTime: time,
  endTime: time,
  telehealthModality: z.enum(['audio_video', 'audio_only']).nullish(),
  patientLocationType: z.enum(['home', 'other']).nullish(),
  patientLocationState: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'State must be a 2-letter code')
    .nullish(),
  telehealthConsent: z.boolean().nullish(),
  diagnosisCodes: z
    .array(z.string().trim().regex(/^[A-TV-Z]\d{2}(?:\.[0-9A-Z]{1,4})?$/i, 'Invalid ICD-10 code'))
    .max(12)
    .optional(),
});

export type ServiceDetailInput = z.infer<typeof serviceDetailSchema>;

type Row = {
  startTime: string | null;
  endTime: string | null;
  telehealthModality: string | null;
  patientLocationType: string | null;
  patientLocationState: string | null;
  telehealthConsent: boolean | null;
  diagnosisCodes: string[];
};

export function serializeServiceDetail(row: Row | null | undefined): ServiceDetail {
  if (!row) return { ...EMPTY_SERVICE_DETAIL };
  return {
    startTime: row.startTime,
    endTime: row.endTime,
    telehealthModality: row.telehealthModality === 'audio_only' ? 'audio_only' : row.telehealthModality === 'audio_video' ? 'audio_video' : null,
    patientLocationType: row.patientLocationType === 'home' ? 'home' : row.patientLocationType === 'other' ? 'other' : null,
    patientLocationState: row.patientLocationState,
    telehealthConsent: row.telehealthConsent,
    diagnosisCodes: row.diagnosisCodes || [],
  };
}

/** Saved details, or null when none / the table is missing. */
export async function getServiceDetail(noteId: string): Promise<ServiceDetail | null> {
  try {
    const row = await prisma.progressNoteServiceDetail.findUnique({ where: { noteId } });
    return row ? serializeServiceDetail(row) : null;
  } catch {
    return null;
  }
}

export type ServiceContext = {
  /** Current chart diagnoses from the diagnosis list, rank order (coded ones can be linked) */
  diagnoses: { code: string | null; label: string; rank: 'primary' | 'secondary'; status?: 'ACTIVE' | 'PROVISIONAL' }[];
  /** Defaults from the linked appointment (practice clock); null when there is none */
  appointment: {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    telehealth: boolean;
    audioOnly: boolean;
    patientLocationType: 'home' | 'other' | null;
    patientLocationState: string | null;
    /** Codes planned at booking: prefill a note that has no code yet (the signed note's codes bill) */
    plannedCodes?: Pick<PlannedLine, 'code' | 'units' | 'modifiers' | 'isAddOn'>[];
  } | null;
  /** A signed, unrevoked, unexpired telehealth consent is on the chart (prefills the note's consent tick) */
  telehealthConsentOnFile?: boolean;
};

/** Chart diagnoses + appointment defaults for the editor (org + caseload scoped). */
export async function loadServiceContext(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
  appointmentId?: string | null;
}): Promise<ServiceContext | null> {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientAccessWhere(input) },
    select: { id: true },
  });
  if (!client) return null;
  let appointment: ServiceContext['appointment'] = null;
  if (input.appointmentId) {
    const appt = await prisma.appointment.findFirst({
      where: { id: input.appointmentId, clientId: client.id },
      select: { id: true, startsAt: true, endsAt: true, isVirtual: true, audioOnly: true, patientLocationType: true, patientLocationState: true },
    });
    if (appt) {
      const settings = await prisma.practiceSettings
        .findUnique({ where: { organizationId: input.organizationId }, select: { timeZone: true } })
        .catch(() => null);
      const tz = resolvePracticeTimeZone(settings?.timeZone);
      const start = toPracticeWallTime(appt.startsAt, tz);
      const end = toPracticeWallTime(appt.endsAt, tz);
      appointment = {
        id: appt.id,
        date: start.date,
        startTime: start.time,
        endTime: end.time,
        telehealth: appt.isVirtual || appt.audioOnly,
        audioOnly: appt.audioOnly,
        patientLocationType: appt.patientLocationType === 'home' ? 'home' : appt.patientLocationType === 'other' ? 'other' : null,
        patientLocationState: appt.patientLocationState?.trim().toUpperCase() || null,
        plannedCodes: ((await loadPlannedPlan(input.organizationId, appt.id))?.lines ?? []).map((l) => ({
          code: l.code,
          units: l.units,
          modifiers: l.modifiers,
          isAddOn: l.isAddOn,
        })),
      };
    }
  }
  let telehealthConsentOnFile = false;
  if (appointment?.telehealth) {
    const rows = await prisma.consentForm
      .findMany({
        where: { organizationId: input.organizationId, clientId: client.id },
        select: { type: true, formKey: true, status: true, formStatus: true, expiresAt: true, revokedAt: true },
        take: 200,
      })
      .catch(() => []);
    telehealthConsentOnFile = consentOnFile(rows, 'telehealth-consent', /telehealth/i, new Date());
  }
  // The diagnosis list (falls back to the client record before the list exists): current only, so a
  // resolved / ruled-out diagnosis cannot be linked to a new visit
  const list = await loadDiagnosisList(input.organizationId, client.id);
  const diagnoses = currentInOrder(list.rows).map((r) => ({
    code: r.code,
    label: r.dsmName || r.description || r.code || '',
    rank: r.isPrimary ? ('primary' as const) : ('secondary' as const),
    status: r.status === 'PROVISIONAL' ? ('PROVISIONAL' as const) : ('ACTIVE' as const),
  }));
  return { diagnoses, appointment, telehealthConsentOnFile };
}

/** Save details on a DRAFT note (signed notes are immutable). */
export async function saveServiceDetail(input: {
  noteId: string;
  actorUserId: string;
  detail: ServiceDetailInput;
}): Promise<{ ok: true; detail: ServiceDetail } | { ok: false; status: number; error: string }> {
  const wf = await prisma.progressNoteWorkflow.findUnique({ where: { noteId: input.noteId }, select: { status: true } });
  if (wf && wf.status !== 'DRAFT') {
    return { ok: false, status: 409, error: 'A signed note is immutable. Use an addendum for corrections.' };
  }
  const d = input.detail;
  const data = {
    ...(d.startTime !== undefined ? { startTime: d.startTime || null } : {}),
    ...(d.endTime !== undefined ? { endTime: d.endTime || null } : {}),
    ...(d.telehealthModality !== undefined ? { telehealthModality: d.telehealthModality || null } : {}),
    ...(d.patientLocationType !== undefined ? { patientLocationType: d.patientLocationType || null } : {}),
    ...(d.patientLocationState !== undefined ? { patientLocationState: d.patientLocationState ? d.patientLocationState.toUpperCase() : null } : {}),
    ...(d.telehealthConsent !== undefined ? { telehealthConsent: d.telehealthConsent ?? null } : {}),
    ...(d.diagnosisCodes !== undefined ? { diagnosisCodes: [...new Set(d.diagnosisCodes.map((c) => c.toUpperCase()))] } : {}),
    updatedById: input.actorUserId,
  };
  const row = await prisma.progressNoteServiceDetail.upsert({
    where: { noteId: input.noteId },
    create: { noteId: input.noteId, ...data },
    update: data,
  });
  return { ok: true, detail: serializeServiceDetail(row) };
}
