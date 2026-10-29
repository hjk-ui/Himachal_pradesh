import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { deactivateLocation, updateLocation } from '@/lib/org/locations';

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  code: z.string().max(20).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(40).optional(),
  postalCode: z.string().max(20).optional(),
  phone: z.string().max(40).optional(),
  timezone: z.string().max(80).optional(),
  isPrimary: z.boolean().optional(),
  active: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const body = updateSchema.parse(await req.json());
    const result = await updateLocation(id, body, gate.organizationId);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, location: result.location });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not update location' },
      { status: 400 }
    );
  }
}

/** Soft-deactivate */
export async function DELETE(_req: Request, ctx: Ctx) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const result = await deactivateLocation(id, gate.organizationId);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, location: result.location });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not deactivate location' },
      { status: 400 }
    );
  }
}
