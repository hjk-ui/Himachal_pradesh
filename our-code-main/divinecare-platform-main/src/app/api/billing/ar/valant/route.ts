import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPayerBilling } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { isMissingSchema } from '@/lib/billing/patientReference';

export const runtime = 'nodejs';

const bucketField = ['bucket1Cents', 'bucket2Cents', 'bucket3Cents', 'bucket4Cents', 'bucket5Cents'] as const;

function latest<T extends { asOf: Date }>(rows: T[]) {
  if (!rows.length) return [];
  const max = Math.max(...rows.map((row) => row.asOf.getTime()));
  return rows.filter((row) => row.asOf.getTime() === max);
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPayerBilling(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const payer = (url.searchParams.get('payer') || '').trim().toLowerCase();
  const bucketRaw = url.searchParams.get('bucket');
  const bucket = bucketRaw == null || bucketRaw === '' ? null : Number(bucketRaw);
  const minDollars = Number(url.searchParams.get('min') || '0');
  const minCents = Number.isFinite(minDollars) ? Math.round(minDollars * 100) : 0;
  const party = (url.searchParams.get('party') || '').trim().toLowerCase();
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const unmatched = url.searchParams.get('unmatched') === '1';
  const sort = url.searchParams.get('sort') || 'oldest';
  const page = Math.max(0, Number(url.searchParams.get('page') || '0') || 0);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize') || '50') || 50));

  try {
    const [insuranceAll, patientAll, combinedAll, settings] = await Promise.all([
      prisma.valantInsuranceAgingSnapshot.findMany({ where: { organizationId: gate.organizationId } }),
      prisma.valantAgingSnapshot.findMany({ where: { organizationId: gate.organizationId } }),
      prisma.valantCombinedAgingRow.findMany({
        where: { organizationId: gate.organizationId },
        include: { client: { select: { name: true, mrn: true } } },
      }),
      prisma.valantAgingSettings.findUnique({ where: { organizationId: gate.organizationId } }),
    ]);
    const insurance = latest(insuranceAll);
    const patients = latest(patientAll);
    let combined = latest(combinedAll);
    if (payer) combined = combined.filter((row) => (row.payerName || '').toLowerCase().includes(payer));
    if (party === 'primary' || party === 'secondary' || party === 'other') {
      combined = combined.filter((row) => (row.party || '').toLowerCase() === party);
    }
    if (unmatched) combined = combined.filter((row) => !row.clientId);
    if (q) {
      combined = combined.filter((row) => {
        const hay = `${row.client?.name || ''} ${row.client?.mrn || ''} ${row.payerName || ''} ${row.valantPatientId || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (bucket != null && bucket >= 0 && bucket <= 4) {
      const field = bucketField[bucket];
      combined = combined.filter((row) => row[field] > 0);
    }
    if (minCents > 0) combined = combined.filter((row) => row.totalCents >= minCents);
    combined.sort((a, b) => {
      if (sort === 'amount') return b.totalCents - a.totalCents;
      if (sort === 'name') return (a.client?.name || '').localeCompare(b.client?.name || '');
      if (sort === 'lastBilled') return (b.lastBilledAt?.getTime() || 0) - (a.lastBilledAt?.getTime() || 0);
      return (a.lastBilledAt?.getTime() || 0) - (b.lastBilledAt?.getTime() || 0);
    });
    const total = combined.length;
    const pageRows = combined.slice(page * pageSize, page * pageSize + pageSize);
    const asOf = insurance[0]?.asOf || patients[0]?.asOf || combinedAll[0]?.asOf || null;
    return NextResponse.json({
      success: true,
      asOf,
      settings: {
        labels: settings?.labels ?? null,
        confirmed: settings?.confirmed ?? false,
        displayAllOver120: settings?.displayAllOver120 ?? true,
      },
      insurance,
      patients,
      combined: { total, page, pageSize, rows: pageRows },
    });
  } catch (err) {
    if (!isMissingSchema(err)) {
      console.error('[ar valant]', err);
      return NextResponse.json({ success: false, error: 'Could not load Valant A/R' }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      asOf: null,
      settings: { labels: null, confirmed: false, displayAllOver120: true },
      insurance: [],
      patients: [],
      combined: { total: 0, page, pageSize, rows: [] },
    });
  }
}
