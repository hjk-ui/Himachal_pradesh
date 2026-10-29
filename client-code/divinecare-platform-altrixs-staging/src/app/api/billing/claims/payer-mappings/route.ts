import { NextResponse } from 'next/server';
import { z } from 'zod';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { canEditPayerMappings, listPayerMappings, savePayerMapping } from '@/lib/billing/waystarConfig';
import { claimsGate, errorJson } from '../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: Waystar payer mapping (payer name / aliases -> Waystar payer ID). No PHI. */
export async function GET() {
  const g = await claimsGate('/dashboard/billing/payer-settings');
  if (!g.ok) return g.response;
  try {
    return NextResponse.json({
      success: true,
      canEdit: canEditPayerMappings(g.actor.actorRole),
      mappings: await listPayerMappings(g.actor.organizationId),
    });
  } catch (error) {
    return errorJson(error, 'Could not load the Waystar payer mapping (has the 20261016 migration run?)');
  }
}

/** PUT: create or update this organization's mapping for a payer name (billing admins). */
export async function PUT(request: Request) {
  const g = await claimsGate('/dashboard/billing/payer-settings');
  if (!g.ok) return g.response;
  if (!canEditPayerMappings(g.actor.actorRole)) {
    return NextResponse.json({ success: false, error: 'Only billing admins can edit Waystar payer IDs' }, { status: 403 });
  }
  try {
    const row = await savePayerMapping(g.actor.organizationId, g.actor.actorUserId, await request.json().catch(() => ({})));
    await writeAuditLog({
      action: 'waystar_payer_mapping_saved',
      actorUserId: g.actor.actorUserId,
      organizationId: g.actor.organizationId,
      resourceType: 'WaystarPayerMapping',
      resourceId: row.id,
      metadata: { waystarPayerId: row.waystarPayerId, verified: row.verified, active: row.active },
    });
    return NextResponse.json({ success: true, mapping: row, mappings: await listPayerMappings(g.actor.organizationId) });
  } catch (error) {
    if (!(error instanceof z.ZodError) && error instanceof Error && /already mapped/.test(error.message)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return errorJson(error, 'Could not save the payer mapping');
  }
}
