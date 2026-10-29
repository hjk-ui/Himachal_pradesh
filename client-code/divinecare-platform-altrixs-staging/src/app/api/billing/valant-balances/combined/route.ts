import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { asOfParam, requireValantBalancesGate } from '@/lib/billing/valantGate';
import { getAgingLabels, importTotals, presentRow, sumPresented, type PresentedBuckets } from '@/lib/billing/valantBalances';
import { isoDate } from '@/lib/migration/valantReportCommon';

export const runtime = 'nodejs';

/** GET /api/billing/valant-balances/combined?asOf=YYYY-MM-DD — Combined Aging by patient with responsible-party lines */
export async function GET(req: Request) {
  const g = await requireValantBalancesGate();
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const orgId = gate.organizationId;
    const asOf =
      asOfParam(req) ??
      (await prisma.valantCombinedAgingRow.findFirst({ where: { organizationId: orgId }, orderBy: { asOf: 'desc' }, select: { asOf: true } }))?.asOf ??
      null;
    if (!asOf) return NextResponse.json({ success: true, asOf: null, patients: [], report: null });
    const [lines, settings] = await Promise.all([
      prisma.valantCombinedAgingRow.findMany({
        where: { organizationId: orgId, asOf },
        include: { client: { select: { id: true, name: true, mrn: true } } },
        orderBy: [{ valantPatientId: 'asc' }, { rowIndex: 'asc' }],
      }),
      getAgingLabels(orgId),
    ]);
    const over120 = settings.displayAllOver120;
    type Party = { party: string; payerName: string | null; lastBilledAt: string | null } & PresentedBuckets;
    type Patient = { valantPatientId: string; clientId: string | null; clientName: string | null; mrn: string | null; parties: Party[] };
    const byPatient = new Map<string, Patient>();
    for (const l of lines) {
      const p = byPatient.get(l.valantPatientId) ?? {
        valantPatientId: l.valantPatientId, clientId: l.clientId, clientName: l.client?.name ?? null, mrn: l.client?.mrn ?? null, parties: [],
      };
      p.parties.push({ party: l.party, payerName: l.payerName, lastBilledAt: isoDate(l.lastBilledAt), ...presentRow(l, over120) });
      byPatient.set(l.valantPatientId, p);
    }
    // Patient line = sum of its responsible-party lines (shown and original buckets)
    const patients = [...byPatient.values()]
      .map((p) => ({ ...p, ...sumPresented(p.parties, over120) }))
      .sort((a, b) => b.totalCents - a.totalCents);
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'valantCombinedAgingRow',
      metadata: { view: 'combined_aging', asOf: isoDate(asOf), patients: patients.length, lines: lines.length, clientIds: patients.map((p) => p.clientId).filter(Boolean).slice(0, 50) },
    });
    return NextResponse.json({ success: true, asOf: isoDate(asOf), displayAllOver120: over120, patients, report: await importTotals(orgId, 'combined_aging', asOf) });
  } catch (err) {
    console.error('[valant-balances combined GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load the combined aging snapshot' }, { status: 500 });
  }
}
