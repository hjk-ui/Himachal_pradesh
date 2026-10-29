import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClinicalContext } from '@/lib/clinical/access';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canEditPayerMaster } from '@/lib/billing/payerMaster';
import { PanelError, listPanels, updatePanel } from '@/lib/billing/payerPanelsDb';

export const runtime = 'nodejs';

/** PATCH /api/billing/panels/[id] — edit an insurance panel (billing + leadership). Audits changed field names only. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireClinicalContext('/dashboard/billing/panels');
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canEditPayerMaster(gate.role)) {
    return NextResponse.json({ success: false, error: 'Only billing or practice leadership can change insurance panels' }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    const body = await req.json().catch(() => ({}));
    const result = await updatePanel(gate.organizationId, gate.userId, id, body?.panel ?? body);
    if (result.fields.length) {
      await auditPhiAccess({
        gate, req, action: 'UPDATE', resourceType: 'PayerPanel', resourceId: id,
        metadata: { change: 'panel_updated', fields: result.fields },
      });
    }
    return NextResponse.json({ success: true, changed: result.fields, panels: await listPanels(gate.organizationId) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      return NextResponse.json({ success: false, error: issue?.message || 'Invalid panel', field: issue?.path?.[0] ?? null }, { status: 400 });
    }
    if (error instanceof PanelError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    console.error('[billing/panels PATCH]', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not save the panel' }, { status: 500 });
  }
}
