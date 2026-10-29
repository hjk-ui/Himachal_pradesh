import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

const scoreSchema = z.object({
  totalScore: z.number().min(0).max(40),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/ehr/assessments')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = scoreSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'AIMS score is required' }, { status: 400 });
  }
  const client = await prisma.client.findFirst({
    where: { id, organizationId: gate.organizationId },
    select: { id: true },
  });
  if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  const row = await prisma.clinicalAssessmentRecord.create({
    data: {
      organizationId: gate.organizationId,
      clientId: client.id,
      instrumentId: 'aims',
      instrumentName: 'AIMS',
      category: 'Movement',
      administrationType: 'Clinician',
      respondentType: 'Clinician',
      totalScore: parsed.data.totalScore,
      notes: parsed.data.notes || null,
      administeredById: gate.userId,
    },
  });
  return NextResponse.json({ success: true, id: row.id, totalScore: row.totalScore }, { status: 201 });
}
