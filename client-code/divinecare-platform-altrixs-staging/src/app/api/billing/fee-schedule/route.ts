import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canMutateClaims } from '@/lib/billing/claims';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { deriveFee } from '@/lib/billing/feeSchedule';
import { FEE_EDIT_ROLES, loadFeeSchedule, toFeeItem } from '@/lib/billing/feeScheduleDb';
import { cptByCode, cptFeeMissing } from '@/lib/constants/cpt';

export const runtime = 'nodejs';

/**
 * GET /api/billing/fee-schedule — the org fee schedule (?active=1 for active rows only).
 * Billing / leadership (the Fee Schedule page) and claim creators (variant picker). Not PHI.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canMutateClaims(gate.role) && !canAccessPath(gate.role, '/dashboard/billing/fee-schedule')) {
    return NextResponse.json({ success: false, error: 'Billing access required' }, { status: 403 });
  }
  const activeOnly = new URL(req.url).searchParams.get('active') === '1';
  const items = await loadFeeSchedule(gate.organizationId, { activeOnly });
  return NextResponse.json({ success: true, items, canEdit: FEE_EDIT_ROLES.has(String(gate.role)) });
}

const postSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{5}$/, 'Enter a 5-character CPT / HCPCS code'),
  feeCents: z.number().int().min(1, 'Enter a fee greater than $0.00').max(10_000_000),
});

/**
 * POST /api/billing/fee-schedule — set the fee for a built-in code that has none (e.g. 99212, added
 * 2026-10-21 with "Fee not set"). Creates one plain fee row (source altrixs, billed as the same CPT).
 * Billing / leadership only; audited. Codes that already have a fee row are edited with PATCH.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!FEE_EDIT_ROLES.has(String(gate.role))) {
    return NextResponse.json({ success: false, error: 'Only billing or practice leadership can edit the fee schedule' }, { status: 403 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid fee' }, { status: 400 });
  const { code, feeCents } = parsed.data;
  const row = cptByCode(code);
  if (!row || !cptFeeMissing(code)) {
    return NextResponse.json({ success: false, error: `${code} is not a built-in code waiting for a fee` }, { status: 400 });
  }
  const existing = await prisma.feeScheduleItem.findFirst({ where: { organizationId: gate.organizationId, code } });
  if (existing) return NextResponse.json({ success: false, error: `${code} is already in the fee schedule: edit that row` }, { status: 409 });
  const d = deriveFee({ code, description: row.desc, feeCents, billedCpt: code });
  const created = await prisma.feeScheduleItem.create({
    data: {
      organizationId: gate.organizationId, code: d.code, description: d.description, feeCents, billedCpt: d.billedCpt, baseCpt: d.baseCpt,
      telehealth: d.telehealth, selfPay: d.selfPay, child: d.child, itp: d.itp, exactOnly: d.exactOnly, variantLabel: d.variantLabel,
      insuranceBillable: d.insuranceBillable, needsReview: d.needsReview, reviewNote: d.reviewNote,
      source: 'altrixs', editedById: gate.userId, editedAt: new Date(),
    },
  });
  await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'feeScheduleItem', resourceId: created.id, metadata: { code, feeCents } });
  return NextResponse.json({ success: true, item: toFeeItem(created) }, { status: 201 });
}
