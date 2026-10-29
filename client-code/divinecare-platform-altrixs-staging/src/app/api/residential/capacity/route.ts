import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { canEditPracticeSettings } from '@/lib/practice/access';
import { PracticeSettingsError } from '@/lib/practice/store';
import { firstIssue } from '@/lib/practice/settings';
import { loadResidentialCapacity, saveResidentialCapacity } from '@/lib/residential/capacityServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Residential capacity (beds per location and ASAM level). No PHI.
 * GET: residential roles (API_PATH_ACCESS /api/residential) — the bed board reads it.
 * PUT: practice leadership (Practice settings editors), audited; denials audited.
 */
async function locationsOf(organizationId: string) {
  return prisma.location.findMany({
    where: { organizationId },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, active: true },
  });
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  try {
    const [capacity, locations] = await Promise.all([loadResidentialCapacity(gate.organizationId), locationsOf(gate.organizationId)]);
    return NextResponse.json({ success: true, ...capacity, locations, canEdit: canEditPracticeSettings(String(gate.role)) });
  } catch (err) {
    console.error('[api/residential/capacity GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not load residential capacity' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const actor = { organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) };
  if (!canEditPracticeSettings(actor.role)) {
    await writeAuditLog({
      action: 'residential_capacity_updated',
      actorUserId: actor.userId,
      actorRole: actor.role,
      organizationId: actor.organizationId,
      resourceType: 'ResidentialCapacity',
      outcome: 'DENIED',
    });
    return NextResponse.json({ success: false, error: 'Only practice leadership can change residential capacity' }, { status: 403 });
  }
  try {
    const saved = await saveResidentialCapacity(actor, await req.json().catch(() => ({})));
    const locations = await locationsOf(actor.organizationId);
    return NextResponse.json({ success: true, ...saved, locations, canEdit: true });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ success: false, error: firstIssue(err) }, { status: 400 });
    if (err instanceof PracticeSettingsError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error('[api/residential/capacity PUT]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { success: false, error: 'Could not save residential capacity (has the 20261018_residential_capacity migration run?)' },
      { status: 500 }
    );
  }
}
