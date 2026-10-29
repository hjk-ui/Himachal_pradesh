import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  canAccessWaitlist,
  closeWaitlistEntry,
  getWaitlistEntry,
  listContactAttempts,
  reopenWaitlistEntry,
  updateWaitlistEntry,
} from '@/lib/waitlist/manage';
import { canManageWaitlist, type WaitlistStage } from '@/lib/waitlist/standard';
import { presentFields, waitlistPatchSchema } from '@/lib/waitlist/schema';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

/** One entry with its contact log (audited view). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessWaitlist(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = paramsSchema.parse(await ctx.params);
  const entry = await getWaitlistEntry(gate.organizationId, id);
  if (!entry) return NextResponse.json({ success: false, error: 'Waitlist entry not found' }, { status: 404 });
  const contacts = await listContactAttempts(gate.organizationId, id);
  await auditPhiAccess({ gate, req, action: 'VIEW', resourceType: 'waitlist_entry', resourceId: id, metadata: { contactCount: contacts.length } });
  return NextResponse.json({ success: true, entry, contacts });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessWaitlist(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = waitlistPatchSchema.parse(await req.json());

    if (body.action === 'close' || body.action === 'reopen' || body.status === 'closed') {
      if (!canManageWaitlist(gate.role)) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      const reopen = body.action === 'reopen';
      const result = reopen
        ? await reopenWaitlistEntry(gate.organizationId, id)
        : await closeWaitlistEntry(gate.organizationId, id, body.closeReason, body.closeNote);
      if (!result.ok) {
        return NextResponse.json({ success: false, error: result.error }, { status: result.status });
      }
      await auditPhiAccess({
        gate,
        req,
        action: 'UPDATE',
        resourceType: 'waitlist_entry',
        resourceId: id,
        metadata: {
          fields: reopen ? ['stage', 'status'] : ['stage', 'status', 'closeReason', ...(body.closeNote ? ['notes'] : [])],
          closeReason: reopen ? null : body.closeReason ?? null,
          reopened: reopen || null,
        },
      });
      return NextResponse.json({ success: true, entry: result.entry });
    }

    const { action: _a, closeReason: _c, closeNote: _n, ...input } = body;
    const result = await updateWaitlistEntry(
      gate.organizationId,
      id,
      {
        ...input,
        stage: input.stage as WaitlistStage | undefined,
        email: input.email === '' ? null : input.email,
        dateOfBirth: input.dateOfBirth === '' ? null : input.dateOfBirth,
      },
      { userId: gate.userId, role: gate.role }
    );
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await auditPhiAccess({
      gate,
      req,
      action: 'UPDATE',
      resourceType: 'waitlist_entry',
      resourceId: id,
      metadata: { fields: presentFields(input), safetyScreenPositive: result.crisisGuidance || null },
    });
    return NextResponse.json({ success: true, entry: result.entry, crisisGuidance: result.crisisGuidance });
  } catch (err: any) {
    const message = err instanceof z.ZodError ? 'Invalid waitlist update' : err.message || 'Could not update waitlist entry';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
