import { sendSms } from '@/lib/sms/send';
import { getAppBaseUrl } from '@/lib/staff/invite';
import { appointmentConfirmationSms } from './templates';

export async function sendAppointmentCreatedSms(input: {
  to: string;
  type: string;
  date: string;
  startTime: string;
  endTime: string;
  isVirtual: boolean;
  joinUrl?: string | null;
  clinicianName?: string | null;
  clientId?: string | null;
}) {
  return sendSms({
    to: input.to,
    clientId: input.clientId,
    body: appointmentConfirmationSms(input),
    context: 'appointment-created',
  });
}

export async function sendPatientInviteSms(input: {
  to: string;
  rawToken: string;
}) {
  const acceptUrl = `${getAppBaseUrl()}/patient/accept?token=${encodeURIComponent(input.rawToken)}`;
  return sendSms({
    to: input.to,
    body: `Altrixs: set your password (expires in 7 days): ${acceptUrl}`,
    context: 'patient-invite',
  });
}

export async function sendAppointmentDeclinedSms(input: {
  to: string;
  clinicianName?: string | null;
  date: string;
  startTime: string;
  reason?: string | null;
}) {
  const provider = input.clinicianName?.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100) || 'Your clinician';
  const reasonText = input.reason?.trim() ? ` Reason: ${input.reason.trim().slice(0, 100)}` : '';
  return sendSms({
    to: input.to,
    body: `Altrixs: Your appointment request for ${input.date} at ${input.startTime} was declined by ${provider}.${reasonText} Open the app to book an alternate slot.`,
    context: 'appointment-declined',
  });
}

