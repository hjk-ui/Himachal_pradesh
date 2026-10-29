import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  getOvernightEligibilitySettings,
  saveOvernightEligibilitySettings,
} from '@/lib/eligibility/overnight-settings';

export const runtime = 'nodejs';

const MANAGERS = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING']);

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!MANAGERS.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const settings = await getOvernightEligibilitySettings(gate.organizationId);
  return NextResponse.json({ success: true, settings });
}

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  allowTestClearinghouse: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!MANAGERS.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid settings' }, { status: 400 });
  }
  const settings = await saveOvernightEligibilitySettings(
    gate.organizationId,
    parsed.data,
    gate.userId
  );
  return NextResponse.json({ success: true, settings });
}
