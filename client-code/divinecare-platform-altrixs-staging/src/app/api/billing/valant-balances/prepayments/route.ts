import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { requireValantBalancesGate } from '@/lib/billing/valantGate';
import { latestPrepaymentPeriod } from '@/lib/billing/valantBalances';
import { nameKey, prepaymentStanding } from '@/lib/migration/valantPrepayments';
import { isoDate } from '@/lib/migration/valantReportCommon';

export const runtime = 'nodejs';

const txnOut = (t: {
  id: string; type: string; kind: string; date: Date; amountCents: number; reference: string | null;
  appliedTo: string | null; secondaryDate: Date | null; matchMethod: string | null;
}) => ({
  id: t.id, type: t.type, kind: t.kind, date: isoDate(t.date), amountCents: t.amountCents, reference: t.reference,
  appliedTo: t.appliedTo, secondaryDate: isoDate(t.secondaryDate), matchMethod: t.matchMethod,
});

/**
 * GET /api/billing/valant-balances/prepayments — remaining prepayment per patient (reference only),
 * plus the Unmatched queue grouped by the name Valant printed.
 * ?clientId=... returns that patient's transactions (drill-down).
 */
export async function GET(req: Request) {
  const g = await requireValantBalancesGate();
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const orgId = gate.organizationId;
    const period = await latestPrepaymentPeriod(orgId);
    const clientId = new URL(req.url).searchParams.get('clientId');
    if (clientId) {
      const txns = await prisma.valantPrepaymentTxn.findMany({
        where: { organizationId: orgId, clientId },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'valantPrepaymentTxn', patientId: clientId,
        metadata: { view: 'prepayment_detail', count: txns.length },
      });
      const net = txns.reduce((s, t) => s + t.amountCents, 0);
      return NextResponse.json({ success: true, period, clientId, transactions: txns.map(txnOut), ...prepaymentStanding(net, period?.periodStart ?? null) });
    }

    const txns = await prisma.valantPrepaymentTxn.findMany({
      where: { organizationId: orgId },
      include: { client: { select: { id: true, name: true, mrn: true } } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    type ClientRow = { clientId: string; clientName: string; mrn: string | null; transactions: number; receivedCents: number; appliedCents: number; netCents: number };
    const clients = new Map<string, ClientRow>();
    type Group = { key: string; valantName: string; reason: string | null; transactions: number; netCents: number; txns: ReturnType<typeof txnOut>[] };
    const unmatched = new Map<string, Group>();
    let sumCents = 0;
    for (const t of txns) {
      sumCents += t.amountCents;
      if (t.clientId && t.client) {
        const c = clients.get(t.clientId) ?? {
          clientId: t.clientId, clientName: t.client.name, mrn: t.client.mrn, transactions: 0, receivedCents: 0, appliedCents: 0, netCents: 0,
        };
        c.transactions += 1;
        if (t.amountCents >= 0) c.receivedCents += t.amountCents;
        else c.appliedCents += t.amountCents;
        c.netCents += t.amountCents;
        clients.set(t.clientId, c);
      } else {
        const key = nameKey(t.valantName);
        const grp = unmatched.get(key) ?? { key, valantName: t.valantName, reason: t.unmatchedReason, transactions: 0, netCents: 0, txns: [] };
        grp.transactions += 1;
        grp.netCents += t.amountCents;
        grp.txns.push(txnOut(t));
        unmatched.set(key, grp);
      }
    }
    const start = period?.periodStart ?? null;
    const clientRows = [...clients.values()]
      .map((c) => ({ ...c, ...prepaymentStanding(c.netCents, start) }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName));
    const imp = await prisma.valantReferenceImport.findFirst({
      where: { organizationId: orgId, reportType: 'prepayments' },
      orderBy: { importedAt: 'desc' },
      select: { totalsJson: true, reconciles: true },
    });
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'valantPrepaymentTxn',
      metadata: { view: 'prepayments', clients: clientRows.length, unmatchedGroups: unmatched.size, transactions: txns.length, clientIds: clientRows.map((c) => c.clientId).slice(0, 50) },
    });
    return NextResponse.json({
      success: true,
      period,
      clients: clientRows,
      unmatched: [...unmatched.values()].sort((a, b) => a.valantName.localeCompare(b.valantName)),
      totals: { transactions: txns.length, sumCents, report: imp?.totalsJson ?? null, reconciles: imp?.reconciles ?? null },
    });
  } catch (err) {
    console.error('[valant-balances prepayments GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load prepayments' }, { status: 500 });
  }
}
