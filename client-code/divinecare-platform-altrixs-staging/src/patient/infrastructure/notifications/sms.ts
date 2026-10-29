import { sendPatientSms, type PatientSmsResult } from '@/lib/sms/patientSms';
import { portalInviteSms } from '@/lib/sms/templates';
import { getAppBaseUrl } from '@/lib/staff/invite';
import { appointmentConfirmationSms } from './templates';

/** Patient texts: both go through the consent gate (src/lib/sms/patientSms.ts). */
export async function sendAppointmentCreatedSms(input: {
  clientId: string;
  organizationId?: string | null;
  appointmentId?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  /** Practice zone of date/startTime/endTime (label only, no conversion). */
  timeZone?: string | null;
  actor?: { userId?: string | null; role?: string | null };
}): Promise<PatientSmsResult> {
  return sendPatientSms({
    clientId: input.clientId,
    organizationId: input.organizationId,
    appointmentId: input.appointmentId,
    purpose: 'appointment_confirmation',
    actor: input.actor,
    build: ({ sender }) =>
      appointmentConfirmationSms({
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        timeZone: input.timeZone,
        practiceName: sender,
      }),
  });
}

export async function sendPatientInviteSms(input: {
  clientId: string;
  organizationId?: string | null;
  rawToken: string;
}): Promise<PatientSmsResult> {
  const acceptUrl = `${getAppBaseUrl()}/patient/accept?token=${encodeURIComponent(input.rawToken)}`;
  return sendPatientSms({
    clientId: input.clientId,
    organizationId: input.organizationId,
    purpose: 'portal_invite',
    build: ({ sender }) => portalInviteSms({ sender, acceptUrl }),
  });
}
