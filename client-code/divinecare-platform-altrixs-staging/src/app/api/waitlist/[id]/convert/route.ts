import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessWaitlist } from '@/lib/waitlist/manage';
import { canManageWaitlist } from '@/lib/waitlist/standard';
import { scheduleConversion } from '@/lib/waitlist/convert';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const bodySchema = z
  .object({
    linkClientId: z.string().min(1).max(128).optional().nullable(),
    createDespiteMatches: z.boolean().optional(),
    assignedToId: z.string().min(1).max(128).optional().nullable(),
    locationId: z.string().min(1).max(64).optional().nullable(),
    sendIntake: z.boolean().optional(),
  })
  .optional();

/** Convert without scheduling: create (or link) the client only. Same duplicate check as Schedule. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessWaitlist(gate.role) || !canManageWaitlist(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const text = await req.text();
    const body = bodySchema.parse(text ? JSON.parse(text) : undefined) ?? {};
    const result = await scheduleConversion(gate, id, { ...body, appointment: null }, req);
    if (result.ok === false) {
      if (result.status === 404) {
        await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'patient', resourceId: id, outcome: 'DENIED', metadata: { source: 'waitlist', waitlistEntryId: id, status: 404 } });
      }
      return NextResponse.json(
        { success: false, error: result.error, code: result.code ?? null, duplicates: result.duplicates ?? null },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, ...result, client: { id: result.clientId } });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof z.ZodError ? 'Invalid request' : err.message || 'Could not convert waitlist entry' },
      { status: 400 }
    );
  }
}
