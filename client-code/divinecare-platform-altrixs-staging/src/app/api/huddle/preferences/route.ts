import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { canViewHuddle } from '@/lib/huddle/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The signed-in user's huddle email preference ("Email me when tomorrow's summary is ready").
 * GET → { emailNotice }; PUT { emailNotice: boolean }. Default on (User.huddleEmailOptOutAt null).
 * Own preference only; no PHI.
 */
async function gateFor() {
  const gate = await requireOrgContext();
  if (!gate.ok) return { error: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  if (!canViewHuddle(gate.role)) return { error: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  return { gate };
}

export async function GET() {
  const { gate, error } = await gateFor();
  if (error) return error;
  const u = await prisma.user.findUnique({ where: { id: gate.userId }, select: { huddleEmailOptOutAt: true } });
  return NextResponse.json({ success: true, emailNotice: !u?.huddleEmailOptOutAt }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PUT(req: Request) {
  const { gate, error } = await gateFor();
  if (error) return error;
  const body = (await req.json().catch(() => null)) as { emailNotice?: unknown } | null;
  if (typeof body?.emailNotice !== 'boolean') return NextResponse.json({ success: false, error: 'emailNotice must be true or false' }, { status: 400 });
  await prisma.user.update({ where: { id: gate.userId }, data: { huddleEmailOptOutAt: body.emailNotice ? null : new Date() } });
  await writeAuditLog({
    action: 'UPDATE',
    actorUserId: gate.userId,
    actorRole: gate.role,
    organizationId: gate.organizationId,
    resourceType: 'huddleEmailPreference',
    resourceId: gate.userId,
    metadata: { emailNotice: body.emailNotice },
    ...auditRequestMeta(req),
  }).catch(() => {});
  return NextResponse.json({ success: true, emailNotice: body.emailNotice });
}
