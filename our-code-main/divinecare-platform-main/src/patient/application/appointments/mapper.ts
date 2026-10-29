import type { Appointment } from '@prisma/client';
import { clientTelehealthJoinUrl } from '@/lib/telehealth/joinUrl';
import { parseTelehealthMeta } from '@/lib/telehealth/meta';
import { mapPatientAppointmentStatus } from '@/patient/domain/appointment-status';

export { mapPatientAppointmentStatus } from '@/patient/domain/appointment-status';
export type { PatientAppointmentStatus } from '@/patient/domain/appointment-status';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function localDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localTime(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type ApptRow = Appointment & {
  clinician: { name: string | null; id: string } | null;
};

export function serializePatientAppointment(row: ApptRow) {
  const meta = parseTelehealthMeta(row.notes);
  const now = Date.now();
  const joinUrl =
    row.isVirtual && row.status !== 'COMPLETED' && row.status !== 'CANCELLED'
      ? clientTelehealthJoinUrl({
          appointmentId: row.id,
          clientId: row.clientId,
          endsAt: row.endsAt,
          meta,
        })
      : null;

  return {
    id: row.id,
    type: row.type,
    date: localDate(row.startsAt),
    startTime: localTime(row.startsAt),
    endTime: localTime(row.endsAt),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: mapPatientAppointmentStatus(row),
    isVirtual: row.isVirtual,
    clinicianId: row.clinicianId,
    clinicianName: row.clinicianName?.trim() || row.clinician?.name || null,
    joinUrl,
    isUpcoming: row.endsAt.getTime() >= now && row.status !== 'COMPLETED',
    patientBooked: row.patientBooked,
    rescheduleRequestedAt: row.rescheduleRequestedAt?.toISOString() ?? null,
    declineReason: row.status === 'CANCELLED' ? (row.rescheduleNote || null) : null,
  };
}
