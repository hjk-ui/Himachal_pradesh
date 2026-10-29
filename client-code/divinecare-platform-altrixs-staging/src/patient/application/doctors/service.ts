import { prisma } from '@/lib/db/prisma';
import { PatientAppError } from '@/patient/domain';
import { localDate, localTime } from '@/patient/application/appointments/mapper';
import { fromPracticeWallTime, practiceZoneLabel } from '@/lib/time/practiceTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';

const BOOKABLE_ROLES = ['CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'ADMIN', 'DIRECTOR'] as const;

export async function listPatientDoctors(organizationId: string) {
  const rows = await prisma.user.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      role: { in: [...BOOKABLE_ROLES] },
    },
    select: {
      id: true,
      name: true,
      role: true,
      image: true,
    },
    orderBy: { name: 'asc' },
  });

  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    image: u.image,
  }));
}

export async function getPatientDoctor(organizationId: string, doctorId: string) {
  const row = await prisma.user.findFirst({
    where: {
      id: doctorId,
      organizationId,
      status: 'ACTIVE',
      role: { in: [...BOOKABLE_ROLES] },
    },
    select: { id: true, name: true, role: true, image: true },
  });
  if (!row) {
    throw new PatientAppError('Clinician not found', 404, 'NOT_FOUND');
  }
  return { id: row.id, name: row.name, role: row.role, image: row.image };
}

export async function getDoctorAvailability(
  organizationId: string,
  doctorId: string,
  fromDate: string,
  days = 14
) {
  await getPatientDoctor(organizationId, doctorId);

  // Slots are 9 AM-5 PM on the PRACTICE clock. `new Date('…T00:00:00')` + setHours() built
  // them on the server's (UTC) clock, offering "09:00" that was really 5:00 AM ET.
  const timeZone = await getPracticeTimeZone(organizationId);
  const startDay = fromPracticeWallTime(fromDate, '00:00', timeZone);
  if (!startDay) {
    throw new PatientAppError('Invalid date', 400, 'VALIDATION_ERROR');
  }
  const [fy, fm, fd] = fromDate.split('-').map(Number);

  const booked = await prisma.appointment.findMany({
    where: {
      clinicianId: doctorId,
      organizationId,
      status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL'] },
      startsAt: {
        gte: startDay,
        lte: new Date(startDay.getTime() + (days + 1) * 86_400_000),
      },
    },
    select: { startsAt: true, endsAt: true },
  });

  const slots: { date: string; startTime: string; endTime: string; available: boolean }[] = [];
  const now = Date.now();

  for (let d = 0; d < days; d++) {
    // Calendar arithmetic on the wall date (UTC fields only, no zone involved).
    const day = new Date(Date.UTC(fy, fm - 1, fd + d));
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const ymd = day.toISOString().slice(0, 10);

    for (let hour = 9; hour < 17; hour++) {
      const slotStart = fromPracticeWallTime(ymd, `${String(hour).padStart(2, '0')}:00`, timeZone);
      if (!slotStart) continue;
      const slotEnd = new Date(slotStart.getTime() + 50 * 60 * 1000);
      if (slotStart.getTime() < now) continue;

      const conflict = booked.some(
        (b) => b.startsAt < slotEnd && b.endsAt > slotStart
      );

      slots.push({
        date: localDate(slotStart, timeZone),
        startTime: localTime(slotStart, timeZone),
        endTime: localTime(slotEnd, timeZone),
        available: !conflict,
      });
    }
  }

  return { doctorId, fromDate, days, timeZone, timeZoneLabel: practiceZoneLabel(timeZone), slots };
}
