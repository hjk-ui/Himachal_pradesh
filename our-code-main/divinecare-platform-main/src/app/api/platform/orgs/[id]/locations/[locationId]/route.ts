import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/auth/tenant';
import { deactivateLocation, updateLocation } from '@/lib/org/locations';

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  code: z.string().max(20).optional().nullable(),
  addressLine1: z.string().max(200).optional().nullable(),
  addressLine2: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(40).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  timezone: z.string().max(80).optional().nullable(),
  isPrimary: z.boolean().optional(),
  active: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string; locationId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id, locationId } = await ctx.params;
    const body = updateSchema.parse(await req.json());
    const result = await updateLocation(locationId, body, id);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, location: result.location });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not update location' },
      { status: 400 }
    );
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id, locationId } = await ctx.params;
    const result = await deactivateLocation(locationId, id);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, location: result.location });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not deactivate location' },
      { status: 400 }
    );
  }
}
