import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { PROGRAMS } from '@/lib/clinical/serviceEligibility/types';
import { SERVICE_SCANNER_PATH } from '@/lib/clinical/serviceEligibility/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LEADERSHIP = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);
const putSchema = z.object({ program: z.enum(PROGRAMS), leadUserId: z.string().min(1).max(64).nullable() });

/** GET — program leads (who receives Accept referrals) + active staff to choose from (leadership only). */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, SERVICE_SCANNER_PATH, gate.capabilities)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const leads = await prisma.serviceEligibilityProgramLead.findMany({ where: { organizationId: gate.organizationId }, select: { program: true, leadUserId: true } });
  const staff = LEADERSHIP.has(String(gate.role).toUpperCase())
    ? await prisma.user.findMany({
        where: { organizationId: gate.organizationId, status: 'ACTIVE', role: { notIn: ['FRONT_DESK', 'BILLING', 'HR'] } },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' },
        take: 500,
      })
    : [];
  return NextResponse.json({ success: true, leads, staff, canEdit: LEADERSHIP.has(String(gate.role).toUpperCase()) });
}

/** PUT — set or clear one program's lead (leadership). Audited. */
export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!LEADERSHIP.has(String(gate.role).toUpperCase())) return NextResponse.json({ success: false, error: 'Only leadership can set program leads' }, { status: 403 });
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const { program, leadUserId } = parsed.data;
  const key = { organizationId_program: { organizationId: gate.organizationId, program } };
  if (leadUserId === null) {
    await prisma.serviceEligibilityProgramLead.deleteMany({ where: { organizationId: gate.organizationId, program } });
  } else {
    const user = await prisma.user.findFirst({ where: { id: leadUserId, organizationId: gate.organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!user) return NextResponse.json({ success: false, error: 'Choose an active staff member of this organization' }, { status: 400 });
    await prisma.serviceEligibilityProgramLead.upsert({
      where: key,
      create: { organizationId: gate.organizationId, program, leadUserId, updatedById: gate.userId },
      update: { leadUserId, updatedById: gate.userId },
    });
  }
  await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'serviceEligibilityProgramLead', resourceId: program, metadata: { program, cleared: leadUserId === null } });
  return NextResponse.json({ success: true });
}
