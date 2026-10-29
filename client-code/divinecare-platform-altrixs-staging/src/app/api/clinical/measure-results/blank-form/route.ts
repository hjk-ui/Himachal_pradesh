import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { measureGate } from '@/lib/measures/http';
import { BLANK_PRINT_TEXT, blankPrintCheck } from '@/lib/measures/guide';
import { buildBlankForm } from '@/lib/measures/printView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/clinical/measure-results/blank-form?instrumentId= — a blank form to print (Measure guide >
 * Print blank form). Only free-to-reproduce instruments with their items in the catalog; licensed or
 * permission-only forms are refused (403). No client data. Audited MEASURE_BLANK_PRINT.
 */
export async function GET(req: Request) {
  const instrumentId = new URL(req.url).searchParams.get('instrumentId') ?? '';
  const g = await measureGate();
  if (g.ok === false) return g.response;
  const check = blankPrintCheck(instrumentId);
  if (check.ok === false) {
    return NextResponse.json({ success: false, error: BLANK_PRINT_TEXT[check.reason] }, { status: check.reason === 'unknown' ? 404 : 403 });
  }
  const form = buildBlankForm(instrumentId)!;
  await auditPhiAccess({ gate: g.scope, req, action: 'MEASURE_BLANK_PRINT', resourceType: 'measureForm', resourceId: instrumentId, metadata: { instrumentId } });
  return NextResponse.json({ success: true, form });
}
