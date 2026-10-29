import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/auth/tenant';
import {
  getOrganizationDetail,
  updateOrganization,
  deleteOrganization,
} from '@/lib/platform/manage';

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  active: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const organization = await getOrganizationDetail(id);
    if (!organization) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, organization });
  } catch (err) {
    console.error('[platform/orgs/[id] GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load organization' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json());
    const result = await updateOrganization(id, body);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, organization: result.organization });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not update organization' },
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
    const { id } = await ctx.params;
    const result = await deleteOrganization(id);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, name: result.name });
  } catch (err) {
    console.error('[platform/orgs/[id] DELETE]', err);
    return NextResponse.json(
      { success: false, error: 'Could not delete organization' },
      { status: 500 }
    );
  }
}
