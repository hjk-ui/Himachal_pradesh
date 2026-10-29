import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { StaffRole } from '@/types/roles';
import { homePathForRole, shouldBlockDashboardPath } from '@/lib/auth/roleAccess';
import { rejectUntrustedMutation } from '@/lib/security/request';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';

function isPublicApi(pathname: string) {
  return (
    pathname.startsWith('/api/patient') ||
    pathname.startsWith('/api/staff/invite/accept') ||
    pathname.startsWith('/api/intake/public') ||
    pathname.startsWith('/api/onboarding') ||
    pathname.startsWith('/api/measures/public') ||
    pathname.startsWith('/api/book') ||
    pathname.startsWith('/api/telehealth/join') ||
    pathname.startsWith('/api/telehealth/signal') ||
    pathname.startsWith('/api/scheduling/settings/public') ||
    pathname.startsWith('/api/scheduling/providers') ||
    pathname.startsWith('/api/scheduling/slots') ||
    pathname.startsWith('/api/scheduling/book') ||
    pathname === '/api/webhooks/stripe' ||
    pathname === '/api/billing/era/webhook' ||
    pathname === '/api/locations' ||
    pathname.startsWith('/api/locations') ||
    // SMART on FHIR discovery + CRISP OAuth (no staff cookie).
    // Patient/Practitioner use SMART Bearer in LIVE mode — not NextAuth staff session.
    pathname.startsWith('/fhir/.well-known') ||
    pathname === '/fhir/metadata' ||
    pathname.startsWith('/fhir/Patient') ||
    pathname.startsWith('/fhir/Practitioner') ||
    pathname.startsWith('/auth/smart')
  );
}

/** POST /fhir/launch requires staff session; other /fhir and /auth/smart are public. */
function isProtectedFhirLaunch(pathname: string) {
  return pathname === '/fhir/launch' || pathname.startsWith('/fhir/launch/');
}

/**
 * Staff session gate. Patient JWT cannot open /dashboard — only NextAuth staff can.
 * Public pages (/patient/*, /intake/*, /book/*, /invite/accept, /telehealth/join/*) are not in matcher.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = Boolean(req.auth);
  const role = (req.auth?.user?.role as StaffRole | undefined) ?? null;

  if (pathname.startsWith('/api/')) {
    const rejected = rejectUntrustedMutation(req);
    if (rejected) return rejected;

    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const webhook = pathname === '/api/webhooks/stripe' || pathname === '/api/billing/era/webhook';
    if (mutation && !webhook && !pathname.startsWith('/api/auth')) {
      const isAi = pathname.startsWith('/api/agents/') || pathname.includes('/ai/') ||
        pathname.endsWith('/aria') || pathname.endsWith('/chatbot');
      const limited = rateLimit(
        clientKey(req, isAi ? 'ai' : 'data-save'),
        isAi ? 30 : 60,
        60_000
      );
      if (!limited.ok) {
        return NextResponse.json({ success: false, error: 'Too many requests. Please try again shortly.' }, { status: 429 });
      }
    }
  }

  const isProtectedApi =
    ((pathname.startsWith('/api/') && !pathname.startsWith('/api/auth')) ||
      isProtectedFhirLaunch(pathname)) &&
    !isPublicApi(pathname);

  const isProtectedPage =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/clinician') ||
    pathname.startsWith('/platform');

  if ((isProtectedPage || isProtectedApi) && !isLoggedIn) {
    if (isProtectedApi || isProtectedFhirLaunch(pathname)) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && role === 'SUPER_ADMIN' && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/platform', req.nextUrl.origin));
  }

  if (
    isLoggedIn &&
    role &&
    role !== 'SUPER_ADMIN' &&
    pathname.startsWith('/platform')
  ) {
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin));
  }

  if (isLoggedIn && shouldBlockDashboardPath(role, pathname)) {
    return NextResponse.redirect(new URL(homePathForRole(role), req.nextUrl.origin));
  }

  // Logged-in users on /login normally go home.
  // EXCEPTION: layout may send /login?callbackUrl=/dashboard while JWT is still
  // "valid" to middleware but requireSession failed → that creates
  // ERR_TOO_MANY_REDIRECTS. Clear the session cookie and show login instead.
  if ((pathname === '/login' || pathname === '/') && isLoggedIn) {
    const authError = req.nextUrl.searchParams.get('error');
    const callbackUrl = req.nextUrl.searchParams.get('callbackUrl') || '';
    const loopSuspect =
      Boolean(authError) ||
      callbackUrl.startsWith('/dashboard') ||
      callbackUrl.startsWith('/platform');

    if (loopSuspect) {
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set('x-pathname', pathname);
      if (role) requestHeaders.set('x-active-role', role);
      const res = NextResponse.next({
        request: { headers: requestHeaders },
      });
      // Auth.js cookie names (secure + non-secure variants / chunks)
      const expire = {
        path: '/',
        maxAge: 0,
        httpOnly: true,
        secure: true,
        sameSite: 'lax' as const,
      };
      for (const name of [
        '__Secure-authjs.session-token',
        'authjs.session-token',
        '__Secure-next-auth.session-token',
        'next-auth.session-token',
      ]) {
        res.cookies.set(name, '', expire);
      }
      // Chunked session cookies (large JWTs)
      for (let i = 0; i < 5; i++) {
        res.cookies.set(`__Secure-authjs.session-token.${i}`, '', expire);
        res.cookies.set(`authjs.session-token.${i}`, '', expire);
      }
      return res;
    }

    return NextResponse.redirect(
      new URL(role === 'SUPER_ADMIN' ? '/platform' : '/dashboard', req.nextUrl.origin)
    );
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', pathname);
  if (role) requestHeaders.set('x-active-role', role);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
});

export const config = {
  matcher: [
    '/',
    '/dashboard',
    '/dashboard/:path*',
    '/platform',
    '/platform/:path*',
    '/clinician',
    '/clinician/:path*',
    '/login',
    '/api/((?!auth).*)',
    '/fhir',
    '/fhir/:path*',
    '/auth/smart',
    '/auth/smart/:path*',
  ],
};
