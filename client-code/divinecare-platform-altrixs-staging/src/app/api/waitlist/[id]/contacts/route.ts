import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessWaitlist, listContactAttempts, logContactAttempt } from '@/lib/waitlist/manage';
import { canManageWaitlist } from '@/lib/waitlist/standard';
import { contactAttemptSchema, presentFields } from '@/lib/waitlist/schema';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessWaitlist(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { id } = paramsSchema.parse(await ctx.params);
  const contacts = await listContactAttempts(gate.organizationId, id);
  await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'waitlist_contact', resourceId: id, metadata: { count: contacts.length } });
  return NextResponse.json({ success: true, contacts });
}

/** Log an outreach attempt (call / voicemail / email / portal) with outcome and next follow-up. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessWaitlist(gate.role) || !canManageWaitlist(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = contactAttemptSchema.parse(await req.json());
    const actorName = (gate.session?.user as { name?: string | null } | undefined)?.name ?? null;
    const result = await logContactAttempt(gate.organizationId, id, { userId: gate.userId, name: actorName }, { ...body, nextFollowUpAt: body.nextFollowUpAt || null });
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'waitlist_contact',
      resourceId: id,
      metadata: { fields: presentFields(body), method: body.method, outcome: body.outcome },
    });
    return NextResponse.json({ success: true, entry: result.entry, promptClose: result.promptClose }, { status: 201 });
  } catch (err: any) {
    const message = err instanceof z.ZodError ? 'Pick a method and an outcome' : err.message || 'Could not log contact';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
