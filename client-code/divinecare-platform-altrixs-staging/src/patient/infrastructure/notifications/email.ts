import { sendEmail } from '@/lib/mail/sendEmail';
import { getAppBaseUrl } from '@/lib/staff/invite';
import { practiceZoneLabel } from '@/lib/time/practiceTime';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emailButton(href: string, label: string) {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px">
      <tr>
        <td align="center" bgcolor="#141C34" style="border-radius:10px">
          <a href="${escapeHtml(href)}" target="_blank"
            style="display:inline-block;padding:12px 24px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

/**
 * `date` is already the practice wall date (YYYY-MM-DD): label that calendar day as is, with no
 * zone conversion (noon UTC formatted in UTC is the same day everywhere).
 */
function formatDateLabel(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatClock(hhmm: string) {
  const [hRaw, mRaw] = hhmm.split(':').map(Number);
  if (Number.isNaN(hRaw)) return hhmm;
  const m = Number.isNaN(mRaw) ? 0 : mRaw;
  const ampm = hRaw >= 12 ? 'PM' : 'AM';
  return `${((hRaw + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ampm}`;
}

function videoProviderLabel(provider?: string | null) {
  if (provider === 'google') return 'Google Meet';
  if (provider === 'zoom') return 'Zoom';
  if (provider === 'in_app') return 'In-app video';
  return null;
}

function fieldRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding:8px 12px 8px 0;vertical-align:top;color:#64748b;font-size:13px;white-space:nowrap">${escapeHtml(label)}</td>
      <td style="padding:8px 0;vertical-align:top;color:#0f172a;font-size:14px;font-weight:600">${escapeHtml(value)}</td>
    </tr>`;
}

export async function sendAppointmentCreatedEmail(input: {
  to: string;
  clientName: string;
  type: string;
  date: string;
  startTime: string;
  endTime: string;
  isVirtual: boolean;
  clinicianName?: string | null;
  videoProvider?: 'zoom' | 'google' | 'in_app' | null;
  joinUrl?: string | null;
  /** Practice zone of date/startTime/endTime (they are already practice wall time; label only). */
  timeZone?: string | null;
}) {
  const displayName = input.clientName.trim();
  const safeName = escapeHtml(displayName);
  const greeting = displayName ? `Hi ${displayName},` : 'Hi,';
  const greetingHtml = displayName ? `Hi ${safeName},` : 'Hi,';
  const dateLabel = formatDateLabel(input.date);
  const zone = practiceZoneLabel(input.timeZone || undefined);
  const startLabel = `${formatClock(input.startTime)} ${zone}`;
  const endLabel = `${formatClock(input.endTime)} ${zone}`;
  const visitLabel = input.isVirtual ? 'Virtual' : 'In person';
  const meetingLabel = input.isVirtual ? videoProviderLabel(input.videoProvider) : null;
  const clinician = input.clinicianName?.trim() || '';
  const joinUrl = input.isVirtual ? input.joinUrl?.trim() || '' : '';
  const loginUrl = `${getAppBaseUrl()}/patient/login`;
  const subject = `Appointment confirmed — ${dateLabel}`;

  const textLines = [
    greeting,
    '',
    'Your appointment with Altrixs is confirmed.',
    '',
    `Client: ${displayName || '—'}`,
    `Type: ${input.type}`,
    `Date: ${dateLabel}`,
    `Start: ${startLabel}`,
    `End: ${endLabel}`,
    `Visit: ${visitLabel}`,
  ];
  if (meetingLabel) textLines.push(`Meeting: ${meetingLabel}`);
  if (clinician) textLines.push(`Clinician: ${clinician}`);
  if (joinUrl) {
    textLines.push('', 'Join telehealth:', joinUrl);
  }
  textLines.push('', 'Sign in to Altrixs to view your appointments.');

  let htmlRows = [
    fieldRow('Client', displayName || '—'),
    fieldRow('Type', input.type),
    fieldRow('Date', dateLabel),
    fieldRow('Start', startLabel),
    fieldRow('End', endLabel),
    fieldRow('Visit', visitLabel),
  ].join('');
  if (meetingLabel) htmlRows += fieldRow('Meeting', meetingLabel);
  if (clinician) htmlRows += fieldRow('Clinician', clinician);

  return sendEmail({
    to: input.to,
    subject,
    text: textLines.join('\n'),
    html: `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <p style="margin:0 0 8px">${greetingHtml}</p>
      <p style="margin:0 0 20px">Your appointment with Altrixs is confirmed.</p>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 24px">
        ${htmlRows}
      </table>
      ${joinUrl ? emailButton(joinUrl, 'Join telehealth') : ''}
      ${emailButton(loginUrl, 'Sign in to Altrixs')}
      <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">If you did not expect this appointment, contact the clinic.</p>
    </div>`,
    context: 'appointment-created',
  });
}

export async function sendPatientInviteEmail(input: {
  to: string;
  name: string;
  rawToken: string;
}) {
  const acceptUrl = `${getAppBaseUrl()}/patient/accept?token=${encodeURIComponent(input.rawToken)}`;
  const loginUrl = `${getAppBaseUrl()}/patient/login`;
  const displayName = input.name.trim();
  const safeName = escapeHtml(displayName);
  const greeting = displayName ? `Hi ${displayName},` : 'Hi,';
  const greetingHtml = displayName ? `Hi ${safeName},` : 'Hi,';
  const welcomeLine = 'Welcome to Altrixs.';
  const subject = 'Set your Altrixs password';
  const text = [
    greeting,
    welcomeLine,
    '',
    'Your clinic created an Altrixs account for you.',
    'Use the buttons below to set your password, then sign in. Do not share this email.',
    '',
    'This invite expires in 7 days.',
  ].join('\n');

  return sendEmail({
    to: input.to,
    subject,
    text,
    html: `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <p style="margin:0 0 8px">${greetingHtml}</p>
      <p style="margin:0 0 16px">${welcomeLine}</p>
      <p style="margin:0 0 20px">Your clinic created an Altrixs account for you. Use the buttons below — do not share this email.</p>
      ${emailButton(acceptUrl, 'Set your password')}
      ${emailButton(loginUrl, 'Sign in')}
      <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">The password button expires in 7 days.</p>
    </div>`,
    context: 'patient-invite',
  });
}

export async function sendPatientEmailChangedNotification(input: {
  to: string;
  name: string;
}) {
  const loginUrl = `${getAppBaseUrl()}/patient/login`;
  const displayName = input.name.trim();
  const safeName = escapeHtml(displayName);
  const greeting = displayName ? `Hi ${displayName},` : 'Hi,';
  const greetingHtml = displayName ? `Hi ${safeName},` : 'Hi,';
  const subject = 'Your Altrixs portal login email has been updated';
  const text = [
    greeting,
    '',
    'Your Altrixs patient portal login email has been updated to this address.',
    'You can sign in to the portal or mobile app using your existing password, or reset your password if needed from the sign-in screen.',
    '',
    `Sign in: ${loginUrl}`,
    '',
    'If you did not request or authorize this change, please contact your clinic immediately.',
  ].join('\n');

  return sendEmail({
    to: input.to,
    subject,
    text,
    html: `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <p style="margin:0 0 8px">${greetingHtml}</p>
      <p style="margin:0 0 16px;font-weight:600;color:#141C34">Your Altrixs patient portal login email has been updated to this address.</p>
      <p style="margin:0 0 20px;color:#475569;line-height:1.5">You can sign in to the patient portal or mobile app using your existing password. If you do not remember your password, tap "Forgot Password" on the sign-in screen to set a new one.</p>
      ${emailButton(loginUrl, 'Sign in to Patient Portal')}
      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">If you did not authorize this change, please contact your clinic immediately.</p>
    </div>`,
    context: 'patient-email-updated',
  });
}

