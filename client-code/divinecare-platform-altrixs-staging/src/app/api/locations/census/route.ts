import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { requireOverviewViewer } from '@/lib/locations/server';
import { CensusInputError, loadPracticeCensus } from '@/lib/locations/censusServer';
import { censusCsv } from '@/lib/locations/census';

export const dynamic = 'force-dynamic';

/**
 * Daily practice census (Practice overview > Census). Same access as GET /api/locations/overview
 * (practice leadership + Office Manager, read only), audited. ?date=YYYY-MM-DD (practice clock, default today) &location=<Location id>
 * &group=facility (rows = Valant facilities) &facility=<facility name>
 * &format=csv for the export (counts only, no client names; audited as an export).
 */
export async function GET(req: Request) {
  const gate = await requireOverviewViewer();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const url = new URL(req.url);
  const csv = url.searchParams.get('format') === 'csv';
  try {
    const census = await loadPracticeCensus(gate.organizationId, {
      date: url.searchParams.get('date'),
      locationId: url.searchParams.get('location'),
      grouping: url.searchParams.get('group') === 'facility' ? 'facility' : 'location',
      facility: url.searchParams.get('facility'),
    });
    await auditPhiAccess({
      gate,
      req,
      action: csv ? 'PRACTICE_CENSUS_EXPORT' : 'PRACTICE_CENSUS_VIEW',
      resourceType: 'PracticeCensus',
      resourceId: gate.organizationId,
      metadata: {
        date: census.date,
        grouping: census.grouping,
        locationId: census.location?.id ?? null,
        booked: census.totals.appointments.counts.booked,
        clientsSeen: census.totals.uniqueClientsSeen,
        format: csv ? 'csv' : 'json',
      },
    });
    if (csv) {
      const name = `practice-census-${census.date}${census.location ? `-${census.location.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}` : ''}.csv`;
      return new NextResponse(censusCsv(census), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${name}"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.json({ success: true, census });
  } catch (err) {
    if (err instanceof CensusInputError) return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    console.error('[api/locations/census] failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not load the practice census' }, { status: 500 });
  }
}
