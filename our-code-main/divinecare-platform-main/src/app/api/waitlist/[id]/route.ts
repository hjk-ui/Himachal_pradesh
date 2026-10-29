import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  canAccessWaitlist,
  closeWaitlistEntry,
  updateWaitlistEntry,
} from '@/lib/waitlist/manage';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(40).optional().nullable(),
  specialty: z.string().trim().min(1).max(80).optional(),
  urgency: z.enum(['routine', 'urgent', 'crisis']).optional(),
  insurancePayer: z.string().trim().max(120).optional().nullable(),
  referralSource: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  preferredClinician: z.string().trim().max(120).optional().nullable(),
  status: z.enum(['waiting', 'matched', 'scheduled', 'closed']).optional(),
  action: z.enum(['close']).optional(),
});

export async function PATCH(
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

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = patchSchema.parse(await req.json());

    if (body.action === 'close' || body.status === 'closed') {
      const result = await closeWaitlistEntry(gate.organizationId, id);
      if (!result.ok) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: result.status }
        );
      }
      return NextResponse.json({ success: true, entry: result.entry });
    }

    const result = await updateWaitlistEntry(gate.organizationId, id, {
      ...body,
      email: body.email === '' ? null : body.email,
    });
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
        ? 'Invalid waitlist update'
        : err.message || 'Could not update waitlist entry';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
