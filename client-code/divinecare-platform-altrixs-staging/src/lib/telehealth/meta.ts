const OPEN = '<!--altrixs-telehealth:';
const CLOSE = '-->';

export type TelehealthMeta = {
  provider?: 'zoom' | 'google' | 'phone' | 'in_app' | 'chime';
  zoomMeetingId?: string;
  zoomJoinUrl?: string;
  zoomStartUrl?: string;
  googleEventId?: string;
  googleMeetJoinUrl?: string;
  /** Amazon Chime SDK meeting id (system of record for video). */
  chimeMeetingId?: string;
  chimeExternalMeetingId?: string;
  /** Full CreateMeeting `Meeting` object — required to join later. */
  chimeMeeting?: Record<string, unknown>;
  chimeExpiresAt?: string;
  endedAt?: string;
  durationMinutes?: number;
  cptModifier?: string;
  placeOfService?: string;
  billingReady?: boolean;
  transcriptionStatus?: string;
};

export function parseTelehealthMeta(notes: string | null | undefined): TelehealthMeta {
  if (!notes) return {};
  const start = notes.indexOf(OPEN);
  if (start < 0) return {};
  const from = start + OPEN.length;
  const end = notes.indexOf(CLOSE, from);
  if (end < 0) return {};
  try {
    return JSON.parse(notes.slice(from, end)) as TelehealthMeta;
  } catch {
    return {};
  }
}

export function writeTelehealthMeta(notes: string | null | undefined, meta: TelehealthMeta): string {
  const base = (notes || '').replace(new RegExp(`${OPEN}[\\s\\S]*?${CLOSE}`), '').trim();
  const blob = `${OPEN}${JSON.stringify(meta)}${CLOSE}`;
  return base ? `${base}\n${blob}` : blob;
}

/** Hide Zoom host URLs from appointment notes in the UI. */
export function notesForStaffUi(notes: string | null | undefined): string | undefined {
  if (!notes) return undefined;
  const cleaned = notes.replace(new RegExp(`${OPEN}[\\s\\S]*?${CLOSE}`), '').trim();
  return cleaned || undefined;
}

/** Staff/host launch URL — Zoom start_url first, then any stored join URL. */
export function staffHostMeetingUrl(meta: TelehealthMeta): string | null {
  const start = meta.zoomStartUrl?.trim();
  if (start) return start;
  const zoomJoin = meta.zoomJoinUrl?.trim();
  if (zoomJoin) return zoomJoin;
  const meet = meta.googleMeetJoinUrl?.trim();
  if (meet) return meet;
  return null;
}
