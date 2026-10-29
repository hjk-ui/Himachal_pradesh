import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { loadWorkflowStatuses } from '@/lib/notes/workflow-store';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { isCaseloadRole } from '@/types/roles';
import {
  computeClinicianDocMetrics,
  deriveAppointmentNoteStatus,
  lastDaysWindow,
  type ClinicianDocMetrics,
  type DerivedNoteStatus,
  type VisitNote,
  type VisitRow,
} from '@/lib/analytics/visitDocumentation';
import { summarizeVisitNotes, type VisitNoteSummary } from '@/lib/appointments/docLight';
import { NOT_IMPORTED_HISTORY } from '@/lib/appointments/importedHistory';

/** Trend range: six weekly buckets. */
export const VISIT_DOC_TREND_DAYS = 42;

/**
 * Note status per appointment from the linked ProgressNoteWorkflow rows (Appointment.noteStatus
 * is never written, so it must not be read). Appointments without a linked note → NOT_STARTED.
 */
export async function loadAppointmentNoteStatuses(appointmentIds: string[]): Promise<Map<string, DerivedNoteStatus>> {
  const summaries = await loadAppointmentNoteSummaries(appointmentIds);
  return new Map([...summaries].map(([id, s]) => [id, s.status]));
}

export type AppointmentNoteSummary = {
  status: DerivedNoteStatus;
  /** Status light input (src/lib/appointments/docLight.ts) */
  summary: VisitNoteSummary;
  /** Linked unsigned (draft) note ids, newest first */
  draftNoteIds: string[];
};

/**
 * Note status plus the co-signature facts per appointment, in one read (two queries for the
 * whole list, never one per appointment). Dismissed notes are left out.
 */
export async function loadAppointmentNoteSummaries(appointmentIds: string[]): Promise<Map<string, AppointmentNoteSummary>> {
  const out = new Map<string, AppointmentNoteSummary>();
  if (!appointmentIds.length) return out;
  const notes = await prisma.progressNote.findMany({
    // A dismissed note does not document the visit (it shows "No note" again)
    where: { appointmentId: { in: appointmentIds }, dismissedAt: null },
    select: { id: true, appointmentId: true },
    orderBy: { createdAt: 'desc' },
  });
  const wf = await loadWorkflowStatuses(notes.map((n) => n.id));
  const byAppt = new Map<string, { visit: VisitNote[]; light: Parameters<typeof summarizeVisitNotes>[0]; drafts: string[] }>();
  for (const n of notes) {
    if (!n.appointmentId) continue;
    const w = wf.get(n.id);
    const entry = byAppt.get(n.appointmentId) ?? { visit: [], light: [], drafts: [] };
    const status = w?.status ?? 'Draft';
    entry.visit.push({ status, signedAt: w?.signedAt ?? null, lockedAt: w?.lockedAt ?? null });
    entry.light.push({ status, cosignRequired: w?.cosignRequired ?? false, cosignedAt: w?.cosignedAt ?? null });
    if (status === 'Draft') entry.drafts.push(n.id);
    byAppt.set(n.appointmentId, entry);
  }
  for (const id of appointmentIds) {
    const e = byAppt.get(id);
    out.set(id, {
      status: deriveAppointmentNoteStatus(e?.visit ?? []),
      summary: summarizeVisitNotes(e?.light ?? []),
      draftNoteIds: e?.drafts ?? [],
    });
  }
  return out;
}

/** Completed appointments in the trend range with their linked note signatures. */
export async function loadVisitRows(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  sinceDays?: number;
}): Promise<VisitRow[]> {
  const since = new Date(Date.now() - (input.sinceDays ?? VISIT_DOC_TREND_DAYS) * 86_400_000);
  const orgClientWhere = clientOrgFilter(input.organizationId);
  const appts = await prisma.appointment.findMany({
    where: {
      status: 'COMPLETED',
      startsAt: { gte: since, lte: new Date() },
      client: orgClientWhere,
      // Visits imported from Valant were documented in Valant
      ...NOT_IMPORTED_HISTORY,
      ...(isCaseloadRole(input.actorRole) ? { clinicianId: input.actorUserId } : {}),
    },
    orderBy: { startsAt: 'desc' },
    select: {
      id: true,
      type: true,
      startsAt: true,
      endsAt: true,
      clinicianId: true,
      clinician: { select: { name: true, email: true, role: true } },
      client: { select: { name: true } },
      progressNotes: { where: { dismissedAt: null }, select: { id: true, part2: true } },
    },
  });
  const noteIds = appts.flatMap((a) => a.progressNotes.map((n) => n.id));
  const wf = await loadWorkflowStatuses(noteIds);
  return appts.map((a) => ({
    appointmentId: a.id,
    clinicianId: a.clinicianId,
    clinicianName: a.clinician?.name?.trim() || a.clinician?.email || null,
    clinicianRole: a.clinician?.role ?? null,
    // Part 2 protected notes: do not show the client name in the overdue list.
    clientName: a.progressNotes.some((n) => n.part2) ? 'Protected record' : a.client?.name || 'Client',
    type: a.type,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt ? a.endsAt.toISOString() : null,
    notes: a.progressNotes.map((n) => {
      const w = wf.get(n.id);
      return { status: w?.status ?? 'Draft', signedAt: w?.signedAt ?? null, lockedAt: w?.lockedAt ?? null };
    }),
  }));
}

export async function loadClinicianDocMetrics(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  days: number;
}): Promise<{ clinicians: ClinicianDocMetrics[]; windowDays: number; generatedAt: string }> {
  const visits = await loadVisitRows(input);
  const now = Date.now();
  return {
    clinicians: computeClinicianDocMetrics(visits, lastDaysWindow(input.days, now)),
    windowDays: input.days,
    generatedAt: new Date(now).toISOString(),
  };
}
