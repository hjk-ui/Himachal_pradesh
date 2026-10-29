import 'server-only';

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { fromPracticeWallTime, practiceToday } from '@/lib/time/practiceTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { addDaysYmd, practiceDayBounds } from '@/lib/scheduling/slots';
import { decideBookingIdentity, dobDayRange, newBookingClientFlags } from '@/lib/scheduling/identity';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { confirmationCode, slugifyPracticeName, uniqueSlugCandidate, rangesOverlap } from './slug';
import type { PublicBookingAppointment, SoloAuditEntry, SoloPracticeSetup } from './types';
import { EMPTY_PRACTICE_SETUP, normalizePracticeSetup } from './defaults';
import { newTrialRecord, normalizeRecord } from '@/lib/billing/subscriptionRecord';
import { resolveAccess } from '@/lib/billing/entitlements';

/** Public booking writes an appointment, so it follows the org's write access (all tiers include booking). */
export function publicBookingOpen(organizationId: string, subscription: unknown): boolean {
  return resolveAccess(organizationId, normalizeRecord(subscription)).canWrite;
}

const SETTINGS_MODULE = 'solo-practice-settings';
const AUDIT_MODULE = 'solo-audit';
const PUBLIC_BOOKINGS_MODULE = 'public-bookings';

export { SETTINGS_MODULE };

async function uniqueSlug(name: string) {
  const base = slugifyPracticeName(name);
  const taken: string[] = [];
  let slug = uniqueSlugCandidate(base, taken);
  while (true) {
    const existing = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
    taken.push(slug);
    slug = uniqueSlugCandidate(base, taken);
  }
}

function moduleJson<T>(value: T): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function saveModule<T>(organizationId: string, module: string, data: T) {
  await prisma.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId, module } },
    create: { organizationId, module, data: moduleJson(data) },
    update: { data: moduleJson(data) },
  });
}

async function readModule<T>(organizationId: string, module: string): Promise<T | null> {
  const row = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module } },
  });
  return row ? (row.data as T) : null;
}

async function appendAudit(organizationId: string, action: string, entityId: string, note: string) {
  const existing = (await readModule<SoloAuditEntry[]>(organizationId, AUDIT_MODULE)) || [];
  await saveModule<SoloAuditEntry[]>(organizationId, AUDIT_MODULE, [
    {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      action,
      entityId,
      timestamp: new Date().toISOString(),
      note,
    },
    ...existing,
  ]);
}

export async function saveSoloPracticeSetup(input: SoloPracticeSetup) {
  const slug = await uniqueSlug(input.practiceName);
  const org = await prisma.organization.create({
    data: {
      name: input.practiceName.trim(),
      slug,
      active: true,
      locations: {
        create: {
          name: 'Main Office',
          code: 'MAIN',
          addressLine1: input.practiceAddress.trim() || null,
          city: input.practiceCity?.trim() || null,
          state: input.practiceState?.trim() || null,
          postalCode: input.practiceZip?.trim() || null,
          phone: input.practicePhone.trim() || null,
          active: true,
          isPrimary: true,
        },
      },
    },
    include: { locations: { where: { isPrimary: true }, take: 1 } },
  });

  const saved: SoloPracticeSetup = {
    ...normalizePracticeSetup(input),
    bookingSlug: org.slug,
    completedAt: new Date().toISOString(),
    services: input.services.map((service) => ({ ...service, active: service.active !== false })),
    acceptedPayers: input.acceptsInsurance ? input.acceptedPayers : [],
  };

  await saveModule(org.id, SETTINGS_MODULE, saved);
  // New org from public onboarding: free trial (billing/plans.ts TRIAL_RULE), not an untracked free plan.
  await saveModule(org.id, 'subscription-state', newTrialRecord('starter'));
  await appendAudit(org.id, 'practice_setup_completed', org.id, `Public booking slug created: ${org.slug}`);

  return { organizationId: org.id, slug: org.slug, setup: saved };
}

export async function getOrgPracticeSetup(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      locations: { where: { isPrimary: true }, take: 1 },
    },
  });
  if (!org) return null;

  const stored = await readModule<Partial<SoloPracticeSetup>>(organizationId, SETTINGS_MODULE);
  const location = org.locations[0];
  const setup = normalizePracticeSetup({
    ...EMPTY_PRACTICE_SETUP,
    ...stored,
    practiceName: stored?.practiceName || org.name || '',
    practiceAddress: stored?.practiceAddress || location?.addressLine1 || '',
    practiceCity: stored?.practiceCity || location?.city || '',
    practiceState: stored?.practiceState || location?.state || 'MD',
    practiceZip: stored?.practiceZip || location?.postalCode || '',
    practicePhone: stored?.practicePhone || location?.phone || '',
    bookingSlug: stored?.bookingSlug || org.slug,
  });

  return {
    setup,
    slug: org.slug,
    completed: Boolean(stored?.completedAt),
    bookingUrl: `/book/${org.slug}`,
  };
}

export async function upsertOrgPracticeSetup(organizationId: string, input: SoloPracticeSetup) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { locations: { where: { isPrimary: true }, take: 1 } },
  });
  if (!org) throw new Error('Organization not found.');

  const location = org.locations[0];
  await prisma.organization.update({
    where: { id: organizationId },
    data: { name: input.practiceName.trim() },
  });

  if (location) {
    await prisma.location.update({
      where: { id: location.id },
      data: {
        addressLine1: input.practiceAddress.trim() || null,
        city: input.practiceCity.trim() || null,
        state: input.practiceState.trim() || null,
        postalCode: input.practiceZip.trim() || null,
        phone: input.practicePhone.trim() || null,
      },
    });
  }

  const saved: SoloPracticeSetup = {
    ...normalizePracticeSetup(input),
    bookingSlug: org.slug,
    completedAt: new Date().toISOString(),
    services: input.services.map((service) => ({ ...service, active: service.active !== false })),
    acceptedPayers: input.acceptsInsurance ? input.acceptedPayers : [],
  };

  await saveModule(organizationId, SETTINGS_MODULE, saved);
  await appendAudit(
    organizationId,
    'practice_setup_updated',
    organizationId,
    `Practice setup saved for booking slug: ${org.slug}`
  );

  return { organizationId, slug: org.slug, setup: saved, bookingUrl: `/book/${org.slug}` };
}

export async function getPublicPractice(slug: string) {
  const org = await prisma.organization.findUnique({
    where: { slug },
    include: {
      locations: { where: { active: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      users: {
        where: { role: { in: ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'ADMIN'] }, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });
  if (!org || !org.active) return null;
  const setup = await readModule<SoloPracticeSetup>(org.id, SETTINGS_MODULE);
  if (!setup) return null;
  const subscription = await readModule<{ plan?: string }>(org.id, 'subscription-state');
  return { org, setup, subscription };
}

/** Practice wall time -> UTC instant (the server runs in UTC; `new Date('…T09:00')` would be 9 AM UTC). */
function parseDateTime(date: string, time: string, timeZone: string) {
  return fromPracticeWallTime(date, time, timeZone) ?? new Date(NaN);
}

function hhmmToMinutes(value: string) {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHhmm(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export async function listPublicSlots(slug: string, serviceId: string, date: string) {
  const practice = await getPublicPractice(slug);
  if (!practice) return { ok: false as const, error: 'Practice unavailable', status: 404 };
  const service = practice.setup.services.find((item) => item.serviceId === serviceId && item.active !== false);
  if (!service) return { ok: false as const, error: 'Service unavailable', status: 404 };

  // Calendar days and availability hours are on the practice clock, not the UTC server clock.
  const timeZone = await getPracticeTimeZone(practice.org.id);
  const bounds = /^\d{4}-\d{2}-\d{2}$/.test(date) ? practiceDayBounds(date, timeZone) : null;
  if (!bounds) return { ok: false as const, error: 'Invalid date', status: 400 };
  const today = practiceToday(timeZone);
  if (date < today) return { ok: true as const, slots: [] };
  if (date > addDaysYmd(today, practice.setup.bookingWindowDays)) return { ok: true as const, slots: [] };

  const rule = practice.setup.availability[DAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()]];
  if (!rule?.enabled || rule.end <= rule.start) return { ok: true as const, slots: [] };

  const busy = await prisma.appointment.findMany({
    where: {
      startsAt: { gte: bounds.start, lt: bounds.end },
      OR: [
        { client: { location: { organizationId: practice.org.id } } },
        { clinician: { organizationId: practice.org.id } },
      ],
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
    },
    select: { startsAt: true, endsAt: true },
  });

  const start = hhmmToMinutes(rule.start);
  const end = hhmmToMinutes(rule.end);
  const step = service.duration + (practice.setup.bufferMinutes || 0);
  const leadMs = (practice.setup.leadTimeHours ?? 0) * 60 * 60 * 1000;
  const earliest = new Date(Date.now() + leadMs);
  const slots: string[] = [];
  for (let minute = start; minute + service.duration <= end; minute += step) {
    const slotStart = parseDateTime(date, minutesToHhmm(minute), timeZone);
    const slotEnd = new Date(slotStart.getTime() + service.duration * 60000);
    if (slotStart <= earliest) continue;
    const overlaps = busy.some((appt) => rangesOverlap(slotStart, slotEnd, appt.startsAt, appt.endsAt));
    if (!overlaps) slots.push(minutesToHhmm(minute));
  }
  return { ok: true as const, slots };
}

export async function createPublicBooking(input: {
  slug: string;
  serviceId: string;
  date: string;
  time: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  dob: string;
  paymentType: 'Insurance' | 'Self-Pay' | 'Sliding Scale';
  insurance?: string | null;
  memberId?: string | null;
  reason: string;
}) {
  const practice = await getPublicPractice(input.slug);
  if (!practice) return { ok: false as const, error: 'Practice unavailable', status: 404 };
  if (!publicBookingOpen(practice.org.id, practice.subscription)) {
    return {
      ok: false as const,
      error: 'Online booking is paused for this practice. Please contact the office directly.',
      status: 402,
    };
  }

  const service = practice.setup.services.find((item) => item.serviceId === input.serviceId && item.active !== false);
  if (!service) return { ok: false as const, error: 'Service unavailable', status: 400 };
  const slotCheck = await listPublicSlots(input.slug, input.serviceId, input.date);
  if (!slotCheck.ok) {
    return { ok: false as const, error: slotCheck.error, status: slotCheck.status };
  }
  if (!slotCheck.slots.includes(input.time)) {
    return { ok: false as const, error: 'This appointment time is no longer available.', status: 409 };
  }

  const primaryLocation = practice.org.locations[0];
  const clinician = practice.org.users[0];
  const startsAt = parseDateTime(input.date, input.time, await getPracticeTimeZone(practice.org.id));
  const endsAt = new Date(startsAt.getTime() + service.duration * 60000);
  const email = input.email.trim().toLowerCase();
  const code = confirmationCode();
  const dobRange = dobDayRange(input.dob);
  if (!dobRange) return { ok: false as const, error: 'Enter date of birth as YYYY-MM-DD.', status: 400 };

  try {
    const booked = await prisma.$transaction(async (tx) => {
      // Serialize bookings for this practice, then re-check the slot under the lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`solo-book:${practice.org.id}`}))`;
      const conflict = await tx.appointment.findFirst({
        where: {
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL'] },
          OR: [
            { organizationId: practice.org.id },
            { client: { organizationId: practice.org.id } },
            { client: { location: { organizationId: practice.org.id } } },
            { clinician: { organizationId: practice.org.id } },
          ],
        },
        select: { id: true },
      });
      if (conflict) {
        throw new Error('SLOT_TAKEN');
      }

      // Identity: this practice only, exact first + last name + DOB; otherwise a new chart
      // flagged for staff to verify (src/lib/scheduling/identity.ts). Never matched by email
      // alone, never across practices, never auto-merged.
      const decision = await decideBookingIdentity(tx, {
        organizationId: practice.org.id,
        firstName: input.firstName,
        lastName: input.lastName,
        dob: input.dob,
        email,
        phone: input.phone,
      });
      let client: { id: string; name: string };
      let identityFlag: string | null;
      if (decision.kind === 'existing') {
        identityFlag = decision.flagReason;
        client = await tx.client.update({
          where: { id: decision.clientId },
          data: decision.flagReason ? { identityVerifyRequired: true, identityVerifyReason: decision.flagReason } : {},
          select: { id: true, name: true },
        });
      } else {
        identityFlag = decision.reason;
        client = await tx.client.create({
          data: {
            organizationId: practice.org.id,
            name: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
            legalFirstName: input.firstName.trim(),
            legalLastName: input.lastName.trim(),
            phone: input.phone?.trim() || null,
            dateOfBirth: dobRange.start,
            insurancePayer: input.paymentType === 'Insurance' ? input.insurance?.trim() || null : null,
            insuranceMemberId: input.paymentType === 'Insurance' ? input.memberId?.trim() || null : null,
            locationId: primaryLocation?.id ?? null,
            assignedToId: clinician?.id ?? null,
            status: 'INACTIVE',
            active: false,
            ...newBookingClientFlags(decision, email),
          },
          select: { id: true, name: true },
        });
      }

      const appointment = await tx.appointment.create({
        data: {
          organizationId: practice.org.id,
          clientId: client.id,
          clinicianId: clinician?.id ?? null,
          type: service.name,
          startsAt,
          endsAt,
          status: 'SCHEDULED',
          isVirtual: true,
          createdVia: 'online',
          notes: [
            `Public self-scheduling confirmation: ${code}`,
            `Payment type: ${input.paymentType}`,
            `Reason: ${input.reason.trim()}`,
          ].join('\n'),
        },
      });

      return { client, appointment, matched: decision.kind === 'existing', identityFlag };
    });

    const { client, appointment } = booked;
    await writeAuditLog({
      action: 'PUBLIC_APPOINTMENT_BOOKED',
      actorUserId: null,
      actorRole: 'PUBLIC',
      organizationId: practice.org.id,
      resourceType: 'appointment',
      resourceId: appointment.id,
      patientId: client.id,
      metadata: { via: 'solo_public_page', clientMatch: booked.matched ? 'name_dob' : 'new_client', identityVerifyReason: booked.identityFlag },
    });

  const existingBookings = (await readModule<PublicBookingAppointment[]>(practice.org.id, PUBLIC_BOOKINGS_MODULE)) || [];
  const publicBooking: PublicBookingAppointment = {
    id: appointment.id,
    confirmationCode: code,
    serviceId: service.serviceId,
    serviceName: service.name,
    appointmentDate: input.date,
    appointmentTime: input.time,
    clientName: client.name,
    clientEmail: email,
    paymentType: input.paymentType,
    createdAt: new Date().toISOString(),
  };
  await saveModule(practice.org.id, PUBLIC_BOOKINGS_MODULE, [publicBooking, ...existingBookings]);
  await appendAudit(practice.org.id, 'public_appointment_booked', appointment.id, `${client.name} booked ${service.name}.`);

  return { ok: true as const, confirmationCode: code, appointmentId: appointment.id };
  } catch (err: any) {
    if (String(err?.message || '').includes('SLOT_TAKEN')) {
      return { ok: false as const, error: 'This appointment time is no longer available.', status: 409 };
    }
    throw err;
  }
}
