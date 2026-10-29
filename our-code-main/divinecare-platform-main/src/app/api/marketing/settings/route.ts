import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  canAccessMarketing,
  getMarketingSettings,
  saveMarketingSettings,
} from '@/lib/marketing/manage';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessMarketing(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const settings = await getMarketingSettings(gate.organizationId);
  return NextResponse.json({ success: true, ...settings });
}

const putSchema = z.object({
  postalAddress: z.string().max(500).optional(),
  channelsConnected: z.boolean().optional(),
  brandKit: z.string().max(2000).optional(),
  leadResponseHours: z.string().max(10).optional(),
  templates: z.string().max(5000).optional(),
  aiFeatures: z.boolean().optional(),
});

export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessMarketing(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid settings' }, { status: 400 });
  }
  const settings = await saveMarketingSettings(gate.organizationId, parsed.data);
  return NextResponse.json({ success: true, ...settings });
}
