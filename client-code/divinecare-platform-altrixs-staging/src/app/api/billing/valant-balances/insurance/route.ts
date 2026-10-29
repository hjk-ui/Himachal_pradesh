import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { asOfParam, requireValantBalancesGate } from '@/lib/billing/valantGate';
import { getAgingLabels, importTotals, presentRow } from '@/lib/billing/valantBalances';
import { isoDate } from '@/lib/migration/valantReportCommon';

export const runtime = 'nodejs';

/**
 * GET /api/billing/valant-balances/insurance?asOf=YYYY-MM-DD — payer A/R from the Valant Insurance
 * Aging Summary (reference only, no patient data). Payer names that exactly match a Waystar payer
 * mapping (name or alias) show its payer ID, for display only.
 */
export async function GET(req: Request) {
  const g = await requireValantBalancesGate();
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const orgId = gate.organizationId;
    const asOf =
      asOfParam(req) ??
      (await prisma.valantInsuranceAgingSnapshot.findFirst({ where: { organizationId: orgId }, orderBy: { asOf: 'desc' }, select: { asOf: true } }))?.asOf ??
      null;
    if (!asOf) return NextResponse.json({ success: true, asOf: null, rows: [], report: null });
    const [snaps, mappings, settings] = await Promise.all([
      prisma.valantInsuranceAgingSnapshot.findMany({ where: { organizationId: orgId, asOf }, orderBy: { rowIndex: 'asc' } }),
      prisma.waystarPayerMapping.findMany({
        where: { organizationId: { in: [orgId, '*'] }, active: true },
        select: { payerName: true, aliases: true, waystarPayerId: true, verified: true, organizationId: true },
      }),
      getAgingLabels(orgId),
    ]);
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    const mapByName = new Map<string, { waystarPayerId: string; verified: boolean }>();
    // Org mappings win over the global ('*') ones
    const globalFirst = (m: { organizationId: string }) => (m.organizationId === '*' ? 0 : 1);
    for (const m of [...mappings].sort((a, b) => globalFirst(a) - globalFirst(b))) {
      for (const n of [m.payerName, ...m.aliases]) mapByName.set(norm(n), { waystarPayerId: m.waystarPayerId, verified: m.verified });
    }
    const rows = snaps.map((s) => ({
      id: s.id,
      rowIndex: s.rowIndex,
      payerName: s.payerName,
      ...presentRow(s, settings.displayAllOver120),
      bucketsMatchTotal: s.bucketsMatchTotal,
      waystar: mapByName.get(norm(s.payerName)) ?? null,
    }));
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'valantInsuranceAgingSnapshot',
      metadata: { view: 'insurance_aging', asOf: isoDate(asOf), count: rows.length },
    });
    return NextResponse.json({ success: true, asOf: isoDate(asOf), displayAllOver120: settings.displayAllOver120, rows, report: await importTotals(orgId, 'insurance_aging', asOf) });
  } catch (err) {
    console.error('[valant-balances insurance GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load the insurance aging snapshot' }, { status: 500 });
  }
}
