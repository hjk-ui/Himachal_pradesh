import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { SUD_MEASURES, scheduleModule, type SudMeasureKey } from '@/lib/sud/measures';

export const runtime = 'nodejs';

const keys = SUD_MEASURES.map((m) => m.key) as [SudMeasureKey, ...SudMeasureKey[]];

const bodySchema = z.object({
  clientIds: z.array(z.string().min(1)).min(1).max(50),
  measures: z.array(z.enum(keys)).min(1),
});

/**
 * Assign SUD measures to MBC outcome schedule — dedupe active schedules.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessPath(gate.role, '/dashboard/ehr/scanner') &&
    !canAccessPath(gate.role, '/dashboard/ehr/assessments')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
  }

  let assigned = 0;
  let skipped = 0;
  for (const clientId of parsed.data.clientIds) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: gate.organizationId },
      select: { id: true, name: true },
    });
    if (!client) continue;
    for (const measure of parsed.data.measures) {
      const module = scheduleModule(clientId, measure);
      const existing = await prisma.clinicModuleState.findUnique({
        where: {
          organizationId_module: { organizationId: gate.organizationId, module },
        },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      const meta = SUD_MEASURES.find((m) => m.key === measure)!;
      await prisma.clinicModuleState.create({
        data: {
          organizationId: gate.organizationId,
          module,
          data: {
            clientId,
            clientName: client.name,
            measure,
            label: meta.label,
            frequency: meta.frequency,
            itemContentPending: meta.itemContentPending,
            status: 'active',
            assignedAt: new Date().toISOString(),
            assignedById: gate.userId,
          },
        },
      });
      assigned += 1;
    }
  }

  console.info('[SUD_MEASURES_ASSIGNED]', {
    organizationId: gate.organizationId,
    actorId: gate.userId,
    assigned,
    skipped,
  });

  return NextResponse.json({ success: true, assigned, skipped });
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  return NextResponse.json({
    success: true,
    measures: SUD_MEASURES,
    autoAssignDefault: false,
  });
}
