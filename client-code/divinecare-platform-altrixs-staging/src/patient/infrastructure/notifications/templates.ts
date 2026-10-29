import { practiceZoneLabel } from '@/lib/time/practiceTime';

export interface AppointmentSmsInput {
  /** Practice wall date (YYYY-MM-DD) and HH:mm times, already on the practice clock. */
  date: string;
  startTime: string;
  endTime: string;
  /** Accepted for older callers but NEVER printed: an SMS / lock screen shows no clinician name. */
  clinicianName?: string | null;
  /** Sender identification (CTIA). Defaults to "Altrixs". */
  practiceName?: string | null;
  /** Practice zone the date/times are in (labels them "ET"); defaults to America/New_York. */
  timeZone?: string | null;
}

/**
 * Deliberate allowlist: practice name, date and time only. Never the clinician's name, client,
 * service / visit type, diagnosis, join link or free-text notes (minimum necessary: a lock-screen
 * text "with Dr. X" discloses a psychiatric relationship).
 */
export function appointmentConfirmationSms(input: AppointmentSmsInput): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : '';
  const time = (value: string) => /^\d{2}:\d{2}$/.test(value) ? value : '';
  const zone = practiceZoneLabel(input.timeZone || undefined);
  const sender = input.practiceName?.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60) || 'Altrixs';
  return `${sender}: Appointment ${date} ${time(input.startTime)}–${time(input.endTime)} ${zone}. Open your patient portal for details. Reply STOP to opt out.`;
}
