import { sendEmail } from '@/lib/mail/sendEmail';
import { getAppBaseUrl } from '@/lib/staff/invite';

/**
 * Guardian / representative portal emails. NO PHI: never the client's name, date of birth, service,
 * clinician or clinic location; only the guardian's own name and a link. The guardian sees whose
 * account they can open after signing in.
 */

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function frame(greetingHtml: string, bodyHtml: string, buttonUrl: string, buttonLabel: string) {
  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <p style="margin:0 0 8px">${greetingHtml}</p>
      ${bodyHtml}
      <p style="margin:24px 0">
        <a href="${buttonUrl}" style="background:#5C2D91;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block">${buttonLabel}</a>
      </p>
      <p style="margin:0;color:#64748b;font-size:12px">If you did not expect this email, contact the clinic. Do not forward this email.</p>
    </div>`;
}

export async function sendGuardianInviteEmail(input: { to: string; guardianName: string; rawToken: string }) {
  const acceptUrl = `${getAppBaseUrl()}/patient/accept?token=${encodeURIComponent(input.rawToken)}`;
  const name = input.guardianName.trim();
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const text = [
    greeting,
    '',
    'Your clinic set up Altrixs portal access for you as a family member or representative.',
    'Set your password with this link, then sign in to see the account(s) you manage:',
    acceptUrl,
    '',
    'This invite expires in 7 days. Do not share this email.',
  ].join('\n');
  return sendEmail({
    to: input.to,
    subject: 'Set your Altrixs portal password',
    text,
    html: frame(
      name ? `Hi ${escapeHtml(name)},` : 'Hi,',
      '<p style="margin:0 0 12px">Your clinic set up Altrixs portal access for you as a family member or representative.</p><p style="margin:0">Set your password, then sign in to see the account(s) you manage. This invite expires in 7 days.</p>',
      acceptUrl,
      'Set my password'
    ),
    context: 'patient-guardian-invite',
  });
}

export async function sendGuardianAccessAddedEmail(input: { to: string; guardianName: string }) {
  const loginUrl = `${getAppBaseUrl()}/patient/login`;
  const name = input.guardianName.trim();
  const text = [
    name ? `Hi ${name},` : 'Hi,',
    '',
    'Your clinic added another account to your Altrixs portal login.',
    'Sign in and use "Viewing" at the top of the page to switch between accounts:',
    loginUrl,
  ].join('\n');
  return sendEmail({
    to: input.to,
    subject: 'Your Altrixs portal access was updated',
    text,
    html: frame(
      name ? `Hi ${escapeHtml(name)},` : 'Hi,',
      '<p style="margin:0">Your clinic added another account to your Altrixs portal login. Sign in and use <strong>Viewing</strong> at the top of the page to switch between accounts.</p>',
      loginUrl,
      'Sign in'
    ),
    context: 'patient-guardian-access-added',
  });
}
