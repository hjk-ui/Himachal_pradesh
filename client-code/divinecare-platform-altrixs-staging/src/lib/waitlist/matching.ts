import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getOrCreateSchedulingSettings } from '@/lib/scheduling/manage';
import { generateBookingSlots, weekdayKey } from '@/lib/scheduling/slots';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import {
  intakeAppointmentFor,
  locationFit,
  panelStatusFor,
  SERVICE_ROLES,
  seesService,
  serviceCategory,
  slotFitsAvailability,
} from './standard';

/**
 * Clinician + open-slot suggestions for one waitlist entry (the reverse of
 * src/lib/scheduling/waitlistSuggest.ts, which suggests waitlist people for a freed slot).
 *
 *  - Service: clinician role (primary or extra) sees the service (SERVICE_ROLES).
 *  - Payer: Billing > Insurance Panels (PayerPanel). A clinician on an approved panel for the
 *    payer is "in network"; a payer with panels on file but none approved for the clinician
 *    excludes them; a payer with no panel on file is "unknown" and excludes no one.
 *  - Location: the clinician's sites (UserLocation / primaryLocationId) vs preferred sites;
 *    telehealth OK keeps everyone; no sites on file is "unknown".
 *  - Slots: practice scheduling hours (Practice settings > Scheduling) minus the clinician's
 *    booked visits, next 21 days, filtered by the person's days / times. There is no
 *    per-clinician working schedule in Altrixs yet, so a slot is "open on the practice calendar",
 *    and the booking API still refuses a clinician double-booking.
 *  - Gender / language preference: no staff field holds these, so they are shown, not matched.
 */

export type ClinicianSuggestion = {
  clinicianId: string;
  name: string;
  role: string;
  credentials: string | null;
  inNetwork: 'yes' | 'no' | 'unknown';
  location: 'yes' | 'no' | 'unknown' | 'telehealth';
  preferred: boolean;
  slots: { startsAt: string; endsAt: string }[];
};

export async function suggestForEntry(
  organizationId: string,
  entry: {
    specialty: string;
    insurancePayer: string | null;
    payerRegistryId: string | null;
    preferredLocationIds: string[];
    telehealthOk: boolean | null;
    availabilityDays: string[];
    availabilityTimes: string[];
    clinicianId: string | null;
  },
  opts: { days?: number; slotsPerClinician?: number; now?: Date } = {}
): Promise<{ service: string; appointmentType: string; durationMin: number; timeZone: string; clinicians: ClinicianSuggestion[] }> {
  const service = serviceCategory(entry.specialty);
  const visit = intakeAppointmentFor(service);
  const roles = SERVICE_ROLES[service] as Role[];
  const now = opts.now ?? new Date();
  const to = new Date(now.getTime() + (opts.days ?? 21) * 86_400_000);

  const [users, panels, settings, timeZone] = await Promise.all([
    prisma.user.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        OR: [{ role: { in: roles } }, { roles: { hasSome: roles } }, ...(entry.clinicianId ? [{ id: entry.clinicianId }] : [])],
      },
      select: { id: true, name: true, email: true, role: true, roles: true, credentials: true, primaryLocationId: true, locations: { select: { locationId: true } } },
      take: 200,
    }),
    prisma.payerPanel
      .findMany({ where: { organizationId }, select: { payerName: true, payerRegistryId: true, providerUserIds: true, status: true } })
      .catch(() => []),
    getOrCreateSchedulingSettings(organizationId),
    getPracticeTimeZone(organizationId),
  ]);

  const scored = users
    .filter((u) => u.id === entry.clinicianId || seesService({ role: u.role, roles: u.roles as string[] }, service))
    .map((u) => {
      const sites = [...new Set([u.primaryLocationId, ...u.locations.map((l) => l.locationId)].filter(Boolean) as string[])];
      return {
        u,
        inNetwork: panelStatusFor(u.id, { name: entry.insurancePayer, registryId: entry.payerRegistryId }, panels),
        location: locationFit(sites, entry.preferredLocationIds, entry.telehealthOk),
        preferred: u.id === entry.clinicianId,
      };
    })
    .filter((c) => c.preferred || (c.inNetwork !== 'no' && c.location !== 'no'));

  const ids = scored.map((c) => c.u.id);
  const booked = ids.length
    ? await prisma.appointment.findMany({
        where: {
          organizationId,
          clinicianId: { in: ids },
          status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL'] },
          startsAt: { lt: to },
          endsAt: { gt: now },
        },
        select: { startsAt: true, endsAt: true, clinicianId: true },
      })
    : [];

  const perClinician = opts.slotsPerClinician ?? 4;
  const clinicians: ClinicianSuggestion[] = scored.map((c) => {
    const all = generateBookingSlots({
      from: now,
      to,
      now,
      timeZone,
      hours: settings.hours,
      durationMin: visit.durationMin,
      bufferMinutes: settings.bufferMinutes,
      // Staff booking: the online-booking notice rule does not apply; book-ahead covers the window
      minNoticeDays: 0,
      bookAheadDays: (opts.days ?? 21) + 1,
      booked: booked.filter((b) => b.clinicianId === c.u.id),
      providerId: c.u.id,
    });
    const slots: { startsAt: string; endsAt: string }[] = [];
    for (const s of all) {
      if (s.startsAt <= new Date(now.getTime() + 60 * 60_000).toISOString()) continue;
      const wall = toPracticeWallTime(s.startsAt, timeZone);
      if (!slotFitsAvailability({ day: weekdayKey(wall.date), time: wall.time }, entry.availabilityDays, entry.availabilityTimes)) continue;
      slots.push(s);
      if (slots.length >= perClinician) break;
    }
    return {
      clinicianId: c.u.id,
      name: c.u.name || c.u.email,
      role: c.u.role,
      credentials: c.u.credentials,
      inNetwork: c.inNetwork,
      location: c.location,
      preferred: c.preferred,
      slots,
    };
  });

  const rank = (c: ClinicianSuggestion) =>
    (c.preferred ? 0 : 10) + (c.inNetwork === 'yes' ? 0 : 3) + (c.location === 'yes' ? 0 : c.location === 'telehealth' ? 1 : 2) + (c.slots.length ? 0 : 5);
  clinicians.sort(
    (a, b) => rank(a) - rank(b) || (a.slots[0]?.startsAt ?? '9').localeCompare(b.slots[0]?.startsAt ?? '9') || a.name.localeCompare(b.name)
  );
  return { service, appointmentType: visit.type, durationMin: visit.durationMin, timeZone, clinicians: clinicians.slice(0, 12) };
}
