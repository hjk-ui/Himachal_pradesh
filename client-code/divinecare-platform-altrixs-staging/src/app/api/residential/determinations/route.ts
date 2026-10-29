import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { validateClientBelongsToOrg } from '@/lib/crisis/tenantIsolation';

export const runtime = 'nodejs';

/** Residential admission determination log (CARF): every screening outcome, stored per org. */
const createSchema = z.object({
  applicantName: z.string().trim().min(1).max(160),
  clientId: z.string().max(128).optional().nullable(),
  outcome: z.enum(['admitted', 'waitlisted', 'referred']),
  level: z.enum(['3.5', '3.1']).optional().nullable(),
  detail: z.string().trim().min(1).max(2000),
  residentId: z.string().max(128).optional().nullable(),
});

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/residential')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const rows = await prisma.residentialDetermination.findMany({
      where: { organizationId: gate.organizationId },
      orderBy: { determinedAt: 'desc' },
      take: 200,
    });
    await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'residentialDetermination', metadata: { count: rows.length } });
    return NextResponse.json({ success: true, determinations: rows }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[residential/determinations GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not load the determination log' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/residential')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid determination' }, { status: 400 });
  }
  const body = parsed.data;
  try {
    if (body.clientId && !(await validateClientBelongsToOrg(body.clientId, gate.organizationId))) {
      return NextResponse.json({ success: false, error: 'Client not found in this organization' }, { status: 400 });
    }
    const created = await prisma.residentialDetermination.create({
      data: {
        organizationId: gate.organizationId,
        applicantName: body.applicantName,
        clientId: body.clientId || null,
        outcome: body.outcome,
        level: body.level ?? null,
        detail: body.detail,
        residentId: body.residentId || null,
        createdById: gate.userId,
      },
    });
    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'residentialDetermination',
      resourceId: created.id,
      patientId: created.clientId,
      metadata: { outcome: created.outcome, level: created.level },
    });
    return NextResponse.json({ success: true, determination: created }, { status: 201 });
  } catch (err) {
    console.error('[residential/determinations POST]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not save the determination' }, { status: 500 });
  }
}
