import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  canAccessWaitlist,
  createWaitlistEntry,
  listWaitlistClinicians,
  listWaitlistEntries,
  listWaitlistLocations,
  listWaitlistPayers,
} from '@/lib/waitlist/manage';
import { canAddToWaitlist, canManageWaitlist } from '@/lib/waitlist/standard';
import { eligibilityAvailableFor } from '@/lib/waitlist/convert';
import { presentFields, waitlistEntrySchema } from '@/lib/waitlist/schema';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessWaitlist(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [entries, clinicians, locations, payers] = await Promise.all([
      listWaitlistEntries(gate.organizationId),
      listWaitlistClinicians(gate.organizationId),
      listWaitlistLocations(gate.organizationId),
      listWaitlistPayers(gate.organizationId),
    ]);
    await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'waitlist_entry', metadata: { count: entries.length } });
    return NextResponse.json({
      success: true,
      entries,
      clinicians,
      locations,
      payers,
      permissions: {
        canManage: canManageWaitlist(gate.role),
        canAdd: canAddToWaitlist(gate.role),
        eligibility: eligibilityAvailableFor(gate.role),
      },
    });
  } catch (err) {
    console.error('[waitlist GET]', err);
    return NextResponse.json({ success: false, error: 'Failed to load waitlist' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessWaitlist(gate.role) || !canAddToWaitlist(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = waitlistEntrySchema.parse(await req.json());
    if (!body.specialty) {
      return NextResponse.json({ success: false, error: 'Service requested is required' }, { status: 400 });
    }
    const result = await createWaitlistEntry(
      gate.organizationId,
      { ...body, specialty: body.specialty, email: body.email || null, dateOfBirth: body.dateOfBirth || null },
      { userId: gate.userId, role: gate.role }
    );
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'waitlist_entry',
      resourceId: result.entry.id,
      metadata: { fields: presentFields(body), safetyScreenPositive: result.crisisGuidance || null },
    });
    return NextResponse.json({ success: true, entry: result.entry, crisisGuidance: result.crisisGuidance }, { status: 201 });
  } catch (err: any) {
    const message =
      err instanceof z.ZodError ? 'Please check the waitlist form and try again.' : err.message || 'Could not create waitlist entry';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
