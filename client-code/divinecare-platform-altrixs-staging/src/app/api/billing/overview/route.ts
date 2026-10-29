import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { getBillingOverview } from '@/lib/billing/overview';
import {
  canViewBillingOverview,
  OVERVIEW_CSV_TABLES,
  overviewCsv,
  parseOverviewRange,
  type OverviewCsvTable,
} from '@/lib/billing/overviewValant';

export const runtime = 'nodejs';

/**
 * GET /api/billing/overview?preset=mtd|90d | ?from&to [&facility] [&format=csv&table=trend|payers|cpt]
 * Billing overview: Valant (imported) and Altrixs (live) aggregates, organization scoped, counts and
 * sums only (no patient-level rows). Same roles as the /dashboard/billing page.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canViewBillingOverview(gate.role)) {
    return NextResponse.json({ success: false, error: 'Billing access required' }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const parsed = parseOverviewRange(sp, new Date());
  if ('error' in parsed) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  const facility = (sp.get('facility') ?? '').trim().slice(0, 200) || null;
  const csv = sp.get('format') === 'csv';
  const tableRaw = (sp.get('table') ?? '').trim();
  if (csv && !(OVERVIEW_CSV_TABLES as readonly string[]).includes(tableRaw)) {
    return NextResponse.json({ success: false, error: 'table must be trend, payers or cpt' }, { status: 400 });
  }

  try {
    const overview = await getBillingOverview(gate.organizationId, parsed.range, { facility });
    await auditPhiAccess({
      gate,
      req,
      action: csv ? 'EXPORT' : 'READ',
      resourceType: 'billingOverview',
      metadata: {
        view: 'billing_overview',
        format: csv ? 'csv' : 'json',
        table: csv ? tableRaw : null,
        from: parsed.range.fromDate,
        to: parsed.range.toDate,
        facilityFilter: Boolean(facility),
        valantRowsInScope: overview.valant.rowsInScope,
        valantChargeLines: overview.valant.kpis.chargeCount,
        altrixsClaims: overview.altrixs.claims.total,
      },
    });

    if (csv) {
      const table = tableRaw as OverviewCsvTable;
      const body = overviewCsv(
        table,
        { trend: overview.valant.trend, payerMix: overview.valant.payerMix, cpt: overview.valant.cpt },
        {
          title: `Billing overview — ${table === 'trend' ? 'monthly trend' : table === 'payers' ? 'payer mix' : 'CPT usage'}`,
          source: `Valant (imported${overview.valant.asOf.importedAt ? `, as of ${overview.valant.asOf.importedAt.slice(0, 10)}` : ''})${facility ? `, facility ${facility}` : ''}`,
          fromDate: parsed.range.fromDate,
          toDate: parsed.range.toDate,
        }
      );
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="billing-overview-${table}-${parsed.range.fromDate}-to-${parsed.range.toDate}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.json({ success: true, overview });
  } catch (err) {
    console.error('[billing overview]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Failed to load billing overview' }, { status: 500 });
  }
}
