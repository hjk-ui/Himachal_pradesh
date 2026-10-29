import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';

// Scenario — Deletion attempt:
// Given an incident was filed by mistake (wrong client selected)
// When DELETE /api/incidents/:id is called
// Then API returns 405 Method Not Allowed; only PATCH to status='filed_in_error' is permitted
export async function DELETE() {
  return NextResponse.json(
    {
      success: false,
      error: 'Incidents cannot be deleted. Once created, the record is permanent. Mark as filed_in_error with explanation.',
    },
    {
      status: 405,
      headers: { Allow: 'GET, PATCH' },
    }
  );
}

const patchSchema = z.object({
  status: z.enum(['Open', 'Under Review', 'Investigation', 'Resolved', 'filed_in_error', 'reported', 'investigating', 'corrective_action', 'closed']).optional(),
  investigationNotes: z.string().optional(),
  rootCause: z.string().optional(),
  resolutionNote: z.string().optional(),
  errorExplanation: z.string().optional(),
  assignedTo: z.string().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/incidents')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = patchSchema.parse(await req.json());
  const moduleName = `incident:${id}`;
  const existing = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId: gate.organizationId, module: moduleName } },
  });
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Incident not found' }, { status: 404 });
  }
  const current = existing.data as { reportedById?: string; description?: string };
  const review = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER'].includes(gate.role);
  if (!review && current.reportedById !== gate.userId) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const updatedIncident = {
    ...current,
    ...body,
    id,
    reportedById: current.reportedById,
    updatedAt: new Date().toISOString(),
    updatedById: gate.userId,
  };
  await prisma.clinicModuleState.update({
    where: { organizationId_module: { organizationId: gate.organizationId, module: moduleName } },
    data: { data: updatedIncident },
  });
  return NextResponse.json({ success: true, incident: updatedIncident });
}
