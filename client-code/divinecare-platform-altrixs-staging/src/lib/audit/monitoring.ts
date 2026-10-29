import { prisma } from '@/lib/db/prisma';
import { PHI_READ_ACTIONS } from '@/lib/audit/auditLabels';
import { clientLabelMap, staffNameMap } from '@/lib/audit/clientLabels';
import {
  MONITORING_TIME_ZONE as TZ,
  RULES,
  RULE_TEXT,
  afterHoursFlags,
  highVolumeFlags,
  localDay,
  type AfterHoursCount,
  type DailyCount,
} from '@/lib/audit/unusualAccessRules';

const DAY_MS = 86_400_000;

type Viewer = { organizationId: string; userId: string; role: string };

/**
 * Read-only unusual-access review for one org (see unusualAccessRules.ts for the rules).
 * Returns staff and client display labels, ids, counts and timestamps — no clinical content.
 */
export async function loadUnusualAccess(viewer: Viewer, now = new Date()) {
  const org = viewer.organizationId;
  const since31 = new Date(now.getTime() - 31 * DAY_MS);
  const since7 = new Date(now.getTime() - RULES.windowDays * DAY_MS);
  const since30 = new Date(now.getTime() - RULES.breakGlassWindowDays * DAY_MS);
  const actions = [...PHI_READ_ACTIONS] as string[];

  const [daily, afterHours, sensitive, grants, deniedAudit] = await Promise.all([
    prisma.$queryRaw<DailyCount[]>`
      SELECT "actorUserId" AS "userId",
             to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS "day",
             count(*)::int AS "count"
        FROM "AuditLog"
       WHERE "organizationId" = ${org}
         AND "patientId" IS NOT NULL
         AND "actorUserId" IS NOT NULL
         AND "action" = ANY(${actions}::text[])
         AND "createdAt" >= ${since31}
       GROUP BY 1, 2`,
    prisma.$queryRaw<AfterHoursCount[]>`
      SELECT "actorUserId" AS "userId", count(*)::int AS "count", max("createdAt") AS "lastAt"
        FROM "AuditLog"
       WHERE "organizationId" = ${org}
         AND "patientId" IS NOT NULL
         AND "actorUserId" IS NOT NULL
         AND "createdAt" >= ${since7}
         AND (
           EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}) < ${RULES.afterHoursEndHour}
           OR EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}) >= ${RULES.afterHoursStartHour}
           OR EXTRACT(DOW FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}) IN (0, 6)
         )
       GROUP BY 1`,
    prisma.sensitiveAccessLog.findMany({
      where: { organizationId: org, timestamp: { gte: since7 } },
      select: { id: true, clientId: true, userId: true, accessType: true, path: true, reason: true, timestamp: true },
      orderBy: { timestamp: 'desc' },
      take: 500,
    }),
    prisma.breakTheGlassGrant.findMany({
      where: { organizationId: org, grantedAt: { gte: since30 } },
      select: { id: true, clientId: true, userId: true, reason: true, grantedAt: true, expiresAt: true },
      orderBy: { grantedAt: 'desc' },
      take: 200,
    }),
    prisma.auditLog.findMany({
      where: { organizationId: org, outcome: 'DENIED', createdAt: { gte: since7 } },
      select: { id: true, actorUserId: true, actorRole: true, action: true, resourceType: true, patientId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ]);

  const high = highVolumeFlags(
    daily.map((d) => ({ userId: d.userId, day: d.day, count: Number(d.count) })),
    localDay(now, TZ)
  );
  const after = afterHoursFlags(afterHours.map((r) => ({ ...r, count: Number(r.count) })));

  // Protected-record opens grouped per user + client + access type
  const protectedGroups = new Map<string, { userId: string; clientId: string; accessType: string; count: number; lastAt: Date }>();
  for (const s of sensitive) {
    if (s.accessType === 'denied') continue;
    const k = `${s.userId}|${s.clientId}|${s.accessType}`;
    const g = protectedGroups.get(k);
    if (g) g.count += 1;
    else protectedGroups.set(k, { userId: s.userId, clientId: s.clientId, accessType: s.accessType, count: 1, lastAt: s.timestamp });
  }
  const deniedSensitive = sensitive.filter((s) => s.accessType === 'denied');

  const userIds = [
    ...high.map((h) => h.userId),
    ...after.map((a) => a.userId),
    ...sensitive.map((s) => s.userId),
    ...grants.map((g) => g.userId),
    ...deniedAudit.map((d) => d.actorUserId),
  ];
  const clientIds = [
    ...sensitive.map((s) => s.clientId),
    ...grants.map((g) => g.clientId),
    ...deniedAudit.map((d) => d.patientId),
  ];
  const [names, clients] = await Promise.all([
    staffNameMap(org, userIds),
    clientLabelMap({ ...viewer, clientIds }),
  ]);
  const who = (id: string | null) => (id ? names.get(id) ?? null : null);
  const client = (id: string | null) => (id ? clients.get(id) ?? null : null);
  const iso = (d: Date | string) => new Date(d).toISOString();

  return {
    generatedAt: now.toISOString(),
    timeZone: TZ,
    rules: RULE_TEXT,
    highVolume: high.map((h) => ({ ...h, userName: who(h.userId) })),
    afterHours: after.map((a) => ({ userId: a.userId, userName: who(a.userId), count: a.count, lastAt: iso(a.lastAt) })),
    protectedAccess: [...protectedGroups.values()].map((g) => ({
      ...g,
      lastAt: iso(g.lastAt),
      userName: who(g.userId),
      client: client(g.clientId),
    })),
    breakGlass: grants.map((g) => ({
      id: g.id,
      userId: g.userId,
      userName: who(g.userId),
      clientId: g.clientId,
      client: client(g.clientId),
      reason: g.reason,
      grantedAt: iso(g.grantedAt),
      expiresAt: iso(g.expiresAt),
      active: g.expiresAt.getTime() > now.getTime(),
    })),
    denied: [
      ...deniedAudit.map((d) => ({
        id: d.id,
        source: 'audit' as const,
        userId: d.actorUserId,
        userName: who(d.actorUserId),
        role: d.actorRole,
        action: d.action,
        resourceType: d.resourceType,
        clientId: d.patientId,
        client: client(d.patientId),
        at: iso(d.createdAt),
      })),
      ...deniedSensitive.map((s) => ({
        id: s.id,
        source: 'protected' as const,
        userId: s.userId,
        userName: who(s.userId),
        role: null,
        action: 'PROTECTED_RECORD_DENIED',
        resourceType: 'sensitiveRecord',
        clientId: s.clientId,
        client: client(s.clientId),
        at: iso(s.timestamp),
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1)),
  };
}

export type UnusualAccessReport = Awaited<ReturnType<typeof loadUnusualAccess>>;
