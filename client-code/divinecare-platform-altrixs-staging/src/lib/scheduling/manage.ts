import { prisma } from '@/lib/db';
import { generateBookingSlots, practiceDayBounds } from '@/lib/scheduling/slots';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { decideBookingIdentity, dobDayRange, newBookingClientFlags } from '@/lib/scheduling/identity';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import {
  defaultSchedulingSettings,
  type SchedulingSettingsShape,
} from '@/lib/scheduling/types';
import { SCHEDULABLE_STAFF_STATUSES } from '@/lib/staff/schedulable';

function rowToSettings(row: {
  practiceName: string | null;
  practiceCity: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  servicesJson: unknown;
  hoursJson: unknown;
  rulesJson: unknown;
  embedJson: unknown;
  remindersJson: unknown;
}, orgName?: string | null): SchedulingSettingsShape {
  const base = defaultSchedulingSettings(orgName);
  const rules = (row.rulesJson || {}) as Record<string, unknown>;
  const embed = (row.embedJson || {}) as Record<string, unknown>;
  const reminders = (row.remindersJson || {}) as Record<string, unknown>;
  return {
    practiceName: row.practiceName ?? base.practiceName,
    practiceCity: row.practiceCity || base.practiceCity,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    services: Array.isArray(row.servicesJson) ? (row.servicesJson as SchedulingSettingsShape['services']) : base.services,
    hours: (row.hoursJson && typeof row.hoursJson === 'object' ? row.hoursJson : base.hours) as SchedulingSettingsShape['hours'],
    bufferMinutes: typeof rules.bufferMinutes === 'number' ? rules.bufferMinutes : base.bufferMinutes,
    bookAheadDays: typeof rules.bookAheadDays === 'number' ? rules.bookAheadDays : base.bookAheadDays,
    minNoticeDays: typeof rules.minNoticeDays === 'number' ? rules.minNoticeDays : base.minNoticeDays,
    rules: {
      requireInsurance: Boolean(rules.requireInsurance ?? base.rules.requireInsurance),
      newClientsOnly: Boolean(rules.newClientsOnly ?? base.rules.newClientsOnly),
    },
    embed: {
      color: typeof embed.color === 'string' ? embed.color : base.embed.color,
      mode: (embed.mode as SchedulingSettingsShape['embed']['mode']) || base.embed.mode,
    },
    reminders: {
      emailConfirm: Boolean(reminders.emailConfirm ?? base.reminders.emailConfirm),
      smsConfirm: Boolean(reminders.smsConfirm ?? base.reminders.smsConfirm),
      emailReminder24h: Boolean(reminders.emailReminder24h ?? base.reminders.emailReminder24h),
      smsReminder24h: Boolean(reminders.smsReminder24h ?? base.reminders.smsReminder24h),
      smsReminder2h: Boolean(reminders.smsReminder2h ?? base.reminders.smsReminder2h),
      smsShowPracticeName: Boolean(reminders.smsShowPracticeName ?? base.reminders.smsShowPracticeName),
    },
  };
}

export async function getOrCreateSchedulingSettings(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  let row = await prisma.schedulingSettings.findUnique({ where: { organizationId } });
  if (!row) {
    const defaults = defaultSchedulingSettings(org?.name);
    row = await prisma.schedulingSettings.create({
      data: {
        organizationId,
        practiceName: defaults.practiceName,
        practiceCity: defaults.practiceCity,
        servicesJson: defaults.services,
        hoursJson: defaults.hours,
        rulesJson: {
          bufferMinutes: defaults.bufferMinutes,
          bookAheadDays: defaults.bookAheadDays,
          minNoticeDays: defaults.minNoticeDays,
          requireInsurance: defaults.rules.requireInsurance,
          newClientsOnly: defaults.rules.newClientsOnly,
        },
        embedJson: defaults.embed,
        remindersJson: defaults.reminders,
      },
    });
  }
  return rowToSettings(row, org?.name);
}

export async function saveSchedulingSettings(
  organizationId: string,
  patch: Partial<SchedulingSettingsShape>
) {
  const current = await getOrCreateSchedulingSettings(organizationId);
  const next: SchedulingSettingsShape = {
    ...current,
    ...patch,
    services: patch.services ?? current.services,
    hours: patch.hours ?? current.hours,
    rules: patch.rules ?? current.rules,
    embed: patch.embed ?? current.embed,
    reminders: patch.reminders ?? current.reminders,
    bufferMinutes: patch.bufferMinutes ?? current.bufferMinutes,
    bookAheadDays: patch.bookAheadDays ?? current.bookAheadDays,
    minNoticeDays: patch.minNoticeDays ?? current.minNoticeDays,
  };

  await prisma.schedulingSettings.upsert({
    where: { organizationId },
    create: {
      organizationId,
      practiceName: next.practiceName,
      practiceCity: next.practiceCity,
      contactPhone: next.contactPhone,
      contactEmail: next.contactEmail,
      servicesJson: next.services,
      hoursJson: next.hours,
      rulesJson: {
        bufferMinutes: next.bufferMinutes,
        bookAheadDays: next.bookAheadDays,
        minNoticeDays: next.minNoticeDays,
        requireInsurance: next.rules.requireInsurance,
        newClientsOnly: next.rules.newClientsOnly,
      },
      embedJson: next.embed,
      remindersJson: next.reminders,
    },
    update: {
      practiceName: next.practiceName,
      practiceCity: next.practiceCity,
      contactPhone: next.contactPhone,
      contactEmail: next.contactEmail,
      servicesJson: next.services,
      hoursJson: next.hours,
      rulesJson: {
        bufferMinutes: next.bufferMinutes,
        bookAheadDays: next.bookAheadDays,
        minNoticeDays: next.minNoticeDays,
        requireInsurance: next.rules.requireInsurance,
        newClientsOnly: next.rules.newClientsOnly,
      },
      embedJson: next.embed,
      remindersJson: next.reminders,
    },
  });

  return next;
}

export async function resolvePublicOrg(opts: { organizationId?: string; organizationSlug?: string }) {
  if (opts.organizationId) {
    return prisma.organization.findFirst({
      where: { id: opts.organizationId, active: true },
      select: { id: true, name: true, slug: true },
    });
  }
  if (opts.organizationSlug) {
    return prisma.organization.findFirst({
      where: { slug: opts.organizationSlug, active: true },
      select: { id: true, name: true, slug: true },
    });
  }
  // Default: first active org (single-tenant demo clinics)
  return prisma.organization.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, slug: true },
  });
}

export async function listSchedulingProviders(organizationId: string, serviceId?: string) {
  const settings = await getOrCreateSchedulingSettings(organizationId);
  const service = settings.services.find((s) => s.id === serviceId && s.enabled);
  const users = await prisma.user.findMany({
    where: {
      organizationId,
      status: { in: SCHEDULABLE_STAFF_STATUSES },
      role: { in: [...SCHEDULING_PROVIDER_ROLES] },
    },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
  return {
    service,
    providers: [
      { id: null as string | null, name: 'Any Available', role: null as string | null },
      ...users.map((u) => ({
        id: u.id,
        name: u.name || 'Clinician',
        role: u.role,
      })),
    ],
  };
}

/** Eastern timezone slot generation from settings + existing appointments */
export async function listAvailableSlots(opts: {
  organizationId: string;
  serviceId: string;
  providerId?: string | null;
  from: string;
  to: string;
}) {
  const settings = await getOrCreateSchedulingSettings(opts.organizationId);
  const timeZone = await getPracticeTimeZone(opts.organizationId);
  const service = settings.services.find((s) => s.id === opts.serviceId && s.enabled);
  if (!service) return { slots: [] as { startsAt: string; endsAt: string }[], timezone: timeZone };

  const from = new Date(opts.from);
  const to = new Date(opts.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { slots: [] as { startsAt: string; endsAt: string }[], timezone: timeZone, service };
  }
  const now = new Date();

  const booked = await prisma.appointment.findMany({
    where: {
      organizationId: opts.organizationId,
      status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL'] },
      startsAt: { gte: from, lte: to },
      ...(opts.providerId ? { clinicianId: opts.providerId } : {}),
    },
    select: { startsAt: true, endsAt: true, clinicianId: true },
  });

  // Business hours are practice wall time (see src/lib/scheduling/slots.ts).
  const slots = generateBookingSlots({
    from,
    to,
    now,
    timeZone,
    hours: settings.hours,
    durationMin: service.durationMin,
    bufferMinutes: settings.bufferMinutes,
    minNoticeDays: settings.minNoticeDays,
    bookAheadDays: settings.bookAheadDays,
    booked,
    providerId: opts.providerId,
  });

  return { slots, timezone: timeZone, service };
}

function confirmationCode() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `AC-${n}`;
}

const SCHEDULING_PROVIDER_ROLES = ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'PRACTICE_DIRECTOR'] as const;

/**
 * Practice default telehealth platform (Practice settings > Scheduling, stored on
 * TelehealthSettings.defaultPlatform), lowercased for Appointment.telehealthPlatform. Before,
 * every online booking was stamped 'zoom' whatever the practice used. With no settings row the
 * practice-settings default (CHIME, the in-app room) applies.
 */
export async function practiceDefaultTelehealthPlatform(organizationId: string): Promise<string> {
  try {
    const row = await prisma.telehealthSettings.findUnique({
      where: { organizationId },
      select: { defaultPlatform: true },
    });
    return (row?.defaultPlatform ?? 'CHIME').toLowerCase();
  } catch {
    return 'chime';
  }
}

/**
 * Is `startsAt` one of the bookable slots for this service / provider right now? Same rules the
 * slot picker uses (practice hours on the practice clock, buffer, notice, book-ahead, existing
 * appointments), so a crafted POST cannot book 3 AM, a closed day, or over another visit.
 */
export function isOfferedSlot(opts: Parameters<typeof generateBookingSlots>[0], startsAt: Date): boolean {
  return generateBookingSlots(opts).some((sl) => Date.parse(sl.startsAt) === startsAt.getTime());
}

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

export async function bookPublicAppointment(input: {
  organizationId: string;
  serviceId: string;
  modality: 'telehealth' | 'in_person';
  providerId?: string | null;
  startsAt: Date;
  firstName: string;
  lastName: string;
  dob: string;
  phone: string;
  email: string;
  insurance?: string;
  memberId?: string;
  notes?: string;
}) {
  const settings = await getOrCreateSchedulingSettings(input.organizationId);
  const service = settings.services.find((s) => s.id === input.serviceId && s.enabled);
  if (!service) throw httpError('Service not available', 400);

  if (input.modality === 'telehealth' && !service.telehealth) {
    throw httpError('Telehealth not offered for this service', 400);
  }
  if (input.modality === 'in_person' && !service.inPerson) {
    throw httpError('In-person not offered for this service', 400);
  }
  if (settings.rules.requireInsurance && !input.insurance?.trim()) {
    throw httpError('Insurance is required for online booking', 400);
  }
  if (Number.isNaN(input.startsAt.getTime())) throw httpError('Invalid appointment time', 400);
  const dobRange = dobDayRange(input.dob);
  if (!dobRange) throw httpError('Enter date of birth as YYYY-MM-DD', 400);

  // The chosen provider must be a bookable clinician of THIS practice.
  let clinicianName: string | null = null;
  const providerId = input.providerId || null;
  if (providerId) {
    const clin = await prisma.user.findFirst({
      where: {
        id: providerId,
        organizationId: input.organizationId,
        status: { in: SCHEDULABLE_STAFF_STATUSES },
        role: { in: [...SCHEDULING_PROVIDER_ROLES] },
      },
      select: { name: true },
    });
    if (!clin) throw httpError('Provider not available', 400);
    clinicianName = clin.name || null;
  }

  const timeZone = await getPracticeTimeZone(input.organizationId);
  const endsAt = new Date(input.startsAt.getTime() + service.durationMin * 60_000);
  const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
  const email = input.email.trim().toLowerCase();
  const telehealthPlatform =
    input.modality === 'telehealth' ? await practiceDefaultTelehealthPlatform(input.organizationId) : null;

  const day = toPracticeWallTime(input.startsAt, timeZone).date;
  const bounds = practiceDayBounds(day, timeZone);
  if (!bounds) throw httpError('Invalid appointment time', 400);
  const lockKey = `public-book:${input.organizationId}:${providerId ?? 'any'}`;

  const result = await prisma.$transaction(async (tx) => {
    // One booking at a time per practice + provider (or practice, for "any available"), then
    // re-read the day's appointments: two people submitting the same slot cannot both win.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const booked = await tx.appointment.findMany({
      where: {
        organizationId: input.organizationId,
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL'] },
        startsAt: { lt: bounds.end },
        endsAt: { gt: bounds.start },
        ...(providerId ? { clinicianId: providerId } : {}),
      },
      select: { startsAt: true, endsAt: true, clinicianId: true },
    });
    const offered = isOfferedSlot(
      {
        from: bounds.start,
        to: bounds.end,
        now: new Date(),
        timeZone,
        hours: settings.hours,
        durationMin: service.durationMin,
        bufferMinutes: settings.bufferMinutes,
        minNoticeDays: settings.minNoticeDays,
        bookAheadDays: settings.bookAheadDays,
        booked,
        providerId,
      },
      input.startsAt
    );
    if (!offered) throw httpError('This appointment time is no longer available. Please choose another time.', 409);

    const decision = await decideBookingIdentity(tx, {
      organizationId: input.organizationId,
      firstName: input.firstName,
      lastName: input.lastName,
      dob: input.dob,
      email,
      phone: input.phone,
    });

    let clientId: string;
    let identityFlag: string | null;
    if (decision.kind === 'existing') {
      clientId = decision.clientId;
      identityFlag = decision.flagReason;
      if (decision.flagReason) {
        // Contact typed differs from the chart: keep the chart's details, ask staff to verify.
        await tx.client.update({
          where: { id: clientId },
          data: { identityVerifyRequired: true, identityVerifyReason: decision.flagReason },
        });
      }
    } else {
      const created = await tx.client.create({
        data: {
          organizationId: input.organizationId,
          name: fullName,
          legalFirstName: input.firstName.trim(),
          legalLastName: input.lastName.trim(),
          phone: input.phone,
          dateOfBirth: dobRange.start,
          insurancePayer: input.insurance || null,
          insuranceMemberId: input.memberId || null,
          assignedToId: providerId,
          status: 'ACTIVE',
          active: true,
          ...newBookingClientFlags(decision, email),
        },
        select: { id: true },
      });
      clientId = created.id;
      identityFlag = decision.reason;
    }

    let code = confirmationCode();
    for (let i = 0; i < 5; i++) {
      const exists = await tx.appointment.findUnique({ where: { confirmationCode: code }, select: { id: true } });
      if (!exists) break;
      code = confirmationCode();
    }

    const appt = await tx.appointment.create({
      data: {
        organizationId: input.organizationId,
        clientId,
        clientName: fullName,
        clinicianId: providerId,
        clinicianName,
        type: service.title,
        startsAt: input.startsAt,
        endsAt,
        status: 'SCHEDULED',
        isVirtual: input.modality === 'telehealth',
        patientBooked: true,
        createdVia: 'online',
        confirmationCode: code,
        insurancePayer: input.insurance || null,
        memberId: input.memberId || null,
        notes: input.notes || null,
        telehealthPlatform,
      },
    });
    return { appt, code, clientId, matched: decision.kind === 'existing', identityFlag };
  });

  // Public, unauthenticated booking: ids and enums only.
  await writeAuditLog({
    action: 'PUBLIC_APPOINTMENT_BOOKED',
    actorUserId: null,
    actorRole: 'PUBLIC',
    organizationId: input.organizationId,
    resourceType: 'appointment',
    resourceId: result.appt.id,
    patientId: result.clientId,
    metadata: {
      clientMatch: result.matched ? 'name_dob' : 'new_client',
      identityVerifyReason: result.identityFlag,
      providerChosen: Boolean(providerId),
      modality: input.modality,
      telehealthPlatform,
    },
  });

  return {
    appointmentId: result.appt.id,
    confirmationCode: result.code,
    startsAt: result.appt.startsAt.toISOString(),
    endsAt: result.appt.endsAt.toISOString(),
    service: service.title,
    modality: input.modality,
    contactPhone: settings.contactPhone,
    contactEmail: settings.contactEmail,
    practiceName: settings.practiceName,
  };
}
