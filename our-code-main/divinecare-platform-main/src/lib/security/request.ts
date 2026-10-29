import { NextResponse } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function expectedOrigins(req: Request) {
  const values = new Set<string>();
  const configured = [process.env.AUTH_URL, process.env.NEXT_PUBLIC_APP_URL]
    .filter(Boolean)
    .map((value) => value!.trim());
  for (const value of configured) {
    try { values.add(new URL(value).origin); } catch { /* invalid config is ignored here */ }
  }

  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host');
  if (host) values.add(`${proto || new URL(req.url).protocol.replace(':', '')}://${host}`);
  values.add(new URL(req.url).origin);
  return values;
}

export function isTrustedMutationRequest(req: Request) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;

  const fetchSite = req.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite === 'cross-site') return false;

  const origin = req.headers.get('origin');
  if (!origin) return true; // Native apps and server-to-server callers do not send Origin.
  try {
    return expectedOrigins(req).has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function rejectUntrustedMutation(req: Request): NextResponse | null {
  return isTrustedMutationRequest(req)
    ? null
    : NextResponse.json({ success: false, error: 'Request origin is not allowed' }, { status: 403 });
}
