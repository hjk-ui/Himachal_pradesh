import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/requireSession';
import { loadIcd10CodeSet } from '@/lib/icd10/codeSet';
import { searchIcd10, type Icd10Context } from '@/lib/icd10/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/icd10/search?q=&limit=20&billableOnly=1&context=bh|primary|any
 * Ranked ICD-10-CM search over the official CDC/NCHS FY2027 code set (in-memory index).
 * Code with or without dot ("f33", "F33.1"), or words in any order ("major depress recurrent").
 * Any signed-in staff user; reference data only (no PHI), so it is not audited.
 */
export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') || '').trim();
  if (q.length > 120) return NextResponse.json({ success: false, error: 'q is too long' }, { status: 400 });
  const limit = Math.min(Math.max(Number.parseInt(sp.get('limit') || '20', 10) || 20, 1), 50);
  const billableOnly = sp.get('billableOnly') === '1' || sp.get('billableOnly') === 'true';
  const ctxRaw = sp.get('context');
  const context: Icd10Context = ctxRaw === 'bh' || ctxRaw === 'primary' ? ctxRaw : 'any';

  try {
    const set = loadIcd10CodeSet();
    const results = searchIcd10(set.index, q, { limit, billableOnly, context }).map(({ score: _s, ...hit }) => {
      void _s;
      return hit;
    });
    return NextResponse.json(
      { success: true, fiscalYear: set.meta.fiscalYear, codeSet: set.meta.label, results },
      { headers: { 'Cache-Control': 'private, max-age=300' } }
    );
  } catch (err) {
    console.error('[icd10/search]', err);
    return NextResponse.json({ success: false, error: 'ICD-10 search is unavailable' }, { status: 503 });
  }
}
