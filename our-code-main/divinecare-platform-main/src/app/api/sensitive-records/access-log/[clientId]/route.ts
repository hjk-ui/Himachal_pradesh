import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { isSensitivePrivilegedRole } from '@/lib/privacy/sensitiveAccess';
import { clientByIdWhere } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

/** GET /api/sensitive-records/access-log/[clientId] */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ clientId: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!isSensitivePrivilegedRole(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { clientId } = await ctx.params;
    const client = await prisma.client.findFirst({
      where: clientByIdWhere(clientId, gate.organizationId),
      select: { id: true, name: true },
    });
    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    const logs = await prisma.sensitiveAccessLog.findMany({
      where: { organizationId: gate.organizationId, clientId },
      orderBy: { timestamp: 'desc' },
      take: 200,
    });

    const userIds = [...new Set(logs.map((l) => l.userId))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    return NextResponse.json({
      success: true,
      clientId,
      clientName: client.name,
      logs: logs.map((l) => ({
        id: l.id,
        userId: l.userId,
        userName: userMap[l.userId]?.name ?? l.userId,
        userEmail: userMap[l.userId]?.email ?? null,
        accessType: l.accessType,
        path: l.path,
        reason: l.reason,
        timestamp: l.timestamp.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[sensitive-records access-log GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load access log' },
      { status: 500 }
    );
  }
}
