import { NextResponse, type NextRequest } from 'next/server';
import { handlers, auth } from '@/lib/auth';
import { rejectUntrustedMutation } from '@/lib/security/request';
import { ACTIVITY_COOKIE, isAbsoluteExpired } from '@/lib/security/idleSession';

export const runtime = 'nodejs';

/**
 * This static route shadows the NextAuth catch-all for /api/auth/session, so every
 * NextAuth behaviour is delegated back to `handlers` untouched:
 *   GET  → session read (useSession / getSession)
 *   POST → session update (useSession().update) — anything that is not the activity ping
 *
 * The idle heartbeat is a *silent* POST { activity: true }. It never goes through
 * useSession().update(), so next-auth never flips status to "loading" and the UI
 * does not blink.
 */
export function GET(req: NextRequest) {
  return handlers.GET(req);
}

function isActivityPing(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const keys = Object.keys(body as Record<string, unknown>);
  return keys.length === 1 && (body as { activity?: unknown }).activity === true;
}

export async function POST(req: NextRequest) {
  const ping = await req
    .clone()
    .json()
    .then(isActivityPing)
    .catch(() => false);

  if (!ping) return handlers.POST(req);

  const rejected = rejectUntrustedMutation(req);
  if (rejected) return rejected;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (isAbsoluteExpired(session.user.loginAt)) {
    return NextResponse.json(
      { success: false, error: 'Session expired', code: 'SESSION_EXPIRED' },
      { status: 401 }
    );
  }

  const now = Date.now();
  const res = NextResponse.json({ success: true, lastActivityAt: now });
  res.cookies.set(ACTIVITY_COOKIE, String(now), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60,
  });
  return res;
}
