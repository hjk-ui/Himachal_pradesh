import 'server-only';
import { createSign, randomUUID } from 'crypto';
import { readFile } from 'fs/promises';

export type GoogleMeetLinks = {
  eventId: string;
  joinUrl: string;
};

type TokenCache = { accessToken: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

function readEnv(key: string): string {
  return (process.env[key] || '').trim();
}

function calendarId() {
  return readEnv('GOOGLE_CALENDAR_ID') || 'primary';
}

function oauthCreds() {
  const clientId = readEnv('GOOGLE_CLIENT_ID') || readEnv('GOOGLE_CALENDAR_CLIENT_ID');
  const clientSecret = readEnv('GOOGLE_CLIENT_SECRET') || readEnv('GOOGLE_CALENDAR_CLIENT_SECRET');
  const refreshToken = readEnv('GOOGLE_REFRESH_TOKEN') || readEnv('GOOGLE_CALENDAR_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

async function serviceAccountPayload(): Promise<{
  client_email: string;
  private_key: string;
} | null> {
  const inline = readEnv('GOOGLE_SERVICE_ACCOUNT_JSON');
  const filePath = readEnv('GOOGLE_APPLICATION_CREDENTIALS') || readEnv('GOOGLE_SERVICE_ACCOUNT_JSON_PATH');
  let raw = inline;
  if (!raw && filePath) {
    try {
      raw = await readFile(filePath, 'utf8');
    } catch {
      throw new Error('Google Meet not configured');
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
    };
  } catch {
    return null;
  }
}

export async function isGoogleMeetConfigured() {
  if (oauthCreds()) return true;
  const sa = await serviceAccountPayload().catch(() => null);
  return Boolean(sa);
}

function signRs256Jwt(unsigned: string, privateKeyPem: string) {
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return signer.sign(privateKeyPem, 'base64url');
}

async function googleAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.accessToken;
  }

  const oauth = oauthCreds();
  if (oauth) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: oauth.refreshToken,
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new Error(json.error_description || json.error || 'Google Meet login failed. Check GOOGLE_REFRESH_TOKEN.');
    }
    tokenCache = {
      accessToken: json.access_token,
      expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
    };
    return json.access_token;
  }

  const sa = await serviceAccountPayload();
  if (!sa) {
    throw new Error('Google Meet not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const impersonate = readEnv('GOOGLE_CALENDAR_IMPERSONATE') || readEnv('GOOGLE_WORKSPACE_USER');
  const claims: Record<string, string | number> = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  if (impersonate) claims.sub = impersonate;

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const jwt = `${unsigned}.${signRs256Jwt(unsigned, sa.private_key)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || 'Google Meet service account login failed.');
  }
  tokenCache = {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
  };
  return json.access_token;
}

function meetUrlFromEvent(json: {
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
    createRequest?: { status?: { statusCode?: string } };
  };
}): string | null {
  if (json.hangoutLink) return json.hangoutLink;
  const entries = json.conferenceData?.entryPoints || [];
  const video = entries.find((e) => e.entryPointType === 'video' && e.uri);
  return video?.uri || entries.find((e) => e.uri?.includes('meet.google.com'))?.uri || null;
}

export async function createGoogleMeet(input: {
  topic: string;
  startAt: Date;
  durationMin?: number;
}): Promise<GoogleMeetLinks> {
  if (!(await isGoogleMeetConfigured())) {
    throw new Error('Google Meet not configured');
  }

  const token = await googleAccessToken();
  const duration = input.durationMin ?? 50;
  const endAt = new Date(input.startAt.getTime() + duration * 60_000);
  const cal = encodeURIComponent(calendarId());
  const requestId = randomUUID();

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${cal}/events?conferenceDataVersion=1`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: input.topic.slice(0, 200),
        description: 'Altrixs telehealth session',
        start: { dateTime: input.startAt.toISOString() },
        end: { dateTime: endAt.toISOString() },
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      }),
    }
  );

  const json = (await res.json()) as {
    id?: string;
    hangoutLink?: string;
    error?: { message?: string };
    conferenceData?: {
      entryPoints?: { entryPointType?: string; uri?: string }[];
      createRequest?: { status?: { statusCode?: string } };
    };
  };

  if (!res.ok) {
    throw new Error(json.error?.message || 'Could not create Google Meet event');
  }

  const joinUrl = meetUrlFromEvent(json);
  if (!joinUrl) {
    throw new Error(
      'Google Calendar did not return a Meet link. Enable Google Meet on the calendar and grant calendar.events scope.'
    );
  }

  return { eventId: json.id || requestId, joinUrl };
}
