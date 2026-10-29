import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { asOfParam, requireValantBalancesGate } from '@/lib/billing/valantGate';
import { getAgingLabels, importTotals, presentRow } from '@/lib/billing/valantBalances';
import { isoDate } from '@/lib/migration/valantReportCommon';

export const runtime = 'nodejs';

/** GET /api/billing/valant-balances/aging?asOf=YYYY-MM-DD — patient aging snapshot (reference only) */
export async function GET(req: Request) {
  const g = await requireValantBalancesGate();
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const orgId = gate.organizationId;
    const asOf =
      asOfParam(req) ??
      (await prisma.valantAgingSnapshot.findFirst({ where: { organizationId: orgId }, orderBy: { asOf: 'desc' }, select: { asOf: true } }))?.asOf ??
      null;
    if (!asOf) return NextResponse.json({ success: true, asOf: null, rows: [], report: null });
    const [snaps, settings] = await Promise.all([
      prisma.valantAgingSnapshot.findMany({
        where: { organizationId: orgId, asOf },
        include: { client: { select: { id: true, name: true, mrn: true } } },
        orderBy: { totalCents: 'desc' },
      }),
      getAgingLabels(orgId),
    ]);
    const rows = snaps.map((s) => ({
      id: s.id,
      clientId: s.clientId,
      clientName: s.client?.name ?? null,
      mrn: s.client?.mrn ?? null,
      valantPatientId: s.valantPatientId,
      ...presentRow(s, settings.displayAllOver120),
      bucketsMatchTotal: s.bucketsMatchTotal,
    }));
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'valantAgingSnapshot',
      metadata: { view: 'patient_aging', asOf: isoDate(asOf), count: rows.length, clientIds: rows.map((r) => r.clientId).filter(Boolean).slice(0, 50) },
    });
    return NextResponse.json({ success: true, asOf: isoDate(asOf), displayAllOver120: settings.displayAllOver120, rows, report: await importTotals(orgId, 'patient_aging', asOf) });
  } catch (err) {
    console.error('[valant-balances aging GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load the aging snapshot' }, { status: 500 });
  }
}
