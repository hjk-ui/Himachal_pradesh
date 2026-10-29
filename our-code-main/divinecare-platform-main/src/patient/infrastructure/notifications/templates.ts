export interface AppointmentSmsInput {
  date: string;
  startTime: string;
  endTime: string;
  clinicianName?: string | null;
}

/** Deliberate allowlist: never interpolate client, service, diagnosis, or free-text notes. */
export function appointmentConfirmationSms(input: AppointmentSmsInput): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : '';
  const time = (value: string) => /^\d{2}:\d{2}$/.test(value) ? value : '';
  const provider = input.clinicianName?.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100);
  return `Altrixs: Appointment ${date} ${time(input.startTime)}–${time(input.endTime)}${provider ? ` with ${provider}` : ''}. Open your patient portal for details.`;
}
