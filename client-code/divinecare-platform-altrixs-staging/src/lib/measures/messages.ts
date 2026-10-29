/**
 * Patient messages for a measure link (pure). NO PHI: no measure name, no clinician, no visit type,
 * no diagnosis, no patient name. The practice name and the link only; the link asks for the date of
 * birth before anything is shown. Crisis resources (988) are on the page itself, not in the
 * message. Texts: src/lib/sms/templates.ts measureRequestSms (through the patient SMS gate).
 */
import { getAppBaseUrl } from '@/lib/staff/invite';

export function measureLinkUrl(rawToken: string, base: string = getAppBaseUrl()): string {
  return `${base.replace(/\/$/, '')}/m/${rawToken}`;
}

export function measureRequestEmail(practiceName: string | null | undefined, url: string): { subject: string; text: string; html: string } {
  const from = practiceName?.replace(/[\r\n\t]+/g, ' ').trim() || 'Your care team';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const text =
    `Hello,\n\nYou have a short questionnaire from ${from} before your visit. It takes a few minutes:\n${url}\n\n` +
    `For your privacy you will be asked for your date of birth first. The link works for 7 days.\n\n` +
    `If you have questions, call the office.\n\n${from}`;
  const html =
    `<p>Hello,</p><p>You have a short questionnaire from ${esc(from)} before your visit. It takes a few minutes.</p>` +
    `<p><a href="${esc(url)}" style="display:inline-block;padding:12px 20px;background:#5C2D91;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">Start the questionnaire</a></p>` +
    `<p style="color:#475569;font-size:13px">For your privacy you will be asked for your date of birth first. The link works for 7 days.</p>` +
    `<p style="color:#475569;font-size:13px">If you have questions, call the office.</p><p>${esc(from)}</p>`;
  return { subject: `${from}: a short questionnaire before your visit`, text, html };
}
