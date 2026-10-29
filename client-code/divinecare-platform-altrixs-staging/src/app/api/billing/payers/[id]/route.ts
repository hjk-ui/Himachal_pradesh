import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClinicalContext } from '@/lib/clinical/access';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canEditPayerMaster } from '@/lib/billing/payerMaster';
import { PayerMasterError, listPayerMaster, updatePayer } from '@/lib/billing/payerMasterDb';

export const runtime = 'nodejs';

/** PATCH /api/billing/payers/[id] — edit a payer (billing + leadership). Audits changed field names only. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireClinicalContext('/dashboard/billing/payer-settings');
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canEditPayerMaster(gate.role)) {
    return NextResponse.json({ success: false, error: 'Only billing or practice leadership can edit payers' }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    const body = await req.json().catch(() => ({}));
    const result = await updatePayer(gate.organizationId, gate.userId, id, body?.payer ?? body);
    if (result.fields.length) {
      await auditPhiAccess({
        gate, req, action: 'UPDATE', resourceType: 'PayerRegistry', resourceId: id,
        metadata: { change: 'payer_updated', fields: result.fields },
      });
    }
    return NextResponse.json({ success: true, changed: result.fields, payers: await listPayerMaster(gate.organizationId) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      return NextResponse.json({ success: false, error: issue?.message || 'Invalid payer', field: issue?.path?.[0] ?? null }, { status: 400 });
    }
    if (error instanceof PayerMasterError) {
      return NextResponse.json({ success: false, error: error.message, existingId: error.existingId ?? null }, { status: error.status });
    }
    console.error('[billing/payers PATCH]', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not save the payer' }, { status: 500 });
  }
}
