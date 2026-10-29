import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { deriveFee, isInsuranceBillable } from '@/lib/billing/feeSchedule';
import { FEE_EDIT_ROLES, toFeeItem } from '@/lib/billing/feeScheduleDb';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    description: z.string().trim().min(1).max(200).optional(),
    feeCents: z.number().int().min(0).max(10_000_000).optional(),
    billedCpt: z.string().trim().toUpperCase().max(20).nullable().optional(),
    telehealth: z.boolean().optional(),
    selfPay: z.boolean().optional(),
    child: z.boolean().optional(),
    itp: z.boolean().optional(),
    exactOnly: z.boolean().optional(),
    variantLabel: z.string().trim().max(80).optional(),
    active: z.boolean().optional(),
    needsReview: z.boolean().optional(),
    reviewNote: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

/**
 * PATCH /api/billing/fee-schedule/[id] — staff edit of one fee row. Any data edit marks the row
 * source 'altrixs' so a later Valant re-import keeps it (unless "overwrite edits"). The active
 * toggle alone does not. insuranceBillable is always recomputed: self-pay is never billable.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!FEE_EDIT_ROLES.has(String(gate.role))) {
    return NextResponse.json({ success: false, error: 'Only billing or practice leadership can edit the fee schedule' }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    const body = patchSchema.parse(await req.json());
    const row = await prisma.feeScheduleItem.findFirst({ where: { id, organizationId: gate.organizationId } });
    if (!row) return NextResponse.json({ success: false, error: 'Fee schedule item not found' }, { status: 404 });

    const cur = toFeeItem(row);
    const flags = {
      telehealth: body.telehealth ?? cur.telehealth,
      selfPay: body.selfPay ?? cur.selfPay,
      child: body.child ?? cur.child,
      itp: body.itp ?? cur.itp,
      exactOnly: body.exactOnly ?? cur.exactOnly,
    };
    const billedCpt = body.billedCpt !== undefined ? body.billedCpt || null : cur.billedCpt;
    const feeCents = body.feeCents ?? cur.feeCents;
    const description = body.description ?? cur.description;
    // Re-derive anomalies when the billed code changes; otherwise keep (or apply) staff's review state
    const derived = deriveFee({ code: cur.code, description, feeCents, billedCpt, flags, variantLabel: body.variantLabel ?? cur.variantLabel });
    const billedChanged = body.billedCpt !== undefined && billedCpt !== cur.billedCpt;
    const needsReview = body.needsReview ?? (billedChanged ? derived.needsReview : cur.needsReview);
    const reviewNote = body.reviewNote !== undefined ? body.reviewNote || null : billedChanged ? derived.reviewNote : cur.reviewNote;

    const dataKeys = Object.keys(body).filter((k) => k !== 'active');
    const changedFields = Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== (cur as Record<string, unknown>)[k]);
    const updated = await prisma.feeScheduleItem.update({
      where: { id: row.id },
      data: {
        description,
        feeCents,
        billedCpt,
        ...flags,
        variantLabel: derived.variantLabel,
        insuranceBillable: isInsuranceBillable({ baseCpt: cur.baseCpt, billedCpt, selfPay: flags.selfPay }),
        needsReview,
        reviewNote,
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(dataKeys.length ? { source: 'altrixs', editedById: gate.userId, editedAt: new Date() } : {}),
      },
    });
    await auditPhiAccess({
      gate, req, action: 'UPDATE', resourceType: 'feeScheduleItem', resourceId: row.id,
      metadata: { code: row.code, fields: changedFields, markedEdited: dataKeys.length > 0 },
    });
    return NextResponse.json({ success: true, item: toFeeItem(updated) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: err.issues[0]?.message || 'Invalid fee schedule edit' }, { status: 400 });
    }
    console.error('[billing fee-schedule PATCH]', err);
    return NextResponse.json({ success: false, error: 'Could not save the fee schedule item' }, { status: 500 });
  }
}
