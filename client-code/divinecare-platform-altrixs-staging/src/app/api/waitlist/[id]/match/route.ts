import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAssignPatientToClinician } from '@/lib/clients/orgScope';
import { canAccessWaitlist, matchWaitlistEntry } from '@/lib/waitlist/manage';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const bodySchema = z.object({
  clinicianId: z.string().min(1).max(128),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessWaitlist(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  if (!canAssignPatientToClinician(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Only Clinic Admin can assign a patient to a clinician' },
      { status: 403 }
    );
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = bodySchema.parse(await req.json());
    const result = await matchWaitlistEntry(gate.organizationId, id, body.clinicianId);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, entry: result.entry });
  } catch (err: any) {
    const message =
      err instanceof z.ZodError
        ? 'Clinician is required'
        : err.message || 'Could not match clinician';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
