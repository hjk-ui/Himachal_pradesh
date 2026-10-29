import { getAppBaseUrl } from '@/lib/staff/invite';
import { createTelehealthJoinToken } from '@/lib/telehealth/join-token';
import type { TelehealthMeta } from '@/lib/telehealth/meta';

/**
 * Client-facing join URL only — never Zoom start/host URLs.
 * Zoom → zoomJoinUrl, Google Meet → googleMeetJoinUrl,
 * in-app → /telehealth/join/[token] valid through the visit.
 */
export function clientTelehealthJoinUrl(input: {
  appointmentId: string;
  clientId: string;
  endsAt: Date;
  meta: TelehealthMeta;
}): string | null {
  const provider = input.meta.provider || 'in_app';
  if (provider === 'zoom') {
    const url = input.meta.zoomJoinUrl?.trim();
    return url || null;
  }
  if (provider === 'google') {
    const url = input.meta.googleMeetJoinUrl?.trim();
    return url || null;
  }

  const untilEndMin = Math.ceil((input.endsAt.getTime() - Date.now()) / 60000);
  const expiresInMinutes = Math.max(180, untilEndMin + 120);
  const token = createTelehealthJoinToken({
    appointmentId: input.appointmentId,
    clientId: input.clientId,
    expiresInMinutes,
  });
  return `${getAppBaseUrl()}/telehealth/join/${encodeURIComponent(token)}`;
}
