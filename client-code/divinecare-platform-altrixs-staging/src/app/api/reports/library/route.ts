import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { REPORT_CATEGORIES, DATE_PRESETS } from '@/lib/reports/library/types';
import { canOpenLibrary, libraryFor, reportOptions } from '@/lib/reports/library/server';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';

export const runtime = 'nodejs';

/**
 * GET /api/reports/library: the reports this role may run (metadata only), links to the richer
 * report pages it may open, and the parameter options (sites, providers, payers). No PHI.
 */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canOpenLibrary(gate.role, gate.capabilities)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const [options, timeZone] = await Promise.all([reportOptions(gate.organizationId), getPracticeTimeZone(gate.organizationId)]);
    return NextResponse.json(
      { success: true, categories: REPORT_CATEGORIES, presets: DATE_PRESETS, timeZone, options, ...libraryFor(gate.role, gate.capabilities) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[reports/library GET]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load the report library' }, { status: 500 });
  }
}
