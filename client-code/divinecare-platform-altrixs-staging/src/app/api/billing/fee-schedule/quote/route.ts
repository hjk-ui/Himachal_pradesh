import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canMutateClaims } from '@/lib/billing/claims';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { claimLineCpt, pickFee, visitContext } from '@/lib/billing/feeSchedule';
import { loadFeeSchedule } from '@/lib/billing/feeScheduleDb';

export const runtime = 'nodejs';

const bodySchema = z.object({
  clientId: z.string().min(1).max(128).optional().nullable(),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  payer: z.string().max(200).optional().nullable(),
  telehealth: z.boolean().optional(),
  itp: z.boolean().optional(),
  lines: z
    .array(z.object({ cpt: z.string().trim().min(3).max(20), code: z.string().trim().max(40).optional().nullable() }))
    .min(1)
    .max(50),
});

/**
 * POST /api/billing/fee-schedule/quote — fee schedule defaults for New Claim lines. The visit
 * context comes from the client chart (child = under 18 on the date of service; self-pay = no
 * payer) and the form (payer, telehealth). Returns per line the fee, the CPT the payer gets and
 * the Valant code used.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canMutateClaims(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const body = bodySchema.parse(await req.json());
    let client: { dateOfBirth: Date | null; insurancePayer: string | null; insuranceEffectiveTo: Date | null } = {
      dateOfBirth: null,
      insurancePayer: null,
      insuranceEffectiveTo: null,
    };
    if (body.clientId) {
      const row = await prisma.client.findFirst({
        where: {
          AND: [
            { id: body.clientId },
            clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role as Role }),
          ],
        },
        select: { dateOfBirth: true, insurancePayer: true, insuranceEffectiveTo: true },
      });
      if (!row) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
      client = row;
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'feeScheduleQuote', resourceId: body.clientId, patientId: body.clientId,
        metadata: { lines: body.lines.length },
      });
    }
    const vc = visitContext(client, { serviceDate: body.serviceDate ?? null, payer: body.payer ?? null, telehealth: body.telehealth });
    const items = await loadFeeSchedule(gate.organizationId, { activeOnly: true });
    const quotes = body.lines.map((l) => {
      const q = pickFee(items, { cpt: l.cpt, code: l.code || null, ...vc, itp: Boolean(body.itp) });
      const line = claimLineCpt(q, { selfPay: vc.selfPay });
      return { ...q, lineCpt: line.cpt, warnings: line.warning ? [...q.warnings, line.warning] : q.warnings };
    });
    return NextResponse.json({ success: true, context: { ...vc, itp: Boolean(body.itp) }, quotes });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ success: false, error: 'Invalid quote request' }, { status: 400 });
    console.error('[billing fee-schedule quote]', err);
    return NextResponse.json({ success: false, error: 'Could not price the claim lines' }, { status: 500 });
  }
}
