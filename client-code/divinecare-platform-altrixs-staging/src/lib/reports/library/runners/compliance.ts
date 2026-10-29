/**
 * Compliance & System reports: HIPAA PHI access, break-the-glass, Part 2, user activity, staff
 * accounts, credentials, training, incidents / grievances, integrations, data imports.
 * Audit-log aggregation runs in SQL (parameterized Prisma.sql; the grouping column is chosen from a
 * fixed whitelist, never from request text).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getModuleData } from '@/lib/modules/manage';
import { incidentMetricRecord, incidentsForOrgMetrics } from '@/lib/incidents/store';
import { incidentTimeliness, trainingStatusFromDates } from '@/lib/compliance/metrics';
import type { ReportContext } from '../context';
import { clientIdWhere } from '../context';
import { avgOrNull, pct } from '../formulas';
import type { ReportOutput, ReportRow, ResolvedParams } from '../types';
import { UNSPECIFIED, asRecord, monthLabel, requireRange, source, ymdIn } from './shared';

const DAY_MS = 86_400_000;

async function usersById(organizationId: string, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unique.length) return new Map<string, { name: string; role: string }>();
  const rows = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true, role: true, organizationId: true } });
  return new Map(rows.map((r) => [r.id, { name: r.organizationId === organizationId ? r.name || r.email : 'User outside this organization', role: r.role }]));
}

// ─── HIPAA PHI access ────────────────────────────────────────────────────────

const PHI_GROUP_SQL: Record<string, Prisma.Sql> = {
  user: Prisma.sql`coalesce(a."actorUserId", '')`,
  patient: Prisma.sql`a."patientId"`,
  action: Prisma.sql`a."action"`,
};

export async function runPhiAccess(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = p.values.groupBy ?? 'user';
  const keySql = dim === 'day'
    ? Prisma.sql`to_char((a."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.timeZone}, 'YYYY-MM-DD')`
    : PHI_GROUP_SQL[dim] ?? PHI_GROUP_SQL.user;
  const rows0 = await prisma.$queryRaw<{ k: string | null; events: bigint; patients: bigint; users: bigint; denied: bigint; exports: bigint; first: Date; last: Date }[]>(Prisma.sql`
    SELECT ${keySql} AS k,
           count(*) AS events,
           count(DISTINCT a."patientId") AS patients,
           count(DISTINCT a."actorUserId") AS users,
           count(*) FILTER (WHERE a."outcome" = 'DENIED') AS denied,
           count(*) FILTER (WHERE a."action" = 'EXPORT') AS exports,
           min(a."createdAt") AS first,
           max(a."createdAt") AS last
      FROM "AuditLog" a
     WHERE a."organizationId" = ${ctx.organizationId}
       AND a."createdAt" >= ${range.from} AND a."createdAt" < ${range.toExclusive}
       AND a."patientId" IS NOT NULL
     GROUP BY 1
     ORDER BY count(*) DESC
     LIMIT 5000`);
  const locked = new Set(ctx.scope.lockedClientIds);
  const users = dim === 'user' ? await usersById(ctx.organizationId, rows0.map((r) => r.k)) : new Map<string, { name: string; role: string }>();
  const patients = dim === 'patient'
    ? new Map((await prisma.client.findMany({ where: { id: { in: rows0.map((r) => r.k).filter((k): k is string => Boolean(k) && !locked.has(k as string)) } }, select: { id: true, name: true, mrn: true } })).map((c) => [c.id, c]))
    : new Map<string, { id: string; name: string; mrn: string | null }>();
  let protectedRow: ReportRow | null = null;
  const rows: ReportRow[] = [];
  for (const r of rows0) {
    const base = { events: Number(r.events), patients: Number(r.patients), users: Number(r.users), denied: Number(r.denied), exports: Number(r.exports), first: r.first.toISOString(), last: r.last.toISOString() };
    if (dim === 'patient' && r.k && locked.has(r.k)) {
      // Protected (Part 2 / VIP) clients this admin cannot open: counted, never named
      protectedRow = protectedRow
        ? { ...protectedRow, events: Number(protectedRow.events) + base.events, patients: Number(protectedRow.patients) + 1, denied: Number(protectedRow.denied) + base.denied, exports: Number(protectedRow.exports) + base.exports }
        : { group: 'Protected records (not named)', detail: null, ...base, patients: 1 };
      continue;
    }
    let group: string;
    let detail: string | null = null;
    if (dim === 'user') {
      const u = r.k ? users.get(r.k) : undefined;
      group = r.k ? u?.name ?? 'Unknown user' : 'System / no user';
      detail = u?.role ?? null;
    } else if (dim === 'patient') {
      const c = r.k ? patients.get(r.k) : undefined;
      group = c ? c.name : 'Deleted or other-organization record';
      detail = c?.mrn ?? null;
    } else group = r.k ?? UNSPECIFIED;
    rows.push({ group, detail, ...base });
  }
  if (protectedRow) rows.push(protectedRow);
  if (dim === 'day') rows.sort((a, b) => String(a.group).localeCompare(String(b.group)));
  const total = rows0.reduce((s, r) => s + Number(r.events), 0);
  return {
    columns: [
      { key: 'group', label: dim === 'user' ? 'User' : dim === 'patient' ? 'Patient' : dim === 'day' ? 'Day' : 'Action', type: dim === 'day' ? 'date' : 'text' },
      ...(dim === 'user' ? [{ key: 'detail', label: 'Role', type: 'text' as const }] : dim === 'patient' ? [{ key: 'detail', label: 'MRN', type: 'text' as const }] : []),
      { key: 'events', label: 'PHI events', type: 'number' },
      ...(dim !== 'patient' ? [{ key: 'patients', label: 'Distinct patients', type: 'number' as const }] : []),
      ...(dim !== 'user' ? [{ key: 'users', label: 'Distinct users', type: 'number' as const }] : []),
      { key: 'denied', label: 'Denied', type: 'number' },
      { key: 'exports', label: 'Exports', type: 'number' },
      { key: 'first', label: 'First', type: 'datetime' },
      { key: 'last', label: 'Last', type: 'datetime' },
    ],
    rows,
    kpis: [
      { label: 'PHI events', value: total, type: 'number' },
      { label: 'Denied', value: rows0.reduce((s, r) => s + Number(r.denied), 0), type: 'number' },
      { label: 'Exports', value: rows0.reduce((s, r) => s + Number(r.exports), 0), type: 'number' },
    ],
    chart: dim === 'day' ? { type: 'line', xKey: 'group', series: [{ key: 'events', label: 'PHI events' }] } : null,
    sources: [source('HIPAA audit log (events with a patient)', total)],
    notices: total === 0 ? ['No PHI access events in this period.'] : [],
    truncated: rows0.length >= 5000,
  };
}

// ─── Break-the-glass ─────────────────────────────────────────────────────────

export async function runBreakGlass(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const grants = await prisma.breakTheGlassGrant.findMany({
    where: { organizationId: ctx.organizationId, grantedAt: { gte: range.from, lt: range.toExclusive } },
    select: { clientId: true, userId: true, reason: true, grantedAt: true, expiresAt: true },
    orderBy: { grantedAt: 'desc' },
  });
  const [users, clients, accesses] = await Promise.all([
    usersById(ctx.organizationId, grants.map((g) => g.userId)),
    grants.length ? prisma.client.findMany({ where: { id: { in: [...new Set(grants.map((g) => g.clientId))] } }, select: { id: true, mrn: true } }) : [],
    grants.length
      ? prisma.sensitiveAccessLog.findMany({
          where: { organizationId: ctx.organizationId, accessType: 'break_the_glass', timestamp: { gte: range.from, lt: new Date(range.toExclusive.getTime() + DAY_MS) } },
          select: { clientId: true, userId: true, timestamp: true },
        })
      : [],
  ]);
  const mrn = new Map<string, string | null>((clients as { id: string; mrn: string | null }[]).map((c) => [c.id, c.mrn]));
  const rows: ReportRow[] = grants.map((g) => ({
    grantedAt: g.grantedAt.toISOString(), user: users.get(g.userId)?.name ?? 'Unknown user', role: users.get(g.userId)?.role ?? null,
    mrn: mrn.get(g.clientId) ?? 'No MRN', reason: g.reason.length > 200 ? `${g.reason.slice(0, 200)}...` : g.reason, expiresAt: g.expiresAt.toISOString(),
    accesses: accesses.filter((a) => a.userId === g.userId && a.clientId === g.clientId && a.timestamp >= g.grantedAt && a.timestamp <= g.expiresAt).length,
  }));
  return {
    columns: [
      { key: 'grantedAt', label: 'Granted', type: 'datetime' },
      { key: 'user', label: 'User', type: 'text' },
      { key: 'role', label: 'Role', type: 'text' },
      { key: 'mrn', label: 'Client MRN', type: 'text' },
      { key: 'reason', label: 'Reason given', type: 'text' },
      { key: 'expiresAt', label: 'Expires', type: 'datetime' },
      { key: 'accesses', label: 'Record opens during grant', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'Break-the-glass grants', value: grants.length, type: 'number' },
      { label: 'Users', value: new Set(grants.map((g) => g.userId)).size, type: 'number' },
      { label: 'Protected clients', value: new Set(grants.map((g) => g.clientId)).size, type: 'number' },
    ],
    sources: [source('Break-the-glass grants', grants.length), source('Protected record access log', accesses.length)],
    notices: grants.length === 0 ? ['No break-the-glass events in this period.'] : [],
  };
}

// ─── Part 2 disclosures / consents ───────────────────────────────────────────

export async function runPart2(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const f = await ctx.clientIdFilter();
  if ((p.values.view ?? 'disclosures') === 'consents') {
    const consents = await prisma.consentForm.findMany({
      where: {
        organizationId: ctx.organizationId, ...clientIdWhere(f),
        OR: [{ type: { contains: 'part 2', mode: 'insensitive' } }, { type: { contains: '42 cfr', mode: 'insensitive' } }, { type: { contains: 'part2', mode: 'insensitive' } }, { type: { contains: 'substance', mode: 'insensitive' } }],
      },
      select: { type: true, status: true, expiresAt: true, signedAt: true },
    });
    const map = new Map<string, { group: string; pending: number; signed: number; expired: number; declined: number; expiring30: number; signedInPeriod: number }>();
    for (const c of consents) {
      const r = map.get(c.type) ?? { group: c.type, pending: 0, signed: 0, expired: 0, declined: 0, expiring30: 0, signedInPeriod: 0 };
      if (c.status === 'PENDING') r.pending++;
      else if (c.status === 'SIGNED') r.signed++;
      else if (c.status === 'EXPIRED') r.expired++;
      else r.declined++;
      if (c.status === 'SIGNED' && c.expiresAt && c.expiresAt >= ctx.now && c.expiresAt.getTime() - ctx.now.getTime() <= 30 * DAY_MS) r.expiring30++;
      if (c.signedAt && c.signedAt >= range.from && c.signedAt < range.toExclusive) r.signedInPeriod++;
      map.set(c.type, r);
    }
    return {
      columns: [
        { key: 'group', label: 'Consent type', type: 'text' },
        { key: 'signed', label: 'Signed', type: 'number' }, { key: 'pending', label: 'Pending', type: 'number' },
        { key: 'expired', label: 'Expired', type: 'number' }, { key: 'declined', label: 'Declined', type: 'number' },
        { key: 'expiring30', label: 'Expiring in 30 days', type: 'number' }, { key: 'signedInPeriod', label: 'Signed in period', type: 'number' },
      ],
      rows: [...map.values()].sort((a, b) => b.signed - a.signed),
      kpis: [{ label: 'Part 2 consents', value: consents.length, type: 'number' }, { label: 'Signed', value: consents.filter((c) => c.status === 'SIGNED').length, type: 'number' }],
      sources: [source('Consent forms (Part 2 / substance use types)', consents.length, ctx.now)],
      notices: consents.length === 0 ? ['No Part 2 consent forms recorded (consent types containing "Part 2", "42 CFR" or "substance").'] : [],
      hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
    };
  }
  const disclosures = await prisma.part2Disclosure.findMany({
    where: { organizationId: ctx.organizationId, disclosedAt: { gte: range.from, lt: range.toExclusive }, ...clientIdWhere(f) },
    select: { clientId: true, basis: true, disclosedTo: true, purpose: true, method: true, disclosedAt: true, disclosedById: true, consentReference: true, consentFormId: true },
    orderBy: { disclosedAt: 'desc' },
  });
  const [users, clients] = await Promise.all([
    usersById(ctx.organizationId, disclosures.map((d) => d.disclosedById)),
    disclosures.length ? prisma.client.findMany({ where: { id: { in: [...new Set(disclosures.map((d) => d.clientId))] } }, select: { id: true, mrn: true } }) : [],
  ]);
  const mrn = new Map<string, string | null>((clients as { id: string; mrn: string | null }[]).map((c) => [c.id, c.mrn]));
  const rows: ReportRow[] = disclosures.map((d) => ({
    disclosedAt: d.disclosedAt.toISOString(), mrn: mrn.get(d.clientId) ?? 'No MRN', disclosedTo: d.disclosedTo, purpose: d.purpose, basis: d.basis, method: d.method,
    consent: d.consentReference ?? (d.consentFormId ? 'Consent form on file' : null), by: users.get(d.disclosedById)?.name ?? 'Unknown user',
  }));
  return {
    columns: [
      { key: 'disclosedAt', label: 'Disclosed', type: 'datetime' },
      { key: 'mrn', label: 'Client MRN', type: 'text' },
      { key: 'disclosedTo', label: 'Disclosed to', type: 'text' },
      { key: 'purpose', label: 'Purpose', type: 'text' },
      { key: 'basis', label: 'Basis', type: 'text' },
      { key: 'method', label: 'Method', type: 'text' },
      { key: 'consent', label: 'Consent', type: 'text' },
      { key: 'by', label: 'Recorded by', type: 'text' },
    ],
    rows,
    kpis: [
      { label: 'Disclosures', value: disclosures.length, type: 'number' },
      { label: 'Clients', value: new Set(disclosures.map((d) => d.clientId)).size, type: 'number' },
      { label: 'Without consent (other basis)', value: disclosures.filter((d) => d.basis !== 'consent').length, type: 'number' },
    ],
    sources: [source('Part 2 disclosures', disclosures.length)],
    notices: disclosures.length === 0 ? ['No Part 2 disclosures recorded in this period.'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── User activity ───────────────────────────────────────────────────────────

export async function runUserActivity(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const [staff, agg, failedUnknown] = await Promise.all([
    prisma.user.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, name: true, email: true, role: true, status: true } }),
    prisma.$queryRaw<{ u: string; events: bigint; logins: bigint; failed: bigint; exports: bigint; lastLogin: Date | null; lastEvent: Date }[]>(Prisma.sql`
      SELECT a."actorUserId" AS u,
             count(*) AS events,
             count(*) FILTER (WHERE a."action" = 'LOGIN') AS logins,
             count(*) FILTER (WHERE a."action" = 'LOGIN_FAILED') AS failed,
             count(*) FILTER (WHERE a."action" = 'EXPORT') AS exports,
             max(a."createdAt") FILTER (WHERE a."action" = 'LOGIN') AS "lastLogin",
             max(a."createdAt") AS "lastEvent"
        FROM "AuditLog" a
       WHERE a."organizationId" = ${ctx.organizationId}
         AND a."createdAt" >= ${range.from} AND a."createdAt" < ${range.toExclusive}
         AND a."actorUserId" IS NOT NULL
       GROUP BY 1`),
    prisma.auditLog.count({ where: { organizationId: ctx.organizationId, action: 'LOGIN_FAILED', actorUserId: null, createdAt: { gte: range.from, lt: range.toExclusive } } }),
  ]);
  const by = new Map(agg.map((a) => [a.u, a]));
  const rows: ReportRow[] = staff.map((s) => {
    const a = by.get(s.id);
    return {
      user: s.name || s.email, role: s.role, status: s.status, logins: a ? Number(a.logins) : 0, failed: a ? Number(a.failed) : 0,
      events: a ? Number(a.events) : 0, exports: a ? Number(a.exports) : 0, lastLogin: a?.lastLogin ? a.lastLogin.toISOString() : null, lastActivity: a?.lastEvent ? a.lastEvent.toISOString() : null,
    };
  }).sort((a, b) => Number(b.events) - Number(a.events));
  const activeNoLogin = rows.filter((r) => r.status === 'ACTIVE' && Number(r.logins) === 0).length;
  return {
    columns: [
      { key: 'user', label: 'User', type: 'text' }, { key: 'role', label: 'Role', type: 'text' }, { key: 'status', label: 'Account', type: 'text' },
      { key: 'logins', label: 'Sign-ins', type: 'number' }, { key: 'failed', label: 'Failed sign-ins', type: 'number' },
      { key: 'events', label: 'Audited actions', type: 'number' }, { key: 'exports', label: 'Exports', type: 'number' },
      { key: 'lastLogin', label: 'Last sign-in (period)', type: 'datetime' }, { key: 'lastActivity', label: 'Last activity (period)', type: 'datetime' },
    ],
    rows,
    kpis: [
      { label: 'Users who signed in', value: rows.filter((r) => Number(r.logins) > 0).length, type: 'number' },
      { label: 'Failed sign-ins', value: rows.reduce((s, r) => s + Number(r.failed), 0) + failedUnknown, type: 'number', hint: failedUnknown ? `${failedUnknown} for unknown accounts` : undefined },
      { label: 'Active accounts with no sign-in', value: activeNoLogin, type: 'number' },
    ],
    sources: [source('HIPAA audit log', agg.reduce((s, a) => s + Number(a.events), 0)), source('Staff accounts', staff.length, ctx.now)],
    notices: agg.length === 0 ? ['No audited staff activity in this period.'] : [],
  };
}

// ─── Staff accounts ──────────────────────────────────────────────────────────

export async function runStaffAccounts(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const status = p.values.status ?? 'all';
  const staff = await prisma.user.findMany({
    where: { organizationId: ctx.organizationId, ...(status === 'all' ? {} : { status: status as 'ACTIVE' | 'INVITED' | 'DEACTIVATED' }) },
    select: { id: true, name: true, email: true, role: true, roles: true, status: true, isMedicalDirector: true, medicalDirectorScope: true, credentials: true, npi: true, createdAt: true, inviteExpiresAt: true, primaryLocation: { select: { name: true } } },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  });
  const ids = staff.map((s) => s.id);
  const last = ids.length
    ? await prisma.auditLog.groupBy({ by: ['actorUserId'], where: { organizationId: ctx.organizationId, action: 'LOGIN', actorUserId: { in: ids } }, _max: { createdAt: true } })
    : [];
  const lastBy = new Map(last.map((l) => [l.actorUserId as string, l._max.createdAt]));
  const rows: ReportRow[] = staff.map((s) => ({
    name: s.name || s.email, email: s.email, role: s.role, otherRoles: s.roles.filter((r) => r !== s.role).join(', ') || null, status: s.status,
    medicalDirector: s.isMedicalDirector ? `Yes${s.medicalDirectorScope ? ` (${s.medicalDirectorScope})` : ''}` : 'No',
    credentials: s.credentials ?? null, npi: s.npi ?? null, site: s.primaryLocation?.name ?? null, created: s.createdAt.toISOString().slice(0, 10),
    inviteExpires: s.status === 'INVITED' && s.inviteExpiresAt ? s.inviteExpiresAt.toISOString() : null, lastLogin: lastBy.get(s.id)?.toISOString() ?? null,
  }));
  const byRole = new Map<string, number>();
  for (const s of staff) byRole.set(s.role, (byRole.get(s.role) ?? 0) + 1);
  return {
    columns: [
      { key: 'name', label: 'Name', type: 'text' }, { key: 'email', label: 'Email', type: 'text' }, { key: 'role', label: 'Role', type: 'text' },
      { key: 'otherRoles', label: 'Other roles', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'medicalDirector', label: 'Medical Director', type: 'text' },
      { key: 'credentials', label: 'Credentials', type: 'text' }, { key: 'npi', label: 'NPI', type: 'text' }, { key: 'site', label: 'Primary site', type: 'text' },
      { key: 'created', label: 'Created', type: 'date' }, { key: 'inviteExpires', label: 'Invite expires', type: 'datetime' }, { key: 'lastLogin', label: 'Last sign-in', type: 'datetime' },
    ],
    rows,
    kpis: [
      { label: 'Active', value: staff.filter((s) => s.status === 'ACTIVE').length, type: 'number' },
      { label: 'Invited', value: staff.filter((s) => s.status === 'INVITED').length, type: 'number' },
      { label: 'Deactivated', value: staff.filter((s) => s.status === 'DEACTIVATED').length, type: 'number' },
      { label: 'Medical Directors', value: staff.filter((s) => s.isMedicalDirector).length, type: 'number' },
    ],
    chart: { type: 'bar', xKey: 'role', series: [{ key: 'accounts', label: 'Accounts' }], data: [...byRole.entries()].sort((a, b) => b[1] - a[1]).map(([role, accounts]) => ({ role, accounts })) },
    sources: [source('Staff accounts', staff.length, ctx.now)],
  };
}

// ─── Credentials ─────────────────────────────────────────────────────────────

export async function runCredentials(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const win = p.values.window ?? '60';
  const limit = win === 'all' ? null : new Date(ctx.now.getTime() + Number(win) * DAY_MS);
  const [creds, profileLicenses] = await Promise.all([
    prisma.staffCredential.findMany({
      where: { organizationId: ctx.organizationId, ...(limit ? { expiresAt: { lte: limit } } : {}) },
      select: { credentialType: true, title: true, issuer: true, licenseNumber: true, expiresAt: true, status: true, user: { select: { name: true, email: true, role: true, status: true } } },
      orderBy: { expiresAt: 'asc' },
    }),
    prisma.user.findMany({
      where: { organizationId: ctx.organizationId, status: { not: 'DEACTIVATED' }, licenseExpiresAt: limit ? { not: null, lte: limit } : { not: null } },
      select: { name: true, email: true, role: true, status: true, licenseNumber: true, licenseExpiresAt: true },
    }),
  ]);
  const mask = (v: string | null) => (v ? (v.length > 4 ? `…${v.slice(-4)}` : v) : null);
  type CredRow = { staff: string; role: string; account: string; type: string; title: string; issuer: string | null; number: string | null; expires: string; daysLeft: number; source: string };
  const rows: CredRow[] = [
    ...creds.map((c): CredRow => ({
      staff: c.user.name || c.user.email, role: c.user.role, account: c.user.status, type: c.credentialType, title: c.title, issuer: c.issuer,
      number: mask(c.licenseNumber), expires: c.expiresAt.toISOString().slice(0, 10), daysLeft: Math.floor((c.expiresAt.getTime() - ctx.now.getTime()) / DAY_MS), source: 'Credentialing',
    })),
    ...profileLicenses.map((u): CredRow => ({
      staff: u.name || u.email, role: u.role, account: u.status, type: 'LICENSE', title: 'License (staff profile)', issuer: null,
      number: mask(u.licenseNumber), expires: (u.licenseExpiresAt as Date).toISOString().slice(0, 10), daysLeft: Math.floor(((u.licenseExpiresAt as Date).getTime() - ctx.now.getTime()) / DAY_MS), source: 'Staff profile',
    })),
  ].sort((a, b) => a.daysLeft - b.daysLeft);
  return {
    columns: [
      { key: 'staff', label: 'Staff', type: 'text' }, { key: 'role', label: 'Role', type: 'text' }, { key: 'account', label: 'Account', type: 'text' },
      { key: 'type', label: 'Type', type: 'text' }, { key: 'title', label: 'Credential', type: 'text' }, { key: 'issuer', label: 'Issuer', type: 'text' },
      { key: 'number', label: 'Number (last 4)', type: 'text' }, { key: 'expires', label: 'Expires', type: 'date' }, { key: 'daysLeft', label: 'Days left', type: 'days' },
      { key: 'source', label: 'Source', type: 'text' },
    ],
    rows: rows as unknown as ReportRow[],
    kpis: [
      { label: 'Expired', value: rows.filter((r) => r.daysLeft < 0).length, type: 'number' },
      { label: 'Expiring in 30 days', value: rows.filter((r) => r.daysLeft >= 0 && r.daysLeft <= 30).length, type: 'number' },
      { label: 'Listed', value: rows.length, type: 'number' },
    ],
    sources: [source('Staff credentials', creds.length, ctx.now), source('Staff profile license dates', profileLicenses.length)],
    notices: rows.length === 0 ? ['No credentials expire in this window (or none are recorded).'] : [],
  };
}

// ─── Training ────────────────────────────────────────────────────────────────

export async function runTraining(ctx: ReportContext, _p: ResolvedParams): Promise<ReportOutput> {
  void _p;
  const [staffData, catalogData] = await Promise.all([
    getModuleData<unknown>(ctx.organizationId, 'hr-training-staff').catch(() => null),
    getModuleData<unknown>(ctx.organizationId, 'hr-trainings-catalog').catch(() => null),
  ]);
  const staff = (Array.isArray(staffData) ? staffData : []).map(asRecord).filter((x): x is Record<string, unknown> => Boolean(x));
  const catalog = new Map<string, string>();
  for (const c of (Array.isArray(catalogData) ? catalogData : []).map(asRecord)) if (c && typeof c.id === 'string') catalog.set(c.id, String(c.name ?? c.id));
  const today = ymdIn(ctx.now, ctx.timeZone);
  const map = new Map<string, { course: string; required: number; complete: number; expiring: number; overdue: number; inProgress: number; notStarted: number }>();
  for (const s of staff) {
    for (const t0 of Array.isArray(s.trainings) ? s.trainings : []) {
      const t = asRecord(t0);
      if (!t || typeof t.trainingId !== 'string') continue;
      const status = trainingStatusFromDates({ status: t.status as string | undefined, completedDate: t.completedDate as string | undefined, expiresDate: t.expiresDate as string | undefined }, today);
      if (status === 'not-required') continue;
      const r = map.get(t.trainingId) ?? { course: catalog.get(t.trainingId) ?? t.trainingId, required: 0, complete: 0, expiring: 0, overdue: 0, inProgress: 0, notStarted: 0 };
      r.required++;
      if (status === 'complete') r.complete++;
      else if (status === 'expiring') r.expiring++;
      else if (status === 'overdue') r.overdue++;
      else if (status === 'in-progress') r.inProgress++;
      else r.notStarted++;
      map.set(t.trainingId, r);
    }
  }
  const rows: ReportRow[] = [...map.values()].map((r) => ({ ...r, compliance: pct(r.complete + r.expiring, r.required) })).sort((a, b) => Number(a.compliance ?? 0) - Number(b.compliance ?? 0));
  const req = rows.reduce((s, r) => s + Number(r.required), 0);
  const ok = rows.reduce((s, r) => s + Number(r.complete) + Number(r.expiring), 0);
  return {
    columns: [
      { key: 'course', label: 'Training', type: 'text' }, { key: 'required', label: 'Staff required', type: 'number' },
      { key: 'complete', label: 'Complete', type: 'number' }, { key: 'expiring', label: 'Expiring (30 days)', type: 'number' },
      { key: 'overdue', label: 'Overdue', type: 'number' }, { key: 'inProgress', label: 'In progress', type: 'number' },
      { key: 'notStarted', label: 'Not started', type: 'number' }, { key: 'compliance', label: 'Compliance', type: 'percent' },
    ],
    rows,
    kpis: [
      { label: 'Overall compliance', value: pct(ok, req), type: 'percent' },
      { label: 'Overdue', value: rows.reduce((s, r) => s + Number(r.overdue), 0), type: 'number' },
      { label: 'Staff tracked', value: staff.length, type: 'number' },
    ],
    chart: { type: 'stackedBar', xKey: 'course', series: [{ key: 'complete', label: 'Complete' }, { key: 'expiring', label: 'Expiring' }, { key: 'overdue', label: 'Overdue' }, { key: 'notStarted', label: 'Not started' }] },
    sources: [source('Training hub (staff training records)', staff.length)],
    notices: staff.length === 0 ? ['No staff training records entered in the Training hub.'] : [],
  };
}

// ─── Incidents / grievances ──────────────────────────────────────────────────

const OPEN_INCIDENT = new Set(['reported', 'investigating', 'corrective_action']);
const OPEN_GRIEVANCE = new Set(['submitted', 'acknowledged', 'investigating', 'appealed']);

export async function runIncidentsGrievances(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const kind = p.values.kind ?? 'incidents';
  const dim = p.values.groupBy ?? 'type';
  // Incidents are relational (IncidentReport, org-wide: the report's roles are incident reviewers);
  // grievances are still the module list
  const data: unknown = kind === 'grievances'
    ? await getModuleData<unknown>(ctx.organizationId, 'grievances').catch(() => null)
    : (await incidentsForOrgMetrics(ctx.organizationId)).map(incidentMetricRecord);
  const list = (Array.isArray(data) ? data : []).map(asRecord).filter((x): x is Record<string, unknown> => Boolean(x));
  const dateOf = (r: Record<string, unknown>) => String((kind === 'grievances' ? r.submittedAt ?? r.receivedAt : r.reportedAt) ?? '').slice(0, 10);
  const inRange = list.filter((r) => {
    const d = dateOf(r);
    return d >= range.fromDate && d <= range.toDate;
  });
  const keyOf = (r: Record<string, unknown>): string => {
    if (dim === 'month') return dateOf(r).slice(0, 7);
    if (dim === 'status') return String(r.status ?? UNSPECIFIED);
    if (dim === 'severity') return String((kind === 'grievances' ? r.priority : r.severity) ?? UNSPECIFIED);
    return String((kind === 'grievances' ? r.category : r.type) ?? UNSPECIFIED);
  };
  const map = new Map<string, { group: string; count: number; open: number; within24: number; timed: number; closeDays: number[] }>();
  for (const r of inRange) {
    const key = keyOf(r);
    const x = map.get(key) ?? { group: dim === 'month' ? monthLabel(key) : key.replace(/_/g, ' '), count: 0, open: 0, within24: 0, timed: 0, closeDays: [] };
    x.count++;
    const status = String(r.status ?? '');
    if ((kind === 'grievances' ? OPEN_GRIEVANCE : OPEN_INCIDENT).has(status)) x.open++;
    if (kind === 'incidents') {
      const t = incidentTimeliness(r.occurredAt as string | undefined, r.reportedAtTime as string | undefined);
      if (t) {
        x.timed++;
        if (t === 'within_24h') x.within24++;
      }
    }
    const closed = String((kind === 'grievances' ? r.resolvedAt : r.closedAt) ?? '').slice(0, 10);
    const opened = dateOf(r);
    if (/^\d{4}-\d{2}-\d{2}$/.test(closed) && /^\d{4}-\d{2}-\d{2}$/.test(opened)) x.closeDays.push(Math.max(0, (Date.parse(closed) - Date.parse(opened)) / DAY_MS));
    map.set(key, x);
  }
  const rows: ReportRow[] = [...map.entries()].sort((a, b) => (dim === 'month' ? a[0].localeCompare(b[0]) : b[1].count - a[1].count)).map(([, x]) => ({
    group: x.group, count: x.count, open: x.open, ...(kind === 'incidents' ? { within24: pct(x.within24, x.timed) } : {}), avgDaysToClose: avgOrNull(x.closeDays),
  }));
  const label = kind === 'grievances' ? 'Grievances' : 'Incidents';
  return {
    columns: [
      { key: 'group', label: dim === 'month' ? 'Month' : dim === 'status' ? 'Status' : dim === 'severity' ? (kind === 'grievances' ? 'Priority' : 'Severity') : kind === 'grievances' ? 'Category' : 'Type', type: 'text' },
      { key: 'count', label, type: 'number' },
      { key: 'open', label: 'Open', type: 'number' },
      ...(kind === 'incidents' ? [{ key: 'within24', label: 'Reported within 24 h', type: 'percent' as const }] : []),
      { key: 'avgDaysToClose', label: 'Avg days to close', type: 'days' },
    ],
    rows,
    kpis: [
      { label, value: inRange.length, type: 'number' },
      { label: 'Open', value: rows.reduce((s, r) => s + Number(r.open), 0), type: 'number' },
    ],
    chart: { type: 'bar', xKey: 'group', series: [{ key: 'count', label }] },
    sources: [source(kind === 'grievances' ? `${label} module` : 'Incident reports', list.length)],
    notices: list.length === 0 ? [`No ${label.toLowerCase()} recorded.`] : inRange.length === 0 ? [`No ${label.toLowerCase()} in this period.`] : [],
  };
}

// ─── Integrations ────────────────────────────────────────────────────────────

export async function runIntegrationStatus(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const inRange = { gte: range.from, lt: range.toExclusive };
  const [inbound, inboundPending, outbound, runs, lastRunOk, cursors, fhirRuns, fhirFailedStates] = await Promise.all([
    prisma.waystarInboundFile.groupBy({ by: ['fileType'], where: { receivedAt: inRange }, _count: { _all: true }, _max: { receivedAt: true } }),
    prisma.waystarInboundFile.groupBy({ by: ['fileType', 'processed'], where: { OR: [{ processed: false }, { error: { not: null }, receivedAt: inRange }] }, _count: { _all: true } }),
    prisma.waystarOutboundFile.findMany({ where: { organizationId: ctx.organizationId, createdAt: inRange }, select: { kind: true, status: true, ackAt: true, createdAt: true } }),
    prisma.waystarRetrievalRun.groupBy({ by: ['status'], where: { startedAt: inRange }, _count: { _all: true }, _max: { startedAt: true } }),
    prisma.waystarRetrievalRun.findFirst({ where: { status: { in: ['ok', 'success', 'completed', 'done'] } }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
    prisma.drFirstSyncCursor.findMany({ select: { commandName: true, lastUpdateDate: true, updatedAt: true } }),
    prisma.fhirSyncRun.findMany({ where: { organizationId: ctx.organizationId, startedAt: inRange }, select: { status: true, failed: true, synced: true, startedAt: true, error: true } }),
    prisma.fhirSyncState.count({ where: { organizationId: ctx.organizationId, status: { in: ['ERROR', 'DEAD'] } } }),
  ]);
  const errorsByType = new Map<string, number>();
  const pendingByType = new Map<string, number>();
  for (const g of inboundPending) {
    if (!g.processed) pendingByType.set(g.fileType, (pendingByType.get(g.fileType) ?? 0) + g._count._all);
  }
  const errored = await prisma.waystarInboundFile.groupBy({ by: ['fileType'], where: { receivedAt: inRange, error: { not: null } }, _count: { _all: true } });
  for (const g of errored) errorsByType.set(g.fileType, g._count._all);
  const rows: ReportRow[] = [];
  for (const g of inbound) {
    rows.push({ integration: 'Waystar SFTP inbound', item: g.fileType, inPeriod: g._count._all, failed: errorsByType.get(g.fileType) ?? 0, pending: pendingByType.get(g.fileType) ?? 0, last: g._max.receivedAt?.toISOString() ?? null, note: 'System-wide (all organizations on this server)' });
  }
  for (const [type, n] of pendingByType) if (!inbound.some((g) => g.fileType === type)) rows.push({ integration: 'Waystar SFTP inbound', item: type, inPeriod: 0, failed: 0, pending: n, last: null, note: 'Older unprocessed files' });
  const outKinds = new Map<string, { n: number; acked: number; last: Date | null; failed: number }>();
  for (const o of outbound) {
    const r = outKinds.get(o.kind) ?? { n: 0, acked: 0, last: null, failed: 0 };
    r.n++;
    if (o.ackAt) r.acked++;
    if (/fail|reject|error/i.test(o.status)) r.failed++;
    if (!r.last || o.createdAt > r.last) r.last = o.createdAt;
    outKinds.set(o.kind, r);
  }
  for (const [kind, r] of outKinds) rows.push({ integration: 'Waystar SFTP outbound', item: kind, inPeriod: r.n, failed: r.failed, pending: r.n - r.acked, last: r.last?.toISOString() ?? null, note: 'Pending = no acknowledgement yet' });
  const runTotal = runs.reduce((s, g) => s + g._count._all, 0);
  const runFailed = runs.filter((g) => /fail|error|partial/i.test(g.status)).reduce((s, g) => s + g._count._all, 0);
  rows.push({ integration: 'Waystar retrieval runs', item: 'Download sweep', inPeriod: runTotal, failed: runFailed, pending: runs.filter((g) => g.status === 'running').reduce((s, g) => s + g._count._all, 0), last: lastRunOk?.startedAt.toISOString() ?? null, note: 'Failed includes partial runs; last = last successful run' });
  for (const c of cursors) rows.push({ integration: 'DrFirst (Rcopia) sync', item: c.commandName, inPeriod: null, failed: null, pending: null, last: c.updatedAt.toISOString(), note: `Cursor ${c.lastUpdateDate}` });
  if (fhirRuns.length || fhirFailedStates) {
    rows.push({
      integration: 'FHIR / HealthLake sync', item: 'Sync runs', inPeriod: fhirRuns.length, failed: fhirRuns.filter((r) => r.error || /fail/i.test(r.status)).length,
      pending: fhirFailedStates, last: fhirRuns.map((r) => r.startedAt).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null, note: 'Backlog = resources in ERROR / DEAD state',
    });
  }
  return {
    columns: [
      { key: 'integration', label: 'Integration', type: 'text' }, { key: 'item', label: 'Item', type: 'text' },
      { key: 'inPeriod', label: 'In period', type: 'number' }, { key: 'failed', label: 'Failed', type: 'number' },
      { key: 'pending', label: 'Pending / backlog', type: 'number' }, { key: 'last', label: 'Last activity', type: 'datetime' }, { key: 'note', label: 'Note', type: 'text' },
    ],
    rows,
    kpis: [
      { label: 'Failures in period', value: rows.reduce((s, r) => s + Number(r.failed ?? 0), 0), type: 'number' },
      { label: 'Backlog', value: rows.reduce((s, r) => s + Number(r.pending ?? 0), 0), type: 'number' },
    ],
    sources: [
      source('Waystar inbound files', inbound.reduce((s, g) => s + g._count._all, 0)),
      source('Waystar outbound files', outbound.length),
      source('Waystar retrieval runs', runTotal),
      source('DrFirst sync cursors', cursors.length),
      source('FHIR sync runs', fhirRuns.length),
    ],
    notices: rows.length === 0 ? ['No integration activity recorded.'] : [],
  };
}

// ─── Data imports ────────────────────────────────────────────────────────────

export async function runDataImports(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const [jobs, refs] = await Promise.all([
    prisma.migrationJob.findMany({ where: { organizationId: ctx.organizationId, createdAt: { gte: range.from, lt: range.toExclusive } }, select: { type: true, platform: true, total: true, imported: true, errors: true, status: true, createdAt: true, createdById: true }, orderBy: { createdAt: 'desc' } }),
    prisma.valantReferenceImport.findMany({ where: { organizationId: ctx.organizationId, importedAt: { gte: range.from, lt: range.toExclusive } }, select: { reportType: true, asOf: true, periodStart: true, periodEnd: true, rowCount: true, matched: true, unmatched: true, reconciles: true, importedAt: true, importedById: true }, orderBy: { importedAt: 'desc' } }),
  ]);
  const users = await usersById(ctx.organizationId, [...jobs.map((j) => j.createdById), ...refs.map((r) => r.importedById)]);
  const rows: ReportRow[] = [
    ...jobs.map((j) => ({
      at: j.createdAt.toISOString(), kind: 'Migration job', type: j.type, platform: j.platform ?? null, rows: j.total, imported: j.imported, errors: j.errors,
      result: j.status, period: null, by: j.createdById ? users.get(j.createdById)?.name ?? 'Unknown user' : null,
    })),
    ...refs.map((r) => ({
      at: r.importedAt.toISOString(), kind: 'Valant reference report', type: r.reportType, platform: 'valant', rows: r.rowCount, imported: r.matched, errors: r.unmatched,
      result: r.reconciles ? 'Reconciles' : 'Does not reconcile',
      period: r.asOf ? `as of ${r.asOf.toISOString().slice(0, 10)}` : r.periodStart && r.periodEnd ? `${r.periodStart.toISOString().slice(0, 10)} to ${r.periodEnd.toISOString().slice(0, 10)}` : null,
      by: r.importedById ? users.get(r.importedById)?.name ?? 'Unknown user' : null,
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return {
    columns: [
      { key: 'at', label: 'When', type: 'datetime' }, { key: 'kind', label: 'Kind', type: 'text' }, { key: 'type', label: 'Type / report', type: 'text' },
      { key: 'platform', label: 'Platform', type: 'text' }, { key: 'rows', label: 'Rows', type: 'number' },
      { key: 'imported', label: 'Imported / matched', type: 'number', description: 'Migration jobs: imported rows. Valant reference reports: rows matched to a chart.' },
      { key: 'errors', label: 'Errors / unmatched', type: 'number' }, { key: 'result', label: 'Result', type: 'text' },
      { key: 'period', label: 'Report period', type: 'text' }, { key: 'by', label: 'By', type: 'text' },
    ],
    rows,
    kpis: [
      { label: 'Imports', value: rows.length, type: 'number' },
      { label: 'Failed / partial jobs', value: jobs.filter((j) => j.status !== 'success').length, type: 'number' },
      { label: 'Reference reports not reconciling', value: refs.filter((r) => !r.reconciles).length, type: 'number' },
    ],
    sources: [source('Migration jobs', jobs.length), source('Valant reference imports', refs.length)],
    notices: rows.length === 0 ? ['No imports in this period.'] : [],
  };
}

// ─── Carelon non-overlap attestation status (Maryland Medicaid) ─────────────

/**
 * Same rows as the Carelon attestations page / inbox (loadClientStatusRows) in the viewer's report
 * scope; KPIs come from summarizeStatuses over the same rows, so every count equals its list.
 */
export async function runCarelonAttestation(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const { loadClientStatusRows } = await import('@/lib/consents/carelon/store');
  const { filterStatusRows, summarizeStatuses, REQUIREMENT_LABEL, CARELON_STATUS_LABEL } = await import('@/lib/consents/carelon/workflow');
  const all = await loadClientStatusRows(ctx.clientWhere(), ctx.organizationId, { now: ctx.now });
  const view = (p.values.view ?? 'all') as Parameters<typeof filterStatusRows>[1];
  const list = filterStatusRows(all, view);
  const s = summarizeStatuses(all);
  const rows: ReportRow[] = list
    .sort((a, b) => a.clientName.localeCompare(b.clientName))
    .map((r) => ({
      mrn: r.mrn,
      client: r.clientName,
      payer: r.payerName,
      status: REQUIREMENT_LABEL[r.state],
      openRequest: r.openStatus ? CARELON_STATUS_LABEL[r.openStatus] : null,
      reason: r.neededReason,
      completedAt: r.completedAt,
      submitted: r.currentId ? (r.submitted ? 'Yes' : 'No') : null,
      submittedAt: r.submittedAt,
    }));
  return {
    columns: [
      { key: 'mrn', label: 'MRN', type: 'text' },
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'payer', label: 'Medicaid payer', type: 'text' },
      { key: 'status', label: 'Attestation status', type: 'text' },
      { key: 'openRequest', label: 'Open request', type: 'text' },
      { key: 'reason', label: 'Why a new one is needed', type: 'text' },
      { key: 'completedAt', label: 'Completed', type: 'date' },
      { key: 'submitted', label: 'Submitted to Carelon', type: 'text' },
      { key: 'submittedAt', label: 'Submitted on', type: 'date' },
    ],
    rows,
    kpis: [
      { label: 'Maryland Medicaid clients', value: s.total, type: 'number' },
      { label: 'Complete', value: s.complete, type: 'number' },
      { label: 'Pending signature', value: s.pendingSignature, type: 'number' },
      { label: 'Not started', value: s.notStarted, type: 'number' },
      { label: 'New attestation needed', value: s.needsNew, type: 'number' },
      { label: 'Submitted to Carelon', value: s.submitted, type: 'number' },
      { label: 'Signed, not yet submitted', value: s.completeNotSubmitted, type: 'number' },
    ],
    sources: [source('Clients with Maryland Medicaid (coverage, payer, insurance type or MA number)', s.total, ctx.now), source('Carelon attestations (ConsentForm)', all.filter((r) => r.openId || r.currentId).length, ctx.now)],
    notices: s.total === 0 ? ['No active Maryland Medicaid clients in this scope.'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Consent compliance (consent library) ───────────────────────────────────

/**
 * Required consents per active client (intake packet rules applied to the practice's Active
 * templates) and their state. Same rows as the chart Consents card and the inbox; KPIs come from
 * summarizeCompliance over the same rows, so every count equals its list.
 */
export async function runConsentCompliance(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const { loadComplianceData } = await import('@/lib/consents/library/store');
  const { filterCompliance, summarizeCompliance, CONSENT_STATE_LABEL } = await import('@/lib/consents/library/status');
  const { completionBy } = await import('@/lib/consents/library/worklistCore');
  const { STANDARD_STATUS_LABEL } = await import('@/lib/consents/library/requirements');
  const data = await loadComplianceData(ctx.clientWhere(), ctx.organizationId, { now: ctx.now });
  const all = data.rows;
  const view = (p.values.view ?? 'needs_action') as string;
  const type = p.values.type && p.values.type !== 'all' ? p.values.type : null;
  const scoped = type ? all.filter((r) => r.templateKey === type) : all;
  const s = summarizeCompliance(scoped);
  const expiring = scoped.filter((r) => r.required && r.standard === 'expiring');
  const kpis: ReportOutput['kpis'] = [
    { label: 'Required consents', value: s.required, type: 'number' },
    { label: 'Needs action', value: s.needsAction, type: 'number' },
    { label: 'Clients needing action', value: s.clientsNeedingAction, type: 'number' },
    { label: 'Missing', value: s.missing, type: 'number' },
    { label: 'Expiring in 30 days', value: expiring.length, type: 'number' },
    { label: 'Expired', value: s.expired, type: 'number' },
    { label: 'Revoked', value: s.revoked, type: 'number' },
    { label: 'Needs re-sign', value: s.needs_resign, type: 'number' },
    { label: 'Declined', value: s.declined, type: 'number' },
    { label: 'Awaiting signature', value: s.pending, type: 'number' },
    { label: 'Signed', value: s.signed, type: 'number' },
  ];
  const base = {
    kpis,
    sources: [source('Required consents (active clients x required-consent rules and Active templates)', s.required, ctx.now), source('Consent library rows (ConsentForm)', all.filter((r) => r.rowId).length, ctx.now)],
    notices: s.required === 0 ? ['No required consents in this scope (no active clients, or no Active templates).'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };

  // Completion rate by location / clinician (complete = signed and valid, including expiring)
  if (view === 'by_location' || view === 'by_clinician') {
    const { facetsFor } = await import('@/lib/consents/library/worklist');
    const facets = await facetsFor(ctx.organizationId, data.clients, data.contexts, ctx.timeZone, ctx.now);
    const groups = completionBy(scoped, facets, view === 'by_location' ? 'location' : 'clinician');
    return {
      ...base,
      columns: [
        { key: 'group', label: view === 'by_location' ? 'Location' : 'Clinician', type: 'text' },
        { key: 'clients', label: 'Clients', type: 'number' },
        { key: 'required', label: 'Required consents', type: 'number' },
        { key: 'complete', label: 'Complete', type: 'number' },
        { key: 'expiring', label: 'Expiring (30 days)', type: 'number' },
        { key: 'missing', label: 'Missing', type: 'number' },
        { key: 'expired', label: 'Expired', type: 'number' },
        { key: 'revoked', label: 'Revoked', type: 'number' },
        { key: 'rate', label: 'Completion rate', type: 'percent' },
      ],
      rows: groups.map((g) => ({ group: g.label, clients: g.clients, required: g.required, complete: g.complete, expiring: g.expiring, missing: g.missing, expired: g.expired, revoked: g.revoked, rate: g.rate })),
    };
  }

  // Revocations: every revoked consent / authorization on file (required or not, e.g. ROIs)
  const list =
    view === 'revocations'
      ? scoped.filter((r) => r.state === 'revoked')
      : view === 'expiring'
        ? expiring
        : filterCompliance(scoped, view as Parameters<typeof filterCompliance>[1]);
  const rows: ReportRow[] = list
    .sort((a, b) => (view === 'expiring' ? (a.expiresAt ?? '').localeCompare(b.expiresAt ?? '') : 0) || a.clientName.localeCompare(b.clientName) || a.title.localeCompare(b.title))
    .map((r) => ({
      mrn: r.mrn,
      client: r.clientName,
      consent: r.title,
      state: r.standard === 'expiring' ? STANDARD_STATUS_LABEL.expiring : CONSENT_STATE_LABEL[r.state],
      signedVersion: r.legacy ? 'earlier form' : r.signedVersion,
      activeVersion: r.activeVersion,
      signedAt: r.signedAt,
      signer: r.signerName,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
      recipient: r.recipient,
      why: r.reason,
    }));
  return {
    ...base,
    columns: [
      { key: 'mrn', label: 'MRN', type: 'text' },
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'consent', label: 'Consent', type: 'text' },
      { key: 'state', label: 'Status', type: 'text' },
      { key: 'signedVersion', label: 'Signed version', type: 'text' },
      { key: 'activeVersion', label: 'Current version', type: 'number' },
      { key: 'signedAt', label: 'Signed', type: 'date' },
      { key: 'signer', label: 'Signed by', type: 'text' },
      { key: 'expiresAt', label: 'Expires', type: 'date' },
      { key: 'revokedAt', label: 'Revoked', type: 'date' },
      { key: 'recipient', label: 'Recipient', type: 'text' },
      { key: 'why', label: 'Why required', type: 'text' },
    ],
    rows,
  };
}
