import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { LEAD_SOURCES, LEAD_STAGES } from '@/lib/marketing/constants';
import { canAccessMarketingLeads, updateMarketingLead } from '@/lib/marketing/manage';

export const runtime = 'nodejs';

const patchSchema = z.object({
  stage: z.enum(LEAD_STAGES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  notes: z.string().max(5000).optional(),
  consentSms: z.boolean().optional(),
  messages: z.array(z.string()).optional(),
  tasks: z.array(z.string()).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessMarketingLeads(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid patch' }, { status: 400 });
  }
  const result = await updateMarketingLead(gate.organizationId, id, parsed.data);
  if (result.ok === false) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, lead: result.lead });
}
