import type { AppointmentStatus as DbStatus } from '@prisma/client';

export type PatientAppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'reschedule_requested';

export function mapPatientAppointmentStatus(row: {
  status: DbStatus;
  patientBooked: boolean;
  rescheduleRequestedAt: Date | null;
}): PatientAppointmentStatus {
  if (row.status === 'CANCELLED' || row.status === 'LATE_CANCEL') return 'cancelled';
  if (row.status === 'COMPLETED') return 'completed';
  if (row.rescheduleRequestedAt) return 'reschedule_requested';
  if (row.patientBooked && row.status === 'SCHEDULED') return 'pending';
  return 'confirmed';
}
