import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  getPrimaryCareSettings,
  savePrimaryCareSettings,
} from '@/lib/medical/primary-care-settings';

export const runtime = 'nodejs';

const LEADERSHIP = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'PHYSICIAN', 'OFFICE_MANAGER']);

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const settings = await getPrimaryCareSettings(gate.organizationId);
  return NextResponse.json({ success: true, settings });
}

const patchSchema = z.object({
  notifyPatientWithinDays: z.number().int().min(1).max(90).nullable().optional(),
  labExpectedDays: z.number().int().min(1).max(90).nullable().optional(),
  referralReportDays: z.number().int().min(1).max(180).nullable().optional(),
});

export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!LEADERSHIP.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid settings' }, { status: 400 });
  }
  const settings = await savePrimaryCareSettings(gate.organizationId, parsed.data);
  return NextResponse.json({ success: true, settings });
}
