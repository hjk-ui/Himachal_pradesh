import { sendEmail } from '@/lib/mail/sendEmail';
import { DEFAULT_PRACTICE_TIME_ZONE, practiceZoneLabel } from '@/lib/time/practiceTime';

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function platformLabel(platform: string) {
  if (platform === 'GOOGLE' || platform === 'google') return 'Google Meet';
  if (platform === 'ZOOM' || platform === 'zoom') return 'Zoom';
  if (platform === 'PHONE' || platform === 'phone') return 'Phone Call';
  return platform;
}

/**
 * "Monday, October 19, 2026 at 9:00 AM ET". `sessionDate` (YYYY-MM-DD) and `startTime` (HH:mm)
 * are already practice wall time: no zone conversion here. Passing a Date instant used to format
 * it on the server's UTC clock (an 8:30 PM ET visit was dated the next day).
 */
export function formatWhen(
  sessionDate: string,
  startTime: string,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE
) {
  const d = new Date(`${sessionDate}T12:00:00Z`);
  const dateLabel = Number.isNaN(d.getTime())
    ? sessionDate
    : d.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
  const [hRaw, mRaw] = startTime.split(':').map(Number);
  const h = Number.isNaN(hRaw) ? 0 : hRaw;
  const m = Number.isNaN(mRaw) ? 0 : mRaw;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const clock = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ampm}`;
  return `${dateLabel} at ${clock} ${practiceZoneLabel(timeZone)}`;
}

export async function sendTelehealthJoinEmail(input: {
  to: string;
  clientName: string;
  clinicianName: string;
  /** Practice wall date YYYY-MM-DD. */
  sessionDate: string;
  /** Practice wall time HH:mm. */
  startTime: string;
  /** Practice zone (labels the time, e.g. "ET"). */
  timeZone?: string | null;
  platform: string;
  joinUrl: string;
  extraNotes?: string | null;
}) {
  const provider = platformLabel(input.platform);
  const when = formatWhen(input.sessionDate, input.startTime, input.timeZone || undefined);
  const notes = input.extraNotes?.trim();

  const text = [
    `Hi ${input.clientName},`,
    '',
    `Your telehealth session with ${input.clinicianName} is scheduled for ${when}.`,
    `Join using ${provider}:`,
    input.joinUrl,
    notes ? `\nNote from your clinician:\n${notes}` : '',
    '',
    'If you did not expect this message, contact the clinic.',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 8px;color:#5C2D91">Your telehealth session</h2>
      <p style="margin:0 0 16px;color:#475569">Hi ${escapeHtml(input.clientName)},</p>
      <p style="margin:0 0 12px;color:#475569">
        Your session with <strong>${escapeHtml(input.clinicianName)}</strong> is scheduled for
        <strong>${escapeHtml(when)}</strong>.
      </p>
      <p style="margin:0 0 16px;color:#475569">Join with <strong>${escapeHtml(provider)}</strong>.</p>
      <p style="margin:0 0 20px">
        <a href="${escapeHtml(input.joinUrl)}"
           style="display:inline-block;background:#5C2D91;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600">
          Join ${escapeHtml(provider)}
        </a>
      </p>
      <p style="margin:0 0 16px;font-size:12px;word-break:break-all;color:#5C2D91">${escapeHtml(input.joinUrl)}</p>
      ${
        notes
          ? `<p style="margin:0 0 16px;color:#475569"><strong>Note:</strong> ${escapeHtml(notes)}</p>`
          : ''
      }
      <p style="margin:0;font-size:12px;color:#94a3b8">If you did not expect this email, contact the clinic.</p>
    </div>
  `;

  return sendEmail({
    to: input.to,
    subject: `Telehealth session (${provider}) — ${when}`,
    text,
    html,
    context: 'telehealth-join',
  });
}
