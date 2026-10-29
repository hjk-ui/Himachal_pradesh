import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { fromPracticeWallTime, toPracticeWallTime } from '@/lib/time/practiceTime';
import { appointmentOrgWhere, findDuplicateAppointment } from '@/lib/appointments/duplicates';
import { findClinicianOverlaps } from '@/lib/appointments/overlap';
import { clientByIdWhere } from '@/lib/clients/orgScope';
import { isCaseloadRole } from '@/types/roles';
import { createAppointment, updateAppointment, type CreateAppointmentInput } from '@/lib/appointments/manage';
import { addDaysYmd } from '@/lib/scheduling/slots';
import {
  occurrenceInstants,
  validateRecurrence,
  type RecurrenceRule,
} from '@/lib/scheduling/recurrence';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';
import { caseloadAllows } from '@/lib/clients/caseloadAccess';

/**
 * Recurring appointment series. Every occurrence is booked through createAppointment, so each one
 * gets the same checks as a single booking (client access, exact duplicate, clinician overlap,
 * label, telehealth room). An occurrence that conflicts is SKIPPED and reported (date + reason);
 * the others are booked. Only the first occurrence sends the confirmation email / SMS / push.
 *
 * Edits: "this occurrence" is the ordinary PATCH /api/appointments/[id]. "This and following" and
 * "entire series" move every future SCHEDULED occurrence in scope to the new wall-clock time /
 * clinician / type (DST-safe: 9:00 AM stays 9:00 AM); occurrences that would conflict stay as they
 * were and are reported. Cancel scopes cancel the occurrences in scope (status CANCELLED).
 */

export type SeriesActor = { id: string; role: Role; organizationId: string };

export type SeriesBookingInput = Omit<CreateAppointmentInput, 'startsAt' | 'endsAt' | 'date' | 'startTime' | 'endTime' | 'seriesId' | 'suppressNotifications'> & {
  rule: RecurrenceRule;
  location?: string | null;
};

export type SkippedOccurrence = {
  date: string;
  startsAt: string;
  reason: 'clinician_overlap' | 'duplicate' | 'in_past' | 'error';
  conflictIds?: string[];
  error?: string;
};

export type OccurrencePreview = { date: string; startsAt: string; endsAt: string; conflict: SkippedOccurrence['reason'] | null; conflictIds?: string[] };

/** Dates + conflicts, no writes (the form shows this before booking). */
export async function previewSeries(input: SeriesBookingInput, actor: SeriesActor) {
  const invalid = validateRecurrence(input.rule);
  if (invalid) return { ok: false as const, status: 400, error: invalid };
  const tz = await getPracticeTimeZone(actor.organizationId);
  const clinicianId = input.clinicianId ?? null;
  const now = Date.now();
  const out: OccurrencePreview[] = [];
  for (const o of occurrenceInstants(input.rule, tz)) {
    let conflict: OccurrencePreview['conflict'] = null;
    let conflictIds: string[] | undefined;
    if (o.start.getTime() < now) conflict = 'in_past';
    else if (clinicianId) {
      const dup = await findDuplicateAppointment(prisma, {
        organizationId: actor.organizationId,
        clientId: input.clientId,
        clinicianId,
        startsAt: o.start,
      });
      if (dup) {
        conflict = 'duplicate';
        conflictIds = [dup.id];
      } else if (!input.allowOverbook) {
        const c = await findClinicianOverlaps(prisma, { organizationId: actor.organizationId, clinicianId, start: o.start, end: o.end });
        if (c.length) {
          conflict = 'clinician_overlap';
          conflictIds = c.map((x) => x.id);
        }
      }
    }
    out.push({ date: o.date, startsAt: o.start.toISOString(), endsAt: o.end.toISOString(), conflict, conflictIds });
  }
  return { ok: true as const, timeZone: tz, occurrences: out };
}

export async function createSeries(input: SeriesBookingInput, actor: SeriesActor) {
  const invalid = validateRecurrence(input.rule);
  if (invalid) return { ok: false as const, status: 400, error: invalid };

  const client = await prisma.client.findFirst({
    where: clientByIdWhere(input.clientId, actor.organizationId),
    select: { id: true, assignedToId: true, status: true },
  });
  if (!client) return { ok: false as const, status: 404, error: 'Client not found' };
  if (!(await caseloadAllows({ organizationId: actor.organizationId, userId: actor.id, role: actor.role }, client))) {
    return { ok: false as const, status: 403, error: 'Not your patient' };
  }
  // Same default as createAppointment: a caseload clinician books themselves unless they pick someone
  const clinicianId = isCaseloadScoped({ role: actor.role, userId: actor.id, organizationId: actor.organizationId })
    ? input.clinicianId || actor.id
    : isCaseloadRole(actor.role)
      ? input.clinicianId || client.assignedToId || actor.id
      : input.clinicianId || client.assignedToId;
  if (!clinicianId) return { ok: false as const, status: 400, error: 'Clinician is required for this appointment' };

  const tz = await getPracticeTimeZone(actor.organizationId);
  const occurrences = occurrenceInstants(input.rule, tz);
  if (!occurrences.length) return { ok: false as const, status: 400, error: 'The repeat rule produces no visits' };

  const series = await prisma.appointmentSeries.create({
    data: {
      organizationId: actor.organizationId,
      clientId: client.id,
      clinicianId,
      type: String(input.type).trim(),
      frequency: input.rule.frequency,
      interval: input.rule.interval ?? 1,
      byWeekday: input.rule.byWeekday ?? [],
      startDate: new Date(`${input.rule.startDate}T00:00:00Z`),
      endDate: input.rule.endDate ? new Date(`${input.rule.endDate}T00:00:00Z`) : null,
      count: input.rule.count ?? null,
      startTime: input.rule.startTime,
      durationMinutes: input.rule.durationMinutes,
      isVirtual: Boolean(input.isVirtual),
      audioOnly: Boolean(input.isVirtual && input.audioOnly),
      labelId: input.labelId ?? null,
      location: input.location?.trim() || null,
      createdBy: actor.id,
    },
  });

  const created: { id: string; date: string; startsAt: string }[] = [];
  const skipped: SkippedOccurrence[] = [];
  const now = Date.now();
  for (const o of occurrences) {
    if (o.start.getTime() < now) {
      skipped.push({ date: o.date, startsAt: o.start.toISOString(), reason: 'in_past' });
      continue;
    }
    const r = await createAppointment(
      {
        ...input,
        clinicianId,
        startsAt: o.start.toISOString(),
        endsAt: o.end.toISOString(),
        seriesId: series.id,
        suppressNotifications: created.length > 0,
        allowDuplicate: false,
      },
      actor.id,
      actor.organizationId,
      actor.role
    );
    if (r.ok) {
      created.push({ id: r.appointment.id, date: o.date, startsAt: r.appointment.startsAt });
    } else if ('code' in r && r.code === 'CLINICIAN_OVERLAP') {
      skipped.push({ date: o.date, startsAt: o.start.toISOString(), reason: 'clinician_overlap', conflictIds: r.conflictIds });
    } else if ('code' in r && r.code === 'DUPLICATE_APPOINTMENT') {
      skipped.push({ date: o.date, startsAt: o.start.toISOString(), reason: 'duplicate', conflictIds: [r.existingId] });
    } else {
      // Same failure for every occurrence (client discharged, clinician not found, ...): stop.
      if (!created.length) {
        await prisma.appointmentSeries.delete({ where: { id: series.id } }).catch(() => {});
        return { ok: false as const, status: r.status ?? 400, error: r.error };
      }
      skipped.push({ date: o.date, startsAt: o.start.toISOString(), reason: 'error', error: r.error });
    }
  }
  if (!created.length) {
    await prisma.appointmentSeries.delete({ where: { id: series.id } }).catch(() => {});
    return { ok: false as const, status: 409, error: 'Every visit in this series conflicts with another appointment', skipped };
  }
  return { ok: true as const, seriesId: series.id, created, skipped, timeZone: tz };
}

export type SeriesScope = 'this' | 'following' | 'all';

async function loadScope(seriesId: string, anchorAppointmentId: string, scope: SeriesScope, actor: SeriesActor) {
  const series = await prisma.appointmentSeries.findFirst({ where: { id: seriesId, organizationId: actor.organizationId } });
  if (!series) return { ok: false as const, status: 404, error: 'Series not found' };
  const anchor = await prisma.appointment.findFirst({
    where: { id: anchorAppointmentId, seriesId, AND: [appointmentOrgWhere(actor.organizationId)] },
    include: { client: { select: { id: true, assignedToId: true } } },
  });
  if (!anchor) return { ok: false as const, status: 404, error: 'Appointment not found in this series' };
  // The series' own clinician, or anyone on the client's care team (same rule as the chart)
  if (anchor.clinicianId !== actor.id && !(await caseloadAllows({ organizationId: actor.organizationId, userId: actor.id, role: actor.role }, anchor.client))) {
    return { ok: false as const, status: 403, error: 'Not your patient' };
  }
  const now = new Date();
  const targets =
    scope === 'this'
      ? [anchor]
      : await prisma.appointment.findMany({
          where: {
            seriesId,
            status: 'SCHEDULED',
            startsAt: { gte: scope === 'following' ? anchor.startsAt : now },
          },
          orderBy: { startsAt: 'asc' },
        });
  return { ok: true as const, series, anchor, targets };
}

export type SeriesChanges = {
  /** HH:mm practice wall clock for every occurrence in scope */
  startTime?: string | null;
  durationMinutes?: number | null;
  clinicianId?: string | null;
  type?: string | null;
  isVirtual?: boolean | null;
  audioOnly?: boolean | null;
  allowOverbook?: boolean;
  overbookReason?: string | null;
};

export async function editSeries(
  seriesId: string,
  anchorAppointmentId: string,
  scope: Exclude<SeriesScope, 'this'>,
  changes: SeriesChanges,
  actor: SeriesActor
) {
  const loaded = await loadScope(seriesId, anchorAppointmentId, scope, actor);
  if (loaded.ok === false) return loaded;
  const { series, anchor, targets } = loaded;
  if (changes.startTime != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(changes.startTime)) {
    return { ok: false as const, status: 400, error: 'Start time must be HH:mm' };
  }
  if (changes.durationMinutes != null && (!Number.isInteger(changes.durationMinutes) || changes.durationMinutes < 5 || changes.durationMinutes > 480)) {
    return { ok: false as const, status: 400, error: 'Duration must be 5 to 480 minutes' };
  }
  const tz = await getPracticeTimeZone(actor.organizationId);

  // "This and following": the edited occurrences become their own series from the anchor date on;
  // the original series ends the day before. "Entire series": the series row itself changes.
  let targetSeriesId = series.id;
  const anchorDate = toPracticeWallTime(anchor.startsAt, tz).date;
  const seriesPatch = {
    ...(changes.startTime ? { startTime: changes.startTime } : {}),
    ...(changes.durationMinutes ? { durationMinutes: changes.durationMinutes } : {}),
    ...(changes.clinicianId ? { clinicianId: changes.clinicianId } : {}),
    ...(changes.type ? { type: changes.type.trim() } : {}),
    ...(changes.isVirtual != null ? { isVirtual: changes.isVirtual } : {}),
    ...(changes.audioOnly != null ? { audioOnly: changes.audioOnly } : {}),
  };
  if (scope === 'following' && toPracticeWallTime(series.startDate, 'UTC').date < anchorDate) {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = series;
    const split = await prisma.appointmentSeries.create({
      data: { ...rest, ...seriesPatch, startDate: new Date(`${anchorDate}T00:00:00Z`), count: null, createdBy: actor.id },
    });
    await prisma.appointmentSeries.update({
      where: { id: series.id },
      data: { endDate: new Date(`${addDaysYmd(anchorDate, -1)}T00:00:00Z`), count: null },
    });
    targetSeriesId = split.id;
  } else {
    await prisma.appointmentSeries.update({ where: { id: series.id }, data: seriesPatch });
  }

  const ids = targets.map((t) => t.id);
  const updated: string[] = [];
  const unchanged: { id: string; date: string; reason: string; conflictIds?: string[] }[] = [];
  for (const t of targets) {
    const wall = toPracticeWallTime(t.startsAt, tz);
    const duration = changes.durationMinutes ?? Math.round((t.endsAt.getTime() - t.startsAt.getTime()) / 60_000);
    const start = fromPracticeWallTime(wall.date, changes.startTime ?? wall.time, tz);
    if (!start) {
      unchanged.push({ id: t.id, date: wall.date, reason: 'invalid_time' });
      continue;
    }
    const end = new Date(start.getTime() + duration * 60_000);
    const r = await updateAppointment(
      t.id,
      {
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        clinicianId: changes.clinicianId ?? undefined,
        type: changes.type ?? undefined,
        isVirtual: changes.isVirtual ?? undefined,
        audioOnly: changes.audioOnly ?? undefined,
        allowOverbook: changes.allowOverbook,
        overbookReason: changes.overbookReason,
        overlapExcludeIds: ids,
        seriesId: targetSeriesId !== series.id ? targetSeriesId : undefined,
      },
      actor
    );
    if (r.ok) updated.push(t.id);
    else
      unchanged.push({
        id: t.id,
        date: wall.date,
        reason: 'code' in r && r.code === 'CLINICIAN_OVERLAP' ? 'clinician_overlap' : 'code' in r && r.code === 'DUPLICATE_APPOINTMENT' ? 'duplicate' : r.error,
        conflictIds: 'conflictIds' in r ? (r.conflictIds as string[]) : undefined,
      });
  }
  return { ok: true as const, seriesId: targetSeriesId, updated, unchanged };
}

export async function cancelSeries(
  seriesId: string,
  anchorAppointmentId: string,
  scope: SeriesScope,
  actor: SeriesActor
) {
  const loaded = await loadScope(seriesId, anchorAppointmentId, scope, actor);
  if (loaded.ok === false) return loaded;
  const { series, anchor, targets } = loaded;
  const cancelled: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const t of targets) {
    if (t.status !== 'SCHEDULED' && t.status !== 'CHECKED_IN') continue;
    const r = await updateAppointment(t.id, { visitStatus: 'cancelled' }, actor);
    if (r.ok) cancelled.push(t.id);
    else failed.push({ id: t.id, error: r.error });
  }
  if (scope === 'all') {
    await prisma.appointmentSeries.update({ where: { id: series.id }, data: { status: 'cancelled' } });
  } else if (scope === 'following') {
    const tz = await getPracticeTimeZone(actor.organizationId);
    const anchorDate = toPracticeWallTime(anchor.startsAt, tz).date;
    await prisma.appointmentSeries.update({
      where: { id: series.id },
      data: { endDate: new Date(`${addDaysYmd(anchorDate, -1)}T00:00:00Z`), status: 'ended' },
    });
  }
  return { ok: true as const, cancelled, failed };
}
