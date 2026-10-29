import { prisma } from '@/lib/db/prisma';
import { PatientAppError } from '@/patient/domain';
import { localDate, localTime } from '@/patient/application/appointments/mapper';

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

  const startDay = new Date(`${fromDate}T00:00:00`);
  if (Number.isNaN(startDay.getTime())) {
    throw new PatientAppError('Invalid date', 400, 'VALIDATION_ERROR');
  }

  const booked = await prisma.appointment.findMany({
    where: {
      clinicianId: doctorId,
      organizationId,
      status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL'] },
      startsAt: {
        gte: startDay,
        lte: new Date(startDay.getTime() + days * 86_400_000),
      },
    },
    select: { startsAt: true, endsAt: true },
  });

  const slots: { date: string; startTime: string; endTime: string; available: boolean }[] = [];
  const now = Date.now();

  for (let d = 0; d < days; d++) {
    const day = new Date(startDay);
    day.setDate(day.getDate() + d);
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue;

    for (let hour = 9; hour < 17; hour++) {
      const slotStart = new Date(day);
      slotStart.setHours(hour, 0, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + 50 * 60 * 1000);
      if (slotStart.getTime() < now) continue;

      const conflict = booked.some(
        (b) => b.startsAt < slotEnd && b.endsAt > slotStart
      );

      slots.push({
        date: localDate(slotStart),
        startTime: localTime(slotStart),
        endTime: localTime(slotEnd),
        available: !conflict,
      });
    }
  }

  return { doctorId, fromDate, days, slots };
}
