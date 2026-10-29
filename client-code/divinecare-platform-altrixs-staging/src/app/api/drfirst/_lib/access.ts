import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import type { Prisma, Role } from '@prisma/client';
import { canPrescribe } from '@/types/roles';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { assertClientPhiAccess, lockedSensitiveClientIds, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { drFirstCallerNeedsUsername } from '@/lib/drfirst/ssoPolicy';

/**
 * Who is calling a /api/drfirst/* route. The Rcopia username is ALWAYS the
 * caller's own User.rcopiaUsername; no route reads a DrFirst username from the
 * request, so nobody can act in Rcopia as another prescriber.
 */
export interface DrFirstCaller {
  userId: string;
  role: string;
  organizationId: string;
  isPrescriber: boolean;
  isAdmin: boolean;
  rcopiaUsername: string | null;
  npi: string | null;
  name: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Exactly one of caller / response is set (the repo compiles with strict: false, so no discriminated union). */
type GateResult = { caller: DrFirstCaller; response: null } | { caller: null; response: NextResponse };

/**
 * Requires a clinic user who is a prescriber (canPrescribe), or ADMIN when
 * `allowAdmin` is set. With `requireRcopiaUser`, a prescriber OR an admin without
 * their own DrFirst username on their staff profile is refused (409): an admin no
 * longer makes practice-level (no RcopiaUserName) calls on those routes. The only
 * exception is `adminPracticeLevel` (badge counts: practice totals, no patient data).
 * Future work: a "DrFirst staff user type" for non-prescriber Rcopia logins.
 */
export async function requireDrFirstCaller(
  req: Request,
  opts: { allowAdmin?: boolean; requireRcopiaUser?: boolean; adminPracticeLevel?: boolean } = {},
): Promise<GateResult> {
  const gate = await requireOrgContext();
  if (!gate.ok) return { caller: null, response: NextResponse.json({ error: gate.error }, { status: gate.status }) };

  const role = String(gate.role);
  const isPrescriber = canPrescribe(role);
  const isAdmin = role === 'ADMIN';
  if (!isPrescriber && !(opts.allowAdmin && isAdmin)) {
    return {
      caller: null,
      response: NextResponse.json({ error: 'Only prescribers can use e-prescribing.' }, { status: 403 }),
    };
  }

  const me = await prisma.user.findUnique({
    where: { id: gate.userId },
    select: { rcopiaUsername: true, npi: true, name: true },
  });
  const rcopiaUsername = me?.rcopiaUsername?.trim() || null;
  if (!rcopiaUsername && drFirstCallerNeedsUsername({ isPrescriber, isAdmin, ...opts })) {
    return {
      caller: null,
      response: NextResponse.json(
        { error: 'Your DrFirst username is not set on your staff profile. Ask an administrator to add it.' },
        { status: 409 },
      ),
    };
  }

  return {
    response: null,
    caller: {
      userId: gate.userId,
      role,
      organizationId: gate.organizationId,
      isPrescriber,
      isAdmin,
      rcopiaUsername,
      npi: me?.npi?.trim() || null,
      name: me?.name?.trim() || null,
      ...auditRequestMeta(req),
    },
  };
}

/**
 * Cron callers present CRON_SECRET either as `Authorization: Bearer <secret>`
 * (the /api/cron/* convention) or as `x-cron-secret: <secret>`. Unset secret = reject.
 */
export function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const bearer = req.headers.get('authorization');
  const presented = req.headers.get('x-cron-secret')?.trim() || (bearer?.startsWith('Bearer ') ? bearer.slice(7).trim() : '');
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Org + caseload scope for the DrFirst chart routes (clientAccessWhere): leadership and the
 * database-verified Medical Director see the organization; prescribers and other caseload roles only
 * their caseload (assigned, treatment team, or an appointment in the last ~18 months / upcoming, so a
 * covering prescriber reaches the client through the appointment). Part 2 / sensitive locks are
 * separate: use findDrFirstClient, which applies both.
 */
export function drFirstClientWhere(caller: Pick<DrFirstCaller, 'organizationId' | 'userId' | 'role'>, clientId: string): Prisma.ClientWhereInput {
  return {
    id: clientId,
    ...clientAccessWhere({ organizationId: caller.organizationId, actorUserId: caller.userId, actorRole: caller.role as Role }),
  };
}

type DrFirstClientResult<T> = { client: T; response: null } | { client: null; response: NextResponse };

/**
 * One-client lookup for a DrFirst route: caseload scope (drFirstClientWhere), then the 42 CFR Part 2 /
 * sensitive-record lock (assertClientPhiAccess, logged in SensitiveAccessLog). 404 when out of scope,
 * 403 SENSITIVE_RECORD (break-glass offered) when locked.
 */
export async function findDrFirstClient<S extends Prisma.ClientSelect>(
  caller: Pick<DrFirstCaller, 'organizationId' | 'userId' | 'role'>,
  clientId: string,
  select: S,
  path: string,
): Promise<DrFirstClientResult<Prisma.ClientGetPayload<{ select: S }>>> {
  const client = await prisma.client.findFirst({ where: drFirstClientWhere(caller, clientId), select });
  if (!client) return { client: null, response: NextResponse.json({ error: 'Patient not found' }, { status: 404 }) };
  try {
    await assertClientPhiAccess({ organizationId: caller.organizationId, userId: caller.userId, role: caller.role, clientId, path });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) {
      return { client: null, response: NextResponse.json({ ...err.body, message: err.message }, { status: err.status }) };
    }
    throw err;
  }
  return { client, response: null };
}

/**
 * List mode (practice-level download, no ?patient): which of `candidateIds` this caller may see in a
 * response. Same caseload scope as one chart (clientAccessWhere: leadership / ADMIN and the verified
 * Medical Director org-wide, prescribers their caseload), then the 42 CFR Part 2 / sensitive lock
 * (lockedSensitiveClientIds; ADMIN / Practice Director bypass, whitelist or live break-glass grant).
 * Both lookups throw on failure, so callers fail closed (list nothing).
 */
export async function drFirstCaseloadClientIds(
  caller: Pick<DrFirstCaller, 'organizationId' | 'userId' | 'role'>,
  candidateIds: Iterable<string | null | undefined>,
): Promise<Set<string>> {
  const ids = [...new Set([...candidateIds].filter((v): v is string => typeof v === 'string' && v.length > 0))];
  if (!ids.length) return new Set();
  const rows = await prisma.client.findMany({
    where: {
      AND: [
        { id: { in: ids } },
        clientAccessWhere({ organizationId: caller.organizationId, actorUserId: caller.userId, actorRole: caller.role as Role }),
      ],
    },
    select: { id: true },
  });
  const inScope = rows.map(r => r.id);
  if (!inScope.length) return new Set();
  const locked = await lockedSensitiveClientIds({
    organizationId: caller.organizationId,
    userId: caller.userId,
    role: caller.role,
    clientIds: inScope,
  });
  return new Set(inScope.filter(id => !locked.has(id)));
}
