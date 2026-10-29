import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/requireSession';
import { RxNavUnavailableError, rxnav } from '@/lib/drugs/rxnav';
import { DRUG_LOOKUP_UNAVAILABLE } from '@/lib/drugs/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/drugs/search?q=&kind=medication|allergy
 * RxNorm drug typeahead (NLM RxNav, updated monthly):
 *  - medication: specific drugs with strength and form (SCD / SBD) by brand or generic name;
 *  - allergy: drug ingredients (IN / PIN / MIN); a brand resolves to its ingredient.
 * Any signed-in staff user. Only the typed drug name goes to NLM (no patient data), so it is not
 * audited. RxNav down or slow (8 s) -> 503 { unavailable: true } and the form keeps free text.
 */
export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') || '').trim();
  const kind = sp.get('kind') === 'allergy' ? 'allergy' : 'medication';
  if (q.length > 100) return NextResponse.json({ success: false, error: 'q is too long' }, { status: 400 });
  if (q.length < 2) return NextResponse.json({ success: true, results: [] });

  try {
    const results = kind === 'allergy' ? await rxnav().searchAllergens(q) : await rxnav().searchMedications(q);
    return NextResponse.json(
      { success: true, kind, source: 'RxNorm (NLM RxNav)', results },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  } catch (err) {
    if (err instanceof RxNavUnavailableError) {
      console.warn('[drugs/search] RxNav unavailable:', err.reason);
      return NextResponse.json({ success: false, unavailable: true, error: DRUG_LOOKUP_UNAVAILABLE }, { status: 503 });
    }
    console.error('[drugs/search]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, unavailable: true, error: DRUG_LOOKUP_UNAVAILABLE }, { status: 503 });
  }
}
