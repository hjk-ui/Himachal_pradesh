import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientByIdWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canBreakGlass, isLeadershipRole } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

const breakGlassSchema = z.object({
  reason: z.string().trim().min(15, 'Reason must be at least 15 characters').max(1000),
});

/** POST /api/sensitive-records/[clientId]/break-glass — 24h emergency grant */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ clientId: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { clientId } = await ctx.params;
    // Leadership + licensed treating clinicians / prescribers only (canBreakGlass)
    if (!canBreakGlass(gate.role)) {
      await auditPhiAccess({ gate, req, action: 'BREAK_GLASS', resourceType: 'breakTheGlassGrant', patientId: clientId, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
      return NextResponse.json({ success: false, error: 'Your role cannot use emergency access' }, { status: 403 });
    }
    const body = breakGlassSchema.parse(await req.json());

    const client = await prisma.client.findFirst({
      where: clientByIdWhere(clientId, gate.organizationId),
      select: { id: true },
    });
    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    // Break-the-glass lifts the Part 2 lock, never the caseload rule: non-leadership roles only
    // for a client on their own caseload / care team (clientAccessWhere).
    if (!isLeadershipRole(gate.role)) {
      const onCaseload = await prisma.client.findFirst({
        where: { AND: [{ id: clientId }, clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role })] },
        select: { id: true },
      });
      if (!onCaseload) {
        await auditPhiAccess({ gate, req, action: 'BREAK_GLASS', resourceType: 'breakTheGlassGrant', patientId: clientId, outcome: 'DENIED', metadata: { reason: 'not_on_caseload' } });
        return NextResponse.json({ success: false, error: 'Emergency access is limited to clients on your caseload' }, { status: 403 });
      }
    }

    const protectedRec = await prisma.sensitiveRecord.findFirst({
      where: { clientId, organizationId: gate.organizationId },
      select: { id: true },
    });
    if (!protectedRec) {
      return NextResponse.json(
        { success: false, error: 'Client is not a protected record' },
        { status: 400 }
      );
    }

    const grantedAt = new Date();
    const expiresAt = new Date(grantedAt.getTime() + 24 * 60 * 60 * 1000);

    const [grant] = await prisma.$transaction([
      prisma.breakTheGlassGrant.create({
        data: {
          organizationId: gate.organizationId,
          clientId,
          userId: gate.userId,
          reason: body.reason,
          grantedAt,
          expiresAt,
        },
      }),
      prisma.sensitiveAccessLog.create({
        data: {
          organizationId: gate.organizationId,
          clientId,
          userId: gate.userId,
          accessType: 'break_the_glass',
          path: `/api/sensitive-records/${clientId}/break-glass`,
          reason: body.reason,
        },
      }),
    ]);

    // Reason text lives on the grant row; the audit entry carries ids only
    await auditPhiAccess({ gate, req, action: 'BREAK_GLASS', resourceType: 'breakTheGlassGrant', resourceId: grant.id, patientId: clientId, metadata: { expiresAt: expiresAt.toISOString() } });
    return NextResponse.json({
      success: true,
      grant: {
        id: grant.id,
        clientId: grant.clientId,
        userId: grant.userId,
        reason: grant.reason,
        grantedAt: grant.grantedAt.toISOString(),
        expiresAt: grant.expiresAt.toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: err.issues[0]?.message || 'Invalid request' },
        { status: 400 }
      );
    }
    console.error('[break-glass POST]', err);
    return NextResponse.json(
      { success: false, error: 'Could not create break-glass grant' },
      { status: 500 }
    );
  }
}
