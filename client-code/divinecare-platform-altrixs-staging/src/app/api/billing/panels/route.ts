import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireClinicalContext } from '@/lib/clinical/access';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canEditPayerMaster } from '@/lib/billing/payerMaster';
import { PanelError, createPanel, importLegacyPanels, listPanelStaff, listPanels, pendingLegacyPanels } from '@/lib/billing/payerPanelsDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE = '/dashboard/billing/panels';

function panelFail(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return NextResponse.json({ success: false, error: issue?.message || 'Invalid panel', field: issue?.path?.[0] ?? null }, { status: 400 });
  }
  if (error instanceof PanelError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  console.error('[billing/panels]', error instanceof Error ? error.message : 'unknown error');
  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}

/** GET /api/billing/panels — insurance panels, the payer list and staff to pick from, and old module-list panels not imported yet. No PHI. */
export async function GET() {
  const gate = await requireClinicalContext(PAGE);
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  try {
    const [panels, staff, payers, legacy] = await Promise.all([
      listPanels(gate.organizationId),
      listPanelStaff(gate.organizationId),
      prisma.payerRegistry.findMany({
        where: { organizationId: gate.organizationId },
        select: { id: true, name: true, payerId: true, active: true },
        orderBy: { name: 'asc' },
      }),
      pendingLegacyPanels(gate.organizationId),
    ]);
    return NextResponse.json(
      { success: true, canEdit: canEditPayerMaster(gate.role), panels, staff, payers, legacyPending: legacy.length },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return panelFail(error, 'Could not load insurance panels (has the 20261027_payer_master migration run?)');
  }
}

/** POST /api/billing/panels — add a panel, or { action: 'import_legacy' } to import the old list. Billing + leadership. */
export async function POST(req: Request) {
  const gate = await requireClinicalContext(PAGE);
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canEditPayerMaster(gate.role)) {
    return NextResponse.json({ success: false, error: 'Only billing or practice leadership can change insurance panels' }, { status: 403 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action === 'import_legacy') {
      const imported = await importLegacyPanels(gate.organizationId, gate.userId);
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'PayerPanel', metadata: { change: 'legacy_panels_imported', imported } });
      return NextResponse.json({ success: true, imported, panels: await listPanels(gate.organizationId) });
    }
    const result = await createPanel(gate.organizationId, gate.userId, body?.panel ?? body);
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'PayerPanel', resourceId: result.row.id,
      metadata: { change: 'panel_created', fields: result.fields },
    });
    return NextResponse.json({ success: true, id: result.row.id, panels: await listPanels(gate.organizationId) });
  } catch (error) {
    return panelFail(error, 'Could not save the panel');
  }
}
