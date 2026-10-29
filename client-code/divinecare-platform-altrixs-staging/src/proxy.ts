import { NextResponse, type NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { buildCsp, cspHeaderName, generateNonce } from '@/lib/security/csp';
import { auth } from '@/lib/auth';
import { isMedicalRole, type StaffRole } from '@/types/roles';
import { canAccessApiPath, homePathForRole, shouldBlockDashboardPath } from '@/lib/auth/roleAccess';

function isPublicApi(pathname: string) {
  return (
    pathname.startsWith('/api/patient') ||
    // Uploaded files: the route checks the staff session OR the patient app's bearer token itself
    pathname.startsWith('/api/files/') ||
    pathname.startsWith('/api/staff/invite/accept') ||
    pathname.startsWith('/api/intake/public') ||
    // Measure links (/m/<token>): token + date of birth checked by the route, rate limited
    pathname.startsWith('/api/measures/public/') ||
    // Practice Notice of Privacy Practices PDF (a public notice, not PHI); its POST checks the staff session itself
    pathname === '/api/consents/library/npp' ||
    pathname.startsWith('/api/onboarding') ||
    pathname.startsWith('/api/book') ||
    // Growth & Marketing public endpoints: hosted intake form / event registration (rate limited,
    // honeypot), signed one-click unsubscribe, and the automation cron (Bearer CRON_SECRET)
    pathname.startsWith('/api/marketing/public/') ||
    pathname.startsWith('/api/telehealth/join') ||
    pathname.startsWith('/api/telehealth/signal') ||
    pathname.startsWith('/api/scheduling/settings/public') ||
    pathname.startsWith('/api/scheduling/providers') ||
    pathname.startsWith('/api/scheduling/slots') ||
    pathname.startsWith('/api/scheduling/book') ||
    // Build version only (src/lib/version.ts): used to verify deploys
    pathname === '/api/version' ||
    // Liveness (no DB) and readiness (DB SELECT 1): load balancer / deploy checks, no secrets
    pathname === '/api/health' ||
    pathname === '/api/ready' ||
    pathname === '/api/webhooks/stripe' ||
    // Patient payments (practice Stripe account): the route verifies its own Stripe signature secret
    pathname === '/api/webhooks/stripe-patient-payments' ||
    pathname === '/api/billing/era/webhook' ||
    // Machine callers, each authenticated by the route itself: cron (Bearer CRON_SECRET), AWS SNS
    // two-way SMS (SNS signature + topic ARN), one-click email unsubscribe (signed token).
    pathname === '/api/cron/notifications' ||
    pathname === '/api/sms/inbound' ||
    pathname === '/api/notifications/unsubscribe' ||
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
 * Public pages (/patient/*, /intake/*, /book/*, /invite/accept, /telehealth/join/*) pass through the
 * proxy only for the CSP header; the gate leaves them alone.
 */
/** Incoming x-request-id when it looks like an id (no log injection), else a new UUID. */
function requestIdFor(headers: Headers): string {
  const incoming = headers.get('x-request-id')?.trim();
  if (incoming && /^[A-Za-z0-9._:-]{8,128}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

/** Per-request Content-Security-Policy (src/lib/security/csp.ts): nonce for Next.js scripts. */
type Security = { nonce: string; csp: string; header: string };

function securityFor(pathname: string): Security {
  const nonce = generateNonce();
  return {
    nonce,
    csp: buildCsp({ nonce, pathname, dev: process.env.NODE_ENV === 'development' }),
    header: cspHeaderName(),
  };
}

/** Request headers for the route: correlation id, CSP (Next.js takes the nonce from it), active role. */
function forwardHeaders(req: NextRequest, requestId: string, sec: Security, role?: string | null): Headers {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', req.nextUrl.pathname);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('x-nonce', sec.nonce);
  requestHeaders.set(sec.header.toLowerCase(), sec.csp);
  if (role) requestHeaders.set('x-active-role', role);
  return requestHeaders;
}

function finish(req: NextRequest, res: NextResponse, requestId: string, sec: Security): NextResponse {
  res.headers.set('x-request-id', requestId);
  // Pages only: API responses are JSON / file downloads (a CSP on a PDF opened in a tab can break the
  // browser's PDF viewer), and they render no HTML that a policy would protect.
  if (!req.nextUrl.pathname.startsWith('/api/')) res.headers.set(sec.header, sec.csp);
  return res;
}

const authProxy = auth((req) => {
  // Correlation id: forwarded to the route (request header) and echoed on every response.
  const requestId = requestIdFor(req.headers);
  const sec = securityFor(req.nextUrl.pathname);
  return finish(req, gate(req, requestId, sec), requestId, sec);
});

export default function proxy(req: NextRequest, ctx: unknown) {
  // Auth.js routes (/api/auth/*, incl. the session heartbeat) skip the session read here: refreshing
  // the cookie in the proxy as well would race the route's own Set-Cookie (e.g. lastActivity).
  if (req.nextUrl.pathname.startsWith('/api/auth')) {
    const requestId = requestIdFor(req.headers);
    const sec = securityFor(req.nextUrl.pathname);
    return finish(req, NextResponse.next({ request: { headers: forwardHeaders(req, requestId, sec) } }), requestId, sec);
  }
  return (authProxy as unknown as (r: NextRequest, c: unknown) => Promise<Response>)(req, ctx);
}

function gate(req: NextAuthRequest, requestId: string, sec: Security): NextResponse {
  const { pathname } = req.nextUrl;
  const isLoggedIn = Boolean(req.auth);
  const role = (req.auth?.user?.role as StaffRole | undefined) ?? null;
  // Medical Director claim from the JWT: opens the oversight pages / APIs at this gate only. Routes
  // and the dashboard layout re-verify it from the database (requireSession), which is authoritative.
  const caps = { medicalDirector: Boolean(req.auth?.user?.medicalDirector) };

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
    return NextResponse.redirect(new URL(homePathForRole(role), req.nextUrl.origin));
  }

  // API role gate (roleAccess API_PATH_ACCESS): same role lists as the pages each API serves.
  // Route-level checks (caseload scope, Part 2, prescriber, ...) still run after this.
  if (isLoggedIn && isProtectedApi && role && !canAccessApiPath(role, pathname, req.method, caps)) {
    return NextResponse.json(
      { success: false, error: 'Your role cannot use this feature' },
      { status: 403 }
    );
  }

  // /dashboard is the role home for most roles; primary care roles and crisis responders have
  // their own landing page (homePathForRole). Send them there server-side, before any render.
  if (isLoggedIn && role && role !== 'SUPER_ADMIN' && pathname === '/dashboard') {
    const home = homePathForRole(role);
    if (home !== '/dashboard') {
      return NextResponse.redirect(new URL(home, req.nextUrl.origin));
    }
  }

  // Primary care roles: their patient list is the primary care list, not the behavioral health
  // client directory (the shared client chart /dashboard/clients/[id] still opens).
  if (isLoggedIn && role && isMedicalRole(role) && pathname === '/dashboard/clients') {
    return NextResponse.redirect(new URL('/dashboard/medical/patients', req.nextUrl.origin));
  }

  // A page the role cannot open -> the role's own landing page (never another blocked page).
  if (isLoggedIn && shouldBlockDashboardPath(role, pathname, caps)) {
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
      const res = NextResponse.next({
        request: { headers: forwardHeaders(req, requestId, sec, role) },
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

    return NextResponse.redirect(new URL(homePathForRole(role), req.nextUrl.origin));
  }

  return NextResponse.next({
    request: { headers: forwardHeaders(req, requestId, sec, role) },
  });
}

export const config = {
  // Every page except build assets and public files: the CSP header (with its nonce) must be on every
  // page. Staff areas and all APIs are listed explicitly so no file-like path ever skips the gate; the
  // session gate above only acts on the staff pages / APIs it lists.
  matcher: [
    '/',
    '/dashboard/:path*',
    '/platform/:path*',
    '/clinician/:path*',
    '/api/:path*',
    '/fhir/:path*',
    '/auth/smart/:path*',
    '/((?!api/|_next/static|_next/image|uploads/|icons/|favicon\\.ico|favicon\\.png|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|webmanifest|txt|xml|map|woff2?|ttf|pdf|mp4|mp3|wav)$).*)',
  ],
};
