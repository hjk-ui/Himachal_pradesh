import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  MAX_NDCS,
  PRODUCT_TTYS,
  searchRxNormAllergyIngredients,
  searchRxNormProducts,
} from '@/lib/rxnorm/rxnav-client';
import { resolveDrugCode } from '@/lib/prescribing/drugCodes';

export const runtime = 'nodejs';

const CLINICAL_PATHS = [
  '/dashboard/ehr/prescriptions',
  '/dashboard/ehr/notes',
  '/dashboard/medical/visits',
] as const;

function canSearch(role: Parameters<typeof canAccessPath>[0]) {
  return CLINICAL_PATHS.some((p) => canAccessPath(role, p));
}

/**
 * GET /api/drugs/search?q=&mode=product|allergy
 * Product TTYs: SCD/SBD/GPCK/BPCK; NDCs capped at 10.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canSearch(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const mode = (url.searchParams.get('mode') || 'product').toLowerCase();
  if (q.length < 2) {
    return NextResponse.json({ success: true, results: [], fallback: null });
  }

  if (mode === 'allergy') {
    const results = await searchRxNormAllergyIngredients(q);
    const fallback = results.length === 0 ? resolveDrugCode(q) : null;
    return NextResponse.json({
      success: true,
      mode: 'allergy',
      results,
      fallbackRxcui: fallback,
    });
  }

  const results = await searchRxNormProducts(q);
  const filtered = results.filter((r) => PRODUCT_TTYS.has(r.tty)).map((r) => ({
    ...r,
    ndcs: r.ndcs.slice(0, MAX_NDCS),
  }));
  const fallback = filtered.length === 0 ? resolveDrugCode(q) : null;

  return NextResponse.json({
    success: true,
    mode: 'product',
    results: filtered,
    fallbackRxcui: fallback,
    maxNdcs: MAX_NDCS,
  });
}
