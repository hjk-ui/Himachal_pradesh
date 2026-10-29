import type {
  AppointmentNoteStatus,
  AppointmentStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { isCaseloadRole } from '@/types/roles';
import type { AppointmentType } from '@/features/appointments';
import { canAccessClientAppointments, clientByIdWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import {
  notesForStaffUi,
  parseTelehealthMeta,
  staffHostMeetingUrl,
  writeTelehealthMeta,
  type TelehealthMeta,
} from '@/lib/telehealth/meta';
import { clientTelehealthJoinUrl } from '@/lib/telehealth/joinUrl';
import { provisionTelehealthMeeting } from '@/lib/telehealth/meeting';
import {
  sendAppointmentCreatedEmail,
  sendAppointmentCreatedSms,
  sendAppointmentDeclinedEmail,
  sendAppointmentDeclinedSms,
} from '@/patient';
import { sendToUser } from '@/lib/notifications/pushService';
import { formatBookedByLabel, formatLastChangedBy } from '@/lib/appointments/bookedBy';

export type VisitStatusUi =
  | 'scheduled'
  | 'checked-in'
  | 'in-session'
  | 'completed'
  | 'cancelled'
  | 'no-show'
  | 'late-cancel';

export type NoteStatusUi = 'not-started' | 'ai-draft' | 'in-progress' | 'signed';

const UI_STATUS: Record<AppointmentStatus, VisitStatusUi> = {
  SCHEDULED: 'scheduled',
  CHECKED_IN: 'checked-in',
  IN_SESSION: 'in-session',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no-show',
  LATE_CANCEL: 'late-cancel',
};

const DB_STATUS: Record<string, AppointmentStatus> = {
  scheduled: 'SCHEDULED',
  'checked-in': 'CHECKED_IN',
  'in-session': 'IN_SESSION',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  'no-show': 'NO_SHOW',
  'late-cancel': 'LATE_CANCEL',
  SCHEDULED: 'SCHEDULED',
  CHECKED_IN: 'CHECKED_IN',
  IN_SESSION: 'IN_SESSION',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
  LATE_CANCEL: 'LATE_CANCEL',
};

const UI_NOTE: Record<AppointmentNoteStatus, NoteStatusUi> = {
  NOT_STARTED: 'not-started',
  AI_DRAFT: 'ai-draft',
  IN_PROGRESS: 'in-progress',
  SIGNED: 'signed',
};

const DB_NOTE: Record<string, AppointmentNoteStatus> = {
  'not-started': 'NOT_STARTED',
  'ai-draft': 'AI_DRAFT',
  'in-progress': 'IN_PROGRESS',
  signed: 'SIGNED',
  NOT_STARTED: 'NOT_STARTED',
  AI_DRAFT: 'AI_DRAFT',
  IN_PROGRESS: 'IN_PROGRESS',
  SIGNED: 'SIGNED',
};

/** Allowed visit transitions (UI keys). */
export const VISIT_TRANSITIONS: Record<VisitStatusUi, VisitStatusUi[]> = {
  scheduled: ['checked-in', 'no-show', 'cancelled', 'late-cancel'],
  'checked-in': ['in-session', 'no-show', 'cancelled'],
  'in-session': ['completed'],
  completed: [],
  'no-show': [],
  cancelled: [],
  'late-cancel': [],
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function localDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTime(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function serialize(a: {
  id: string;
  clientId: string;
  clientName: string | null;
  type: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  noteStatus: AppointmentNoteStatus;
  isVirtual: boolean;
  notes: string | null;
  clinicianId: string | null;
  clinicianName: string | null;
  organizationId: string | null;
  insurancePayer?: string | null;
  client: { name: string; image: string | null; insurancePayer?: string | null };
  clinician: { name: string | null } | null;
  patientBooked?: boolean;
  rescheduleNote?: string | null;
  createdVia?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  lastChangedById?: string | null;
  lastChangedByName?: string | null;
  lastChangedAt?: Date | null;
  createdAt?: Date;
}) {
  const meta = parseTelehealthMeta(a.notes);
  const clientJoinUrl = a.isVirtual
    ? clientTelehealthJoinUrl({
        appointmentId: a.id,
        clientId: a.clientId,
        endsAt: a.endsAt,
        meta,
      })
    : null;
  const hostJoinUrl = a.isVirtual
    ? staffHostMeetingUrl(meta) || clientJoinUrl
    : null;
  return {
    id: a.id,
    clientId: a.clientId,
    clientName: a.clientName?.trim() || a.client.name,
    clientImage: a.client.image,
    clinicianId: a.clinicianId,
    clinicianName: a.clinicianName?.trim() || a.clinician?.name || null,
    organizationId: a.organizationId,
    type: a.type,
    date: localDate(a.startsAt),
    startTime: localTime(a.startsAt),
    endTime: localTime(a.endsAt),
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: UI_STATUS[a.status],
    noteStatus: UI_NOTE[a.noteStatus],
    isVirtual: a.isVirtual,
    videoProvider: a.isVirtual ? meta.provider || 'in_app' : null,
    hostJoinUrl,
    clientJoinUrl,
    notes: notesForStaffUi(a.notes),
    patientBooked: Boolean(a.patientBooked),
    createdVia: a.createdVia || (a.patientBooked ? 'online' : 'staff'),
    createdByName: a.createdByName || null,
    lastChangedByName: a.lastChangedByName || null,
    lastChangedAt: a.lastChangedAt?.toISOString() || null,
    bookedByLabel: formatBookedByLabel({
      createdVia: a.createdVia,
      createdByName: a.createdByName,
      createdAt: a.createdAt,
      patientBooked: a.patientBooked,
    }),
    lastChangedByLabel: formatLastChangedBy({
      lastChangedByName: a.lastChangedByName,
      lastChangedAt: a.lastChangedAt,
    }),
    insurancePayer: a.insurancePayer?.trim() || a.client.insurancePayer?.trim() || null,
    payerHint: a.insurancePayer?.trim() || a.client.insurancePayer?.trim() || null,
    declineReason: a.status === 'CANCELLED' ? (a.rescheduleNote || null) : null,
  };
}

export type AppointmentDto = ReturnType<typeof serialize>;

export type CreateAppointmentInput = {
  clientId: string;
  type: AppointmentType | string;
  date: string;
  startTime: string;
  endTime?: string | null;
  isVirtual?: boolean;
  notes?: string | null;
  clinicianId?: string | null;
  videoProvider?: 'zoom' | 'google' | 'in_app' | null;
  /** Optional override — defaults to staff */
  createdVia?: 'staff' | 'group' | 'online' | 'portal' | 'import';
};

const include = {
  client: { select: { name: true, image: true, email: true, phone: true, insurancePayer: true } },
  clinician: { select: { name: true } },
} as const;

export function appointmentOrgWhere(organizationId: string): Prisma.AppointmentWhereInput {
  return {
    OR: [{ organizationId }, { client: clientOrgFilter(organizationId) }],
  };
}

export async function listAppointmentsForUser(
  actor: {
    id: string;
    role: Role;
    organizationId: string;
  },
  options?: { clientId?: string; isVirtual?: boolean; date?: string }
) {
  if (!canAccessClientAppointments(actor.role)) {
    return [];
  }

  const orgFilter = appointmentOrgWhere(actor.organizationId);

  // Caseload clinicians only see appointments for patients assigned to them.
  let where: Prisma.AppointmentWhereInput = isCaseloadRole(actor.role)
    ? { AND: [orgFilter, { client: { assignedToId: actor.id } }] }
    : orgFilter;

  if (options?.clientId) {
    const client = await prisma.client.findFirst({
      where: clientByIdWhere(options.clientId, actor.organizationId),
      select: { id: true, assignedToId: true },
    });

    if (!client) return [];

    if (isCaseloadRole(actor.role) && client.assignedToId !== actor.id) {
      return [];
    }

    where = { AND: [orgFilter, { clientId: options.clientId }] };
  }

  if (options?.isVirtual) {
    where = { AND: [where, { isVirtual: true }] };
  }
  if (options?.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    const dayStart = new Date(`${options.date}T00:00:00`);
    const dayEnd = new Date(`${options.date}T23:59:59.999`);
    where = { AND: [where, { startsAt: { gte: dayStart, lte: dayEnd } }] };
  }

  const rows = await prisma.appointment.findMany({
    where,
    orderBy: { startsAt: options?.clientId ? 'desc' : 'asc' },
    include,
  });

  return rows.map(serialize);
}

export async function createAppointment(
  input: CreateAppointmentInput,
  actorUserId: string,
  organizationId: string,
  actorRole: Role
) {
  const client = await prisma.client.findFirst({
    where: clientByIdWhere(input.clientId, organizationId),
  });
  if (!client) {
    return { ok: false as const, error: 'Client not found', status: 404 };
  }
  if (isCaseloadRole(actorRole) && client.assignedToId !== actorUserId) {
    return { ok: false as const, error: 'Not your patient', status: 403 };
  }
  if (client.status === 'DISCHARGED') {
    return {
      ok: false as const,
      error: 'Cannot schedule for a discharged client',
      status: 400,
    };
  }

  const start = new Date(`${input.date}T${input.startTime}:00`);
  if (Number.isNaN(start.getTime())) {
    return { ok: false as const, error: 'Invalid date/time', status: 400 };
  }

  let end: Date;
  if (input.endTime) {
    end = new Date(`${input.date}T${input.endTime}:00`);
  } else {
    end = new Date(start.getTime() + 50 * 60 * 1000);
  }
  if (Number.isNaN(end.getTime()) || end <= start) {
    return { ok: false as const, error: 'End time must be after start', status: 400 };
  }

  const type = input.type.trim();
  if (!type) {
    return { ok: false as const, error: 'Appointment type is required', status: 400 };
  }

  const clinicianId = isCaseloadRole(actorRole)
    ? input.clinicianId || client.assignedToId || actorUserId
    : input.clinicianId || client.assignedToId;
  if (!clinicianId) {
    return {
      ok: false as const,
      error: 'Clinician is required for this appointment',
      status: 400,
    };
  }

  const [clinician, actor] = await Promise.all([
    prisma.user.findFirst({
      where: {
        id: clinicianId,
        organizationId,
        status: { in: ['ACTIVE', 'INVITED'] },
      },
    }),
    prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, name: true },
    }),
  ]);
  if (!clinician) {
    return { ok: false as const, error: 'Clinician not found in your organization', status: 400 };
  }
  const effectiveClinicianId = clinician.id;
  const via =
    input.createdVia ||
    (/group/i.test(type) ? 'group' : 'staff');

  let notes = input.notes?.trim() || null;
  let telehealthMeta: TelehealthMeta | null = null;
  if (input.isVirtual) {
    const provider = input.videoProvider || 'in_app';
    let meta: TelehealthMeta = { provider };
    if (provider === 'zoom' || provider === 'google') {
      try {
        const meeting = await provisionTelehealthMeeting({
          platform: provider === 'google' ? 'GOOGLE' : 'ZOOM',
          topic: `${type} — ${client.name}`,
          startAt: start,
          durationMin: Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000)),
        });
        if (provider === 'zoom') {
          meta = {
            ...meta,
            zoomMeetingId: meeting.roomId,
            zoomJoinUrl: meeting.joinUrl,
            zoomStartUrl: meeting.hostUrl,
          };
        } else {
          meta = {
            ...meta,
            googleEventId: meeting.roomId,
            googleMeetJoinUrl: meeting.joinUrl,
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not create meeting';
        return { ok: false as const, error: message, status: 400 };
      }
    }
    telehealthMeta = meta;
    notes = writeTelehealthMeta(notes, meta);
  }

  const row = await prisma.appointment.create({
    data: {
      organizationId,
      clientId: input.clientId,
      clientName: client.name,
      clinicianId: effectiveClinicianId,
      clinicianName: clinician.name,
      type,
      startsAt: start,
      endsAt: end,
      status: 'SCHEDULED',
      noteStatus: 'NOT_STARTED',
      isVirtual: Boolean(input.isVirtual),
      notes,
      // Payer hint from client chart — never invent a payer name
      insurancePayer: client.insurancePayer?.trim() || null,
      patientBooked: via === 'online' || via === 'portal',
      createdVia: via,
      createdById: actorUserId,
      createdByName: actor?.name || null,
    },
    include,
  });

  const appointment = serialize(row);
  const joinUrl =
    appointment.isVirtual && telehealthMeta
      ? clientTelehealthJoinUrl({
          appointmentId: row.id,
          clientId: row.clientId,
          endsAt: row.endsAt,
          meta: telehealthMeta,
        })
      : null;
  const clientEmail = client.email?.trim();
  if (clientEmail) {
    try {
      await sendAppointmentCreatedEmail({
        to: clientEmail,
        clientName: appointment.clientName,
        type: appointment.type,
        date: appointment.date,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        isVirtual: appointment.isVirtual,
        clinicianName: appointment.clinicianName,
        videoProvider: input.isVirtual ? input.videoProvider || 'in_app' : null,
        joinUrl,
      });
    } catch (err) {
      console.error('[appointments] confirmation email failed', err);
    }
  }

  const clientPhone = client.phone?.trim();
  if (clientPhone) {
    try {
      await sendAppointmentCreatedSms({
        to: clientPhone,
        clientId: client.id,
        clinicianName: appointment.clinicianName,
        type: appointment.type,
        date: appointment.date,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        isVirtual: appointment.isVirtual,
        joinUrl,
      });
    } catch (err) {
      console.error('[appointments] confirmation sms failed', err);
    }
  }

  // Mobile App Push Notification with exact appointment timing
  try {
    const docName = appointment.clinicianName || 'Your clinician';
    const isVirt = Boolean(appointment.isVirtual);
    void sendToUser(input.clientId, {
      type: 'appointment_reminder',
      title: `${isVirt ? 'Telehealth' : 'Clinic'} Appointment Scheduled · ${docName}`,
      body: `Your ${appointment.type} appointment with ${docName} is confirmed for ${appointment.date} at ${appointment.startTime}.`,
      data: {
        type: 'appointment_reminder',
        appointmentId: row.id,
        date: appointment.date,
        startTime: appointment.startTime,
        endTime: appointment.endTime || '',
        isVirtual: String(isVirt),
        doctorName: docName,
        joinUrl: joinUrl || '',
      },
    }).catch((pushErr) => {
      console.warn('[push] Appointment created push note:', pushErr);
    });
  } catch {
    /* ignore */
  }

  return { ok: true as const, appointment };
}

export async function confirmPatientAppointment(
  id: string,
  actor: { id: string; role: Role; organizationId: string }
) {
  const existing = await prisma.appointment.findFirst({
    where: { id, AND: [appointmentOrgWhere(actor.organizationId)] },
    include: {
      client: { select: { id: true, name: true, email: true, phone: true, assignedToId: true } },
      clinician: { select: { name: true } },
    },
  });
  if (!existing) {
    return { ok: false as const, error: 'Appointment not found', status: 404 };
  }

  if (isCaseloadRole(actor.role) && existing.client.assignedToId !== actor.id) {
    return { ok: false as const, error: 'Not your patient', status: 403 };
  }

  const row = await prisma.appointment.update({
    where: { id },
    data: {
      patientBooked: false,
      rescheduleRequestedAt: null,
      rescheduleNote: null,
    },
    include,
  });

  const appointment = serialize(row);

  const clientEmail = existing.client.email?.trim();
  if (clientEmail) {
    try {
      await sendAppointmentCreatedEmail({
        to: clientEmail,
        clientName: appointment.clientName,
        type: appointment.type,
        date: appointment.date,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        isVirtual: appointment.isVirtual,
        clinicianName: appointment.clinicianName,
        videoProvider: appointment.videoProvider === 'zoom' || appointment.videoProvider === 'google' ? appointment.videoProvider : 'in_app',
        joinUrl: appointment.clientJoinUrl,
      });
    } catch (err) {
      console.warn('[appointments] Confirm email failed:', err);
    }
  }

  const clientPhone = existing.client.phone?.trim();
  if (clientPhone) {
    try {
      await sendAppointmentCreatedSms({
        to: clientPhone,
        clientId: existing.clientId,
        clinicianName: appointment.clinicianName,
        type: appointment.type,
        date: appointment.date,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        isVirtual: appointment.isVirtual,
        joinUrl: appointment.clientJoinUrl,
      });
    } catch (err) {
      console.warn('[appointments] Confirm SMS failed:', err);
    }
  }

  try {
    const docName = appointment.clinicianName || 'Your clinician';
    void sendToUser(existing.clientId, {
      type: 'appointment_reminder',
      title: `Appointment Confirmed · ${docName}`,
      body: `Dr. ${docName} has confirmed your appointment for ${appointment.date} at ${appointment.startTime}.`,
      data: {
        type: 'appointment_confirmed',
        appointmentId: row.id,
        date: appointment.date,
        startTime: appointment.startTime,
        doctorName: docName,
      },
    }).catch(() => {});
  } catch {}

  return { ok: true as const, appointment };
}

export async function declinePatientAppointment(
  id: string,
  reason: string,
  actor: { id: string; role: Role; organizationId: string }
) {
  const existing = await prisma.appointment.findFirst({
    where: { id, AND: [appointmentOrgWhere(actor.organizationId)] },
    include: {
      client: { select: { id: true, name: true, email: true, phone: true, assignedToId: true } },
      clinician: { select: { name: true } },
    },
  });
  if (!existing) {
    return { ok: false as const, error: 'Appointment not found', status: 404 };
  }

  if (isCaseloadRole(actor.role) && existing.client.assignedToId !== actor.id) {
    return { ok: false as const, error: 'Not your patient', status: 403 };
  }

  const cleanReason = (reason || '').trim().slice(0, 500) || 'Declined by clinician';

  const row = await prisma.appointment.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      patientBooked: false,
      rescheduleRequestedAt: null,
      rescheduleNote: cleanReason,
      notes: cleanReason
        ? `${existing.notes || ''}\nDecline Reason: ${cleanReason}`.trim()
        : existing.notes,
    },
    include,
  });

  const appointment = serialize(row);

  const clientEmail = existing.client.email?.trim();
  if (clientEmail) {
    try {
      await sendAppointmentDeclinedEmail({
        to: clientEmail,
        clientName: appointment.clientName,
        type: appointment.type,
        date: appointment.date,
        startTime: appointment.startTime,
        clinicianName: appointment.clinicianName,
        reason: cleanReason,
      });
    } catch (err) {
      console.warn('[appointments] Decline email failed:', err);
    }
  }

  const clientPhone = existing.client.phone?.trim();
  if (clientPhone) {
    try {
      await sendAppointmentDeclinedSms({
        to: clientPhone,
        clinicianName: appointment.clinicianName,
        date: appointment.date,
        startTime: appointment.startTime,
        reason: cleanReason,
      });
    } catch (err) {
      console.warn('[appointments] Decline SMS failed:', err);
    }
  }

  try {
    const docName = appointment.clinicianName || 'Your clinician';
    void sendToUser(existing.clientId, {
      type: 'appointment_reminder',
      title: `Appointment Declined · ${docName}`,
      body: `Dr. ${docName} declined your meeting request: "${cleanReason}"`,
      data: {
        type: 'appointment_declined',
        appointmentId: row.id,
        date: appointment.date,
        startTime: appointment.startTime,
        doctorName: docName,
        reason: cleanReason,
      },
    }).catch(() => {});
  } catch {}

  return { ok: true as const, appointment };
}

export async function updateAppointment(
  id: string,
  patch: {
    visitStatus?: string | null;
    noteStatus?: string | null;
    notes?: string | null;
    /** @deprecated use visitStatus */
    status?: string | null;
    action?: 'confirm' | 'decline' | null;
    reason?: string | null;
  },
  actor: { id: string; role: Role; organizationId: string }
) {
  if (patch.action === 'confirm') {
    return confirmPatientAppointment(id, actor);
  }
  if (patch.action === 'decline') {
    return declinePatientAppointment(id, patch.reason || 'Declined by clinician', actor);
  }

  const existing = await prisma.appointment.findFirst({
    where: { id, AND: [appointmentOrgWhere(actor.organizationId)] },
    include: { client: { select: { assignedToId: true } } },
  });
  if (!existing) {
    return { ok: false as const, error: 'Appointment not found', status: 404 };
  }

  if (isCaseloadRole(actor.role) && existing.client.assignedToId !== actor.id) {
    return { ok: false as const, error: 'Not your patient', status: 403 };
  }

  const data: Prisma.AppointmentUpdateInput = {};

  const visitInput = patch.visitStatus ?? patch.status;
  if (visitInput != null && visitInput !== '') {
    const next = DB_STATUS[visitInput];
    if (!next) {
      return { ok: false as const, error: 'Invalid visit status', status: 400 };
    }
    const currentUi = UI_STATUS[existing.status];
    const nextUi = UI_STATUS[next];
    const allowed = VISIT_TRANSITIONS[currentUi] || [];
    if (nextUi !== currentUi && !allowed.includes(nextUi)) {
      return {
        ok: false as const,
        error: `Cannot change visit status from ${currentUi} to ${nextUi}`,
        status: 400,
      };
    }
    data.status = next;
  }

  if (patch.noteStatus != null && patch.noteStatus !== '') {
    const note = DB_NOTE[patch.noteStatus];
    if (!note) {
      return { ok: false as const, error: 'Invalid note status', status: 400 };
    }
    data.noteStatus = note;
  }

  if (patch.notes !== undefined) {
    data.notes = patch.notes?.trim() || null;
  }

  if (Object.keys(data).length === 0) {
    return { ok: false as const, error: 'No updates provided', status: 400 };
  }

  const changer = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { name: true },
  });
  data.lastChangedById = actor.id;
  data.lastChangedByName = changer?.name || null;
  data.lastChangedAt = new Date();

  const row = await prisma.appointment.update({
    where: { id },
    data,
    include,
  });

  return { ok: true as const, appointment: serialize(row) };
}

/** @deprecated prefer updateAppointment */
export async function updateAppointmentStatus(
  id: string,
  statusInput: string,
  actor: { id: string; role: Role; organizationId: string }
) {
  return updateAppointment(id, { visitStatus: statusInput }, actor);
}

export async function generateAiDraft(
  id: string,
  actor: { id: string; role: Role; organizationId: string }
) {
  return updateAppointment(id, { noteStatus: 'ai-draft' }, actor);
}

export function todayLocalDate() {
  return localDate(new Date());
}
