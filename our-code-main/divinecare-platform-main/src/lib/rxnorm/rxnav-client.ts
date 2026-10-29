/**
 * NLM RxNav client — product TTYs for DrFirst cert (SCD/SBD/GPCK/BPCK).
 * No API key required for public RxNav.
 */

export const PRODUCT_TTYS = new Set(['SCD', 'SBD', 'GPCK', 'BPCK']);
export const MAX_NDCS = 10;

export type RxNormSearchHit = {
  rxcui: string;
  name: string;
  tty: string;
  ndcs: string[];
};

export type RxNormAllergyHit = {
  rxcui: string;
  name: string;
  tty: string;
};

type ApproxGroup = {
  candidate?: Array<{ rxcui?: string; rank?: string }>;
};

async function rxnavGet<T>(path: string): Promise<T | null> {
  const base = (process.env.RXNAV_BASE_URL || 'https://rxnav.nlm.nih.gov/REST').replace(/\/$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${base}${path}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function properties(rxcui: string): Promise<{ name: string; tty: string } | null> {
  const data = await rxnavGet<{
    properties?: { name?: string; tty?: string };
  }>(`/rxcui/${encodeURIComponent(rxcui)}/properties.json`);
  const name = data?.properties?.name?.trim();
  const tty = data?.properties?.tty?.trim().toUpperCase() || '';
  if (!name) return null;
  return { name, tty };
}

async function ndcsFor(rxcui: string): Promise<string[]> {
  const data = await rxnavGet<{ ndcGroup?: { ndcList?: { ndc?: string[] } } }>(
    `/rxcui/${encodeURIComponent(rxcui)}/ndcs.json`
  );
  const list = data?.ndcGroup?.ndcList?.ndc || [];
  return list.filter((n) => typeof n === 'string' && n.trim()).slice(0, MAX_NDCS);
}

/** Search products for prescribing (SCD/SBD/GPCK/BPCK only). */
export async function searchRxNormProducts(query: string, limit = 15): Promise<RxNormSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const approx = await rxnavGet<{ approximateGroup?: ApproxGroup }>(
    `/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=${Math.min(40, limit * 3)}`
  );
  const candidates = approx?.approximateGroup?.candidate || [];
  const hits: RxNormSearchHit[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    const rxcui = c.rxcui?.trim();
    if (!rxcui || seen.has(rxcui)) continue;
    const props = await properties(rxcui);
    if (!props || !PRODUCT_TTYS.has(props.tty)) continue;
    seen.add(rxcui);
    const ndcs = await ndcsFor(rxcui);
    hits.push({ rxcui, name: props.name, tty: props.tty, ndcs });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Allergy ingredients — prefer IN / PIN / MIN TTYs. */
export async function searchRxNormAllergyIngredients(
  query: string,
  limit = 15
): Promise<RxNormAllergyHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const approx = await rxnavGet<{ approximateGroup?: ApproxGroup }>(
    `/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=${Math.min(40, limit * 3)}`
  );
  const candidates = approx?.approximateGroup?.candidate || [];
  const hits: RxNormAllergyHit[] = [];
  const seen = new Set<string>();
  const allergyTtys = new Set(['IN', 'PIN', 'MIN', 'BN']);

  for (const c of candidates) {
    const rxcui = c.rxcui?.trim();
    if (!rxcui || seen.has(rxcui)) continue;
    const props = await properties(rxcui);
    if (!props || !allergyTtys.has(props.tty)) continue;
    seen.add(rxcui);
    hits.push({ rxcui, name: props.name, tty: props.tty });
    if (hits.length >= limit) break;
  }
  return hits;
}
