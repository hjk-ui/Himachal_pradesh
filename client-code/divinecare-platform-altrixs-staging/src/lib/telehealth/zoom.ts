import 'server-only';

export type ZoomMeetingLinks = {
  meetingId: string;
  joinUrl: string;
  startUrl: string;
};

type TokenCache = { accessToken: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

export function isZoomConfigured() {
  return Boolean(
    process.env.ZOOM_ACCOUNT_ID &&
      process.env.ZOOM_CLIENT_ID &&
      process.env.ZOOM_CLIENT_SECRET &&
      process.env.ZOOM_HOST_EMAIL
  );
}

async function zoomAccessToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.accessToken;
  }
  const accountId = process.env.ZOOM_ACCOUNT_ID || '';
  const clientId = process.env.ZOOM_CLIENT_ID || '';
  const clientSecret = process.env.ZOOM_CLIENT_SECRET || '';
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Basic ${basic}` },
    }
  );
  const json = (await res.json()) as { access_token?: string; expires_in?: number; message?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.message || 'Zoom login failed. Check ZOOM_ACCOUNT_ID / CLIENT_ID / SECRET.');
  }
  tokenCache = {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
  };
  return json.access_token;
}

export async function createZoomMeeting(input: {
  topic: string;
  startAt: Date;
  durationMin?: number;
}): Promise<ZoomMeetingLinks> {
  if (!isZoomConfigured()) {
    throw new Error('Zoom is not configured');
  }
  const token = await zoomAccessToken();
  const host = process.env.ZOOM_HOST_EMAIL || '';
  const res = await fetch(
    `https://api.zoom.us/v2/users/${encodeURIComponent(host)}/meetings`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic: input.topic.slice(0, 200),
        type: 2,
        start_time: input.startAt.toISOString(),
        duration: input.durationMin ?? 45,
        timezone: 'UTC',
        settings: {
          waiting_room: true,
          join_before_host: false,
          mute_upon_entry: true,
          host_video: true,
          participant_video: true,
        },
      }),
    }
  );
  const json = (await res.json()) as {
    id?: number;
    join_url?: string;
    start_url?: string;
    message?: string;
  };
  if (!res.ok || !json.join_url || !json.start_url) {
    throw new Error(json.message || 'Could not create Zoom meeting');
  }
  return {
    meetingId: String(json.id || ''),
    joinUrl: json.join_url,
    startUrl: json.start_url,
  };
}
