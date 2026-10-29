import { prisma } from '@/lib/db';
import {
  defaultSchedulingSettings,
  type SchedulingSettingsShape,
} from '@/lib/scheduling/types';

function dayKey(d: Date): string {
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return keys[d.getDay()] || 'mon';
}

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':').map((x) => Number(x));
  return { h: h || 0, m: m || 0 };
}

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
      status: 'ACTIVE',
      role: { in: ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'PRACTICE_DIRECTOR'] },
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
  const service = settings.services.find((s) => s.id === opts.serviceId && s.enabled);
  if (!service) return { slots: [] as { startsAt: string; endsAt: string }[], timezone: 'America/New_York' };

  const from = new Date(opts.from);
  const to = new Date(opts.to);
  const now = new Date();
  const minStart = new Date(now.getTime() + settings.minNoticeDays * 24 * 60 * 60 * 1000);
  const maxEnd = new Date(now.getTime() + settings.bookAheadDays * 24 * 60 * 60 * 1000);

  const booked = await prisma.appointment.findMany({
    where: {
      organizationId: opts.organizationId,
      status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL'] },
      startsAt: { gte: from, lte: to },
      ...(opts.providerId ? { clinicianId: opts.providerId } : {}),
    },
    select: { startsAt: true, endsAt: true, clinicianId: true },
  });

  const slots: { startsAt: string; endsAt: string }[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= to && cursor <= maxEnd) {
    const key = dayKey(cursor);
    const hours = settings.hours[key];
    if (hours?.enabled) {
      const { h: sh, m: sm } = parseHm(hours.start);
      const { h: eh, m: em } = parseHm(hours.end);
      const dayStart = new Date(cursor);
      dayStart.setHours(sh, sm, 0, 0);
      const dayEnd = new Date(cursor);
      dayEnd.setHours(eh, em, 0, 0);

      let slotStart = new Date(dayStart);
      while (slotStart.getTime() + service.durationMin * 60_000 <= dayEnd.getTime()) {
        const slotEnd = new Date(slotStart.getTime() + service.durationMin * 60_000);
        if (slotStart >= minStart && slotStart > now) {
          const overlap = booked.some((b) => {
            if (opts.providerId && b.clinicianId && b.clinicianId !== opts.providerId) return false;
            return b.startsAt < slotEnd && b.endsAt > slotStart;
          });
          if (!overlap) {
            slots.push({ startsAt: slotStart.toISOString(), endsAt: slotEnd.toISOString() });
          }
        }
        slotStart = new Date(slotStart.getTime() + (service.durationMin + settings.bufferMinutes) * 60_000);
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return { slots, timezone: 'America/New_York', service };
}

function confirmationCode() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `AC-${n}`;
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
  if (!service) throw Object.assign(new Error('Service not available'), { status: 400 });

  if (input.modality === 'telehealth' && !service.telehealth) {
    throw Object.assign(new Error('Telehealth not offered for this service'), { status: 400 });
  }
  if (input.modality === 'in_person' && !service.inPerson) {
    throw Object.assign(new Error('In-person not offered for this service'), { status: 400 });
  }
  if (settings.rules.requireInsurance && !input.insurance?.trim()) {
    throw Object.assign(new Error('Insurance is required for online booking'), { status: 400 });
  }

  const endsAt = new Date(input.startsAt.getTime() + service.durationMin * 60_000);
  const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();

  let client = await prisma.client.findFirst({
    where: {
      organizationId: input.organizationId,
      OR: [{ email: input.email.toLowerCase() }, { phone: input.phone }],
    },
  });

  if (!client) {
    client = await prisma.client.create({
      data: {
        organizationId: input.organizationId,
        name: fullName,
        email: input.email.toLowerCase(),
        phone: input.phone,
        dateOfBirth: input.dob ? new Date(input.dob) : null,
        insurancePayer: input.insurance || null,
        insuranceMemberId: input.memberId || null,
        assignedToId: input.providerId || null,
        status: 'ACTIVE',
        active: true,
      },
    });
  } else if (input.providerId && !client.assignedToId) {
    await prisma.client.update({
      where: { id: client.id },
      data: { assignedToId: input.providerId },
    });
  }

  let clinicianName: string | null = null;
  if (input.providerId) {
    const clin = await prisma.user.findFirst({
      where: { id: input.providerId, organizationId: input.organizationId },
      select: { name: true },
    });
    clinicianName = clin?.name || null;
  }

  let code = confirmationCode();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.appointment.findUnique({ where: { confirmationCode: code } });
    if (!exists) break;
    code = confirmationCode();
  }

  const appt = await prisma.appointment.create({
    data: {
      organizationId: input.organizationId,
      clientId: client.id,
      clientName: fullName,
      clinicianId: input.providerId || null,
      clinicianName,
      type: service.title,
      startsAt: input.startsAt,
      endsAt,
      status: 'SCHEDULED',
      isVirtual: input.modality === 'telehealth',
      patientBooked: true,
      createdVia: 'online',
      createdByName: fullName,
      confirmationCode: code,
      insurancePayer: input.insurance || null,
      memberId: input.memberId || null,
      notes: input.notes || null,
      telehealthPlatform: input.modality === 'telehealth' ? 'zoom' : null,
    },
  });

  return {
    appointmentId: appt.id,
    confirmationCode: code,
    startsAt: appt.startsAt.toISOString(),
    endsAt: appt.endsAt.toISOString(),
    service: service.title,
    modality: input.modality,
    contactPhone: settings.contactPhone,
    contactEmail: settings.contactEmail,
    practiceName: settings.practiceName,
  };
}
