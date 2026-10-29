import type { Appointment } from '@prisma/client';
import { clientTelehealthJoinUrl } from '@/lib/telehealth/joinUrl';
import { parseTelehealthMeta } from '@/lib/telehealth/meta';
import { mapPatientAppointmentStatus } from '@/patient/domain/appointment-status';
import {
  DEFAULT_PRACTICE_TIME_ZONE,
  practiceZoneLabel,
  toPracticeWallTime,
} from '@/lib/time/practiceTime';

export { mapPatientAppointmentStatus } from '@/patient/domain/appointment-status';
export type { PatientAppointmentStatus } from '@/patient/domain/appointment-status';

/**
 * Appointment date / time on the PRACTICE clock. The server runs in UTC, so getHours()/getDate()
 * here printed a 9:00 AM ET visit as 13:00.
 */
export function localDate(d: Date, timeZone: string = DEFAULT_PRACTICE_TIME_ZONE) {
  return toPracticeWallTime(d, timeZone).date;
}

export function localTime(d: Date, timeZone: string = DEFAULT_PRACTICE_TIME_ZONE) {
  return toPracticeWallTime(d, timeZone).time;
}

type ApptRow = Appointment & {
  clinician: { name: string | null; id: string } | null;
};

export function serializePatientAppointment(
  row: ApptRow,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE
) {
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
    date: localDate(row.startsAt, timeZone),
    startTime: localTime(row.startsAt, timeZone),
    endTime: localTime(row.endsAt, timeZone),
    /** date / startTime / endTime are wall-clock times in this zone. */
    timeZone,
    timeZoneLabel: practiceZoneLabel(timeZone),
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
  };
}
