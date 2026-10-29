import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { LEAD_SOURCES } from '@/lib/marketing/constants';
import {
  canAccessMarketingLeads,
  createMarketingLead,
  listMarketingLeads,
} from '@/lib/marketing/manage';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessMarketingLeads(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const includeClosed = url.searchParams.get('includeClosed') === '1';
  const leads = await listMarketingLeads(gate.organizationId, { includeClosed });
  return NextResponse.json({ success: true, leads });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(40).optional(),
  email: z.string().max(200).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessMarketingLeads(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid lead' }, { status: 400 });
  }
  const result = await createMarketingLead(gate.organizationId, gate.userId, parsed.data);
  if (result.ok === false) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, lead: result.lead });
}
