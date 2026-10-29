/**
 * Server side of "change the visit type during the visit" (rules: src/lib/appointments/visitTypeChange.ts).
 *
 * Same org scope and caseload gate as editing the appointment (appointmentOrgWhere + the visit's own
 * clinician or caseloadAllows); the route also applies canAccessClientAppointments. Updates the
 * appointment (type, in person / telehealth, length when it fits), the telehealth session's type,
 * and the POS / telehealth flags of the visit's UNSIGNED notes so the charge drafted at sign
 * follows the final visit. Never touches a signed note or a billed visit. Sends nothing anywhere
 * (no SMS / email / push): the audit row is written by the route.
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { appointmentOrgWhere } from '@/lib/appointments/duplicates';
import { findClinicianOverlaps } from '@/lib/appointments/overlap';
import { caseloadAllows } from '@/lib/clients/caseloadAccess';
import { notesForStaffUi } from '@/lib/telehealth/meta';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { formatPracticeTime } from '@/lib/time/practiceTime';
import {
  adjustEndForType,
  billingPlaceForVisit,
  canonicalVisitType,
  noteTypeForVisitType,
  visitTypeChangeBlock,
  visitTypeChoiceError,
  visitTypeOptions,
  type BillingPlace,
  type EndAdjust,
  type PracticeService,
  type VisitBlock,
  type VisitTypeOption,
} from '@/lib/appointments/visitTypeChange';

export type VisitTypeActor = { id: string; role: Role; organizationId: string };

type Fail = { ok: false; error: string; status: number; code?: string };

const apptSelect = {
  id: true,
  clientId: true,
  clinicianId: true,
  type: true,
  status: true,
  isVirtual: true,
  audioOnly: true,
  startsAt: true,
  endsAt: true,
  notes: true,
  patientLocationType: true,
  client: { select: { id: true, assignedToId: true, dateOfBirth: true } },
  clinician: { select: { role: true } },
} as const;

function ageYears(dob: Date | null | undefined, now = new Date()): number | null {
  if (!dob) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

async function practiceServices(organizationId: string): Promise<PracticeService[]> {
  const row = await prisma.schedulingSettings.findUnique({ where: { organizationId }, select: { servicesJson: true } }).catch(() => null);
  return Array.isArray(row?.servicesJson) ? (row!.servicesJson as PracticeService[]) : [];
}

async function loadGated(id: string, actor: VisitTypeActor) {
  const appt = await prisma.appointment.findFirst({ where: { id, AND: [appointmentOrgWhere(actor.organizationId)] }, select: apptSelect });
  if (!appt) return { ok: false as const, error: 'Appointment not found', status: 404 };
  // Same rule as updateAppointment: the visit's own clinician, or the client's care team
  if (appt.clinicianId !== actor.id && !(await caseloadAllows({ organizationId: actor.organizationId, userId: actor.id, role: actor.role }, appt.client))) {
    return { ok: false as const, error: 'Not your patient', status: 403 };
  }
  return { ok: true as const, appt };
}

async function blockFor(db: Prisma.TransactionClient | typeof prisma, appt: { id: string; status: string }): Promise<VisitBlock | null> {
  const notes = await db.progressNote.findMany({
    where: { appointmentId: appt.id },
    select: { id: true, dismissedAt: true, workflow: { select: { status: true } } },
  });
  const noteIds = notes.map((n) => n.id);
  const claimCount = await db.claim.count({
    where: { OR: [{ appointmentId: appt.id }, ...(noteIds.length ? [{ progressNoteId: { in: noteIds } }] : [])] },
  });
  const session = await db.telehealthSession.findUnique({ where: { appointmentId: appt.id }, select: { billingDraft: { select: { chargeRoutedAt: true } } } }).catch(() => null);
  return visitTypeChangeBlock({
    status: appt.status,
    notes: notes.map((n) => ({ workflowStatus: n.workflow?.status ?? 'DRAFT', dismissed: Boolean(n.dismissedAt) })),
    claimCount,
    chargeRouted: Boolean(session?.billingDraft?.chargeRoutedAt),
  });
}

export type VisitTypeOptionDto = VisitTypeOption & { noteType: string | null };

export type VisitTypeState = {
  appointmentId: string;
  type: string;
  isVirtual: boolean;
  audioOnly: boolean;
  status: string;
  startsAt: string;
  endsAt: string;
  options: VisitTypeOptionDto[];
  /** Why it can't change now (signed / billed / cancelled); null = it can */
  block: VisitBlock | null;
};

function optionsFor(appt: { type: string; clinician: { role: Role } | null; client: { dateOfBirth: Date | null } }, services: PracticeService[]): VisitTypeOptionDto[] {
  const role = appt.clinician?.role ?? null;
  const age = ageYears(appt.client.dateOfBirth);
  return visitTypeOptions({ clinicianRole: role, currentType: appt.type, services }).map((o) => ({
    ...o,
    noteType: noteTypeForVisitType(o.type, { clinicianRole: role, clientAgeYears: age }),
  }));
}

export async function getVisitTypeState(id: string, actor: VisitTypeActor): Promise<{ ok: true; state: VisitTypeState; error?: undefined } | Fail> {
  const g = await loadGated(id, actor);
  if (g.ok === false) return g;
  const { appt } = g;
  const [services, block] = await Promise.all([practiceServices(actor.organizationId), blockFor(prisma, appt)]);
  return {
    ok: true,
    state: {
      appointmentId: appt.id,
      type: appt.type,
      isVirtual: appt.isVirtual,
      audioOnly: appt.audioOnly,
      status: appt.status,
      startsAt: appt.startsAt.toISOString(),
      endsAt: appt.endsAt.toISOString(),
      options: optionsFor(appt, services),
      block,
    },
  };
}

export type VisitTypeChangeInput = {
  type: string;
  /** In person (false) / telehealth (true); omitted = unchanged */
  isVirtual?: boolean | null;
  /** Move the scheduled end to the new type's length when it fits (default true) */
  adjustLength?: boolean;
  reason?: string | null;
};

export type VisitTypeChangeResult = {
  ok: true;
  error?: undefined;
  clientId: string;
  before: { type: string; isVirtual: boolean; endsAt: string };
  after: { type: string; isVirtual: boolean; endsAt: string };
  changed: string[];
  length: EndAdjust & { endsAt: Date };
  place: BillingPlace;
  /** Matching note template for the new type (the editor offers the switch); null = keep */
  noteType: string | null;
  /** Unsigned notes of this visit whose POS / telehealth flags were updated */
  notesUpdated: number;
};

export async function changeVisitType(id: string, input: VisitTypeChangeInput, actor: VisitTypeActor): Promise<VisitTypeChangeResult | Fail> {
  const g = await loadGated(id, actor);
  if (g.ok === false) return g;
  const { appt } = g;

  const block = await blockFor(prisma, appt);
  if (block) return { ok: false, error: block.message, status: 409, code: block.code };

  const services = await practiceServices(actor.organizationId);
  const options = optionsFor(appt, services);
  const choiceError = visitTypeChoiceError(input.type, options);
  if (choiceError) return { ok: false, error: choiceError, status: 400 };
  const toType = canonicalVisitType(input.type, options);
  const toVirtual = input.isVirtual ?? appt.isVirtual;
  if (toType === appt.type && toVirtual === appt.isVirtual) return { ok: false, error: 'Nothing to change: same visit type and setting.', status: 400 };

  // Length: only when the type changes, and only if it doesn't run into the clinician's next visit
  const option = options.find((o) => o.type === toType);
  let length: EndAdjust = { endsAt: appt.endsAt, adjusted: false, collision: false, message: null };
  if (toType !== appt.type && input.adjustLength !== false && option?.durationMin) {
    const target = new Date(appt.startsAt.getTime() + option.durationMin * 60_000);
    const conflicts =
      appt.clinicianId && target > appt.endsAt
        ? await findClinicianOverlaps(prisma, { organizationId: actor.organizationId, clinicianId: appt.clinicianId, start: appt.endsAt, end: target, excludeIds: [appt.id] })
        : [];
    const timeZone = await getPracticeTimeZone(actor.organizationId);
    length = adjustEndForType({
      startsAt: appt.startsAt,
      endsAt: appt.endsAt,
      durationMin: option.durationMin,
      nextStartsAt: conflicts[0]?.startsAt ?? null,
      formatTime: (d) => formatPracticeTime(d, timeZone),
    });
  }

  const settings = await prisma.practiceSettings
    .findUnique({ where: { organizationId: actor.organizationId }, select: { posOffice: true, posTelehealthHome: true, posTelehealthOther: true } })
    .catch(() => null);
  const session = await prisma.telehealthSession.findUnique({ where: { appointmentId: appt.id }, select: { id: true, patientLocationType: true } }).catch(() => null);
  const audioOnly = toVirtual ? appt.audioOnly : false;
  const place = billingPlaceForVisit({
    isVirtual: toVirtual,
    audioOnly,
    patientLocationType: appt.patientLocationType ?? session?.patientLocationType ?? null,
    settings,
  });

  const actorUser = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }).catch(() => null);
  const changed: string[] = [];
  const data: Prisma.AppointmentUpdateInput = {};
  if (toType !== appt.type) {
    data.type = toType;
    changed.push('type');
  }
  if (toVirtual !== appt.isVirtual) {
    data.isVirtual = toVirtual;
    changed.push('isVirtual');
    if (!toVirtual) {
      // Now in person: drop the hidden video-room block (same as Edit Details) and the audio-only flag
      data.audioOnly = false;
      const visible = notesForStaffUi(appt.notes) || null;
      if (visible !== appt.notes) data.notes = visible;
    }
  }
  if (length.adjusted) {
    data.endsAt = length.endsAt;
    changed.push('endsAt');
  }
  data.lastChangedById = actor.id;
  data.lastChangedByName = actorUser?.name ?? null;
  data.lastChangedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // Re-check inside the write: a note signed or a claim drafted since the read stops the change
    const again = await blockFor(tx, appt);
    if (again) return { blocked: again } as const;
    await tx.appointment.update({ where: { id: appt.id }, data });
    if (session && changed.includes('type')) {
      await tx.telehealthSession.update({ where: { id: session.id }, data: { type: toType } });
    }
    let notesUpdated = 0;
    if (changed.includes('isVirtual')) {
      // Unsigned notes of this visit: POS / telehealth follow, so the claim drafted at sign does too
      const drafts = await tx.progressNote.findMany({
        where: { appointmentId: appt.id, dismissedAt: null, OR: [{ workflow: null }, { workflow: { status: 'DRAFT' } }] },
        select: { id: true },
      });
      if (drafts.length) {
        const r = await tx.progressNote.updateMany({
          where: { id: { in: drafts.map((d) => d.id) } },
          data: { telehealth: place.telehealth, placeOfService: place.placeOfService, audioOnly: place.audioOnly },
        });
        notesUpdated = r.count;
      }
    }
    return { notesUpdated } as const;
  });
  if ('blocked' in result) return { ok: false, error: result.blocked.message, status: 409, code: result.blocked.code };

  return {
    ok: true,
    clientId: appt.clientId,
    before: { type: appt.type, isVirtual: appt.isVirtual, endsAt: appt.endsAt.toISOString() },
    after: { type: toType, isVirtual: toVirtual, endsAt: length.endsAt.toISOString() },
    changed,
    length,
    place,
    noteType: changed.includes('type') ? option?.noteType ?? null : null,
    notesUpdated: result.notesUpdated,
  };
}
