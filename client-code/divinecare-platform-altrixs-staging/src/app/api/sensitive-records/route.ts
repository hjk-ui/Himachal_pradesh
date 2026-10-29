import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { isSensitivePrivilegedRole } from '@/lib/privacy/sensitiveAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** GET /api/sensitive-records — list protected clients for org */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!isSensitivePrivilegedRole(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const records = await prisma.sensitiveRecord.findMany({
      where: { organizationId: gate.organizationId },
      orderBy: { setAt: 'desc' },
      include: {
        client: { select: { id: true, name: true, mrn: true, status: true } },
      },
    });

    const clientIds = records.map((r) => r.clientId);
    const [activeGrants, recentDenied] = await Promise.all([
      prisma.breakTheGlassGrant.findMany({
        where: {
          organizationId: gate.organizationId,
          clientId: { in: clientIds.length ? clientIds : ['__none__'] },
          expiresAt: { gt: new Date() },
        },
        select: { clientId: true, userId: true, reason: true, grantedAt: true, expiresAt: true },
      }),
      prisma.sensitiveAccessLog.findMany({
        where: {
          organizationId: gate.organizationId,
          accessType: 'break_the_glass',
          timestamp: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { timestamp: 'desc' },
        take: 50,
        select: {
          id: true,
          clientId: true,
          userId: true,
          reason: true,
          timestamp: true,
          path: true,
        },
      }),
    ]);

    const userIds = [
      ...new Set([
        ...records.flatMap((r) => r.accessWhitelist),
        ...records.map((r) => r.setById).filter(Boolean) as string[],
        ...activeGrants.map((g) => g.userId),
        ...recentDenied.map((l) => l.userId),
      ]),
    ];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds }, organizationId: gate.organizationId },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'sensitiveRecord',
      metadata: {
        count: records.length,
        clientIds: clientIds.slice(0, 50),
        activeBreakGlassCount: activeGrants.length,
        recentBreakGlassCount: recentDenied.length,
      },
    });

    return NextResponse.json({
      success: true,
      records: records.map((r) => ({
        id: r.id,
        clientId: r.clientId,
        clientName: r.client.name,
        clientMrn: r.client.mrn,
        clientStatus: r.client.status,
        reason: r.reason,
        reasonNote: r.reasonNote,
        alias: r.alias,
        noteClassification: r.noteClassification,
        accessWhitelist: r.accessWhitelist,
        whitelistUsers: r.accessWhitelist.map((id) => userMap[id] ?? { id, name: id }),
        setById: r.setById,
        setByName: r.setById ? userMap[r.setById]?.name ?? null : null,
        setAt: r.setAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        activeBreakGlass: activeGrants
          .filter((g) => g.clientId === r.clientId)
          .map((g) => ({
            ...g,
            grantedAt: g.grantedAt.toISOString(),
            expiresAt: g.expiresAt.toISOString(),
            userName: userMap[g.userId]?.name ?? g.userId,
          })),
      })),
      recentBreakGlass: recentDenied.map((l) => ({
        ...l,
        timestamp: l.timestamp.toISOString(),
        userName: userMap[l.userId]?.name ?? l.userId,
        clientName: records.find((r) => r.clientId === l.clientId)?.client.name ?? l.clientId,
      })),
    });
  } catch (err) {
    console.error('[sensitive-records GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load sensitive records' },
      { status: 500 }
    );
  }
}
