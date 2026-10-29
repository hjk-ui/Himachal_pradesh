import { NextResponse } from 'next/server';
import { z } from 'zod';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { canEditBillingProviders, listBillingProviders, saveBillingProvider } from '@/lib/billing/waystarConfig';
import { claimsGate, errorJson } from '../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: billing providers (837P 2010AA organization NPIs) and their selection rules. No PHI. */
export async function GET() {
  const g = await claimsGate('/dashboard/billing/payer-settings');
  if (!g.ok) return g.response;
  try {
    return NextResponse.json({
      success: true,
      canEdit: canEditBillingProviders(g.actor.actorRole),
      providers: await listBillingProviders(g.actor.organizationId),
    });
  } catch (error) {
    return errorJson(error, 'Could not load billing providers (has the 20261016 migration run?)');
  }
}

/** PUT: create or update this organization's billing provider for an NPI (practice admins). */
export async function PUT(request: Request) {
  const g = await claimsGate('/dashboard/billing/payer-settings');
  if (!g.ok) return g.response;
  if (!canEditBillingProviders(g.actor.actorRole)) {
    return NextResponse.json({ success: false, error: 'Only practice admins can edit billing providers' }, { status: 403 });
  }
  try {
    const row = await saveBillingProvider(g.actor.organizationId, g.actor.actorUserId, await request.json().catch(() => ({})));
    await writeAuditLog({
      action: 'billing_provider_saved',
      actorUserId: g.actor.actorUserId,
      organizationId: g.actor.organizationId,
      resourceType: 'BillingProvider',
      resourceId: row.id,
      metadata: { npi: row.npi, isDefault: row.isDefault, active: row.active },
    });
    return NextResponse.json({ success: true, provider: row, providers: await listBillingProviders(g.actor.organizationId) });
  } catch (error) {
    // saveBillingProvider throws plain Errors for NPI / address problems
    if (!(error instanceof z.ZodError) && error instanceof Error && !/prisma/i.test(error.constructor.name)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return errorJson(error, 'Could not save the billing provider');
  }
}
