import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/requireSession';
import { checkIcd10Code } from '@/lib/icd10/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/icd10/lookup?codes=F33.1,F331,Z99.999 — description, billable flag and status
 * (ok | not_billable | deleted | unknown | malformed) of up to 50 codes against the FY2027 set.
 * Lets pickers fill descriptions for prefilled codes and flag stored codes not in the code set.
 * Any signed-in staff user; reference data only.
 */
export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const codes = (req.nextUrl.searchParams.get('codes') || '')
    .split(/[,;\s]+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 50);
  const requireBillable = req.nextUrl.searchParams.get('billableOnly') === '1';
  const results = codes.map((c) => checkIcd10Code(c, { requireBillable }));
  return NextResponse.json({ success: true, results }, { headers: { 'Cache-Control': 'private, max-age=300' } });
}
