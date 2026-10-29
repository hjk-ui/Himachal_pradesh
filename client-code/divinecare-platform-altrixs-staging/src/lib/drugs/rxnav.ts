/**
 * NLM RxNav REST client (https://rxnav.nlm.nih.gov/REST/): RxNorm drug lookup for medication and
 * drug-allergy codification (DrFirst AUM2 / AUM3 / AUR1, MUM2 / MUM3 / MUM4 / MUR1).
 *
 * - Free, no key; RxNorm is rebuilt monthly (version.json), so codes meet AUM3 / MUM3.
 * - No PHI leaves Altrixs: requests carry only the drug name typed or an RxCUI.
 * - Every response is cached (in-memory LRU with TTL); each call times out after 8 s. Any failure
 *   (timeout, network, HTTP error, unparseable JSON) throws RxNavUnavailableError, which routes turn
 *   into DRUG_LOOKUP_UNAVAILABLE ("enter as free text"). Failures are never cached.
 *
 * Endpoints (shapes verified live Oct 20 2026; samples in tests/fixtures/rxnav):
 *   /drugs.json?name=                       SCD / SBD / GPCK / BPCK concept groups for a name
 *   /approximateTerm.json?term=&option=1    fuzzy candidates (misspellings, partial names)
 *   /rxcui.json?name=&search=2              exact / normalized name match (backfill)
 *   /rxcui/{id}/properties.json             name, TTY
 *   /rxcui/{id}/allProperties.json?prop=attributes   AVAILABLE_STRENGTH, SCHEDULE
 *   /rxcui/{id}/related.json?tty=           SCD+SBD for an ingredient / brand; DF+IN+BN for a product
 *   /rxcui/{id}/ndcs.json                   active NDCs
 *   /version.json                           RxNorm release
 */
import {
  INGREDIENT_TTYS,
  PRODUCT_TTYS,
  isIngredientTty,
  isProductTty,
  type DrugCode,
  type DrugSearchHit,
} from './types';

export const RXNAV_BASE_URL = 'https://rxnav.nlm.nih.gov/REST';
export const RXNAV_TIMEOUT_MS = 8_000;
/** RxNorm changes monthly; a day keeps lookups fast without serving stale data for long. */
export const RXNAV_CACHE_TTL_MS = 24 * 3600 * 1000;
export const RXNAV_CACHE_MAX = 2_000;

export class RxNavUnavailableError extends Error {
  readonly code = 'rxnav_unavailable';
  constructor(readonly reason: string) {
    super(`RxNav unavailable: ${reason}`);
    this.name = 'RxNavUnavailableError';
  }
}

type FetchResponse = { ok: boolean; status: number; json(): Promise<unknown> };
export type RxNavFetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<FetchResponse>;

// ─── Cache ───────────────────────────────────────────────────────────────────

/** Least-recently-used map whose entries expire `ttlMs` after they were stored. */
export class TtlLru<V> {
  private map = new Map<string, { value: V; expires: number }>();
  constructor(private maxEntries: number, private ttlMs: number, private now: () => number = Date.now) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key); // refresh recency
    this.map.set(key, hit);
    return hit.value;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }
  get size() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
}

// ─── Pure parsers (fixture-tested) ───────────────────────────────────────────

export interface RxConcept {
  rxcui: string;
  name: string;
  synonym: string;
  tty: string;
  suppress?: string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function toConcept(raw: unknown): RxConcept | null {
  const c = obj(raw);
  const rxcui = str(c.rxcui).trim();
  const name = str(c.name).trim();
  if (!rxcui || !name) return null;
  return { rxcui, name, synonym: str(c.synonym).trim(), tty: str(c.tty).trim(), suppress: str(c.suppress) || undefined };
}

/** drugs.json (drugGroup) or related.json (relatedGroup) -> concepts; suppressed concepts dropped. */
export function parseConceptGroups(json: unknown): RxConcept[] {
  const root = obj(json);
  const group = obj(root.drugGroup ?? root.relatedGroup ?? root.allRelatedGroup);
  const out: RxConcept[] = [];
  for (const g of arr(group.conceptGroup)) {
    for (const c of arr(obj(g).conceptProperties)) {
      const concept = toConcept(c);
      if (concept && (!concept.suppress || concept.suppress === 'N')) out.push(concept);
    }
  }
  return out;
}

/** approximateTerm.json -> unique RxCUIs of RxNorm-source candidates, best rank first. */
export function parseApproximate(json: unknown): string[] {
  const cands = arr(obj(obj(json).approximateGroup).candidate).map(obj);
  const ranked = cands
    .filter(c => str(c.source) === 'RXNORM' && str(c.rxcui))
    .sort((a, b) => Number(str(a.rank)) - Number(str(b.rank)));
  return [...new Set(ranked.map(c => str(c.rxcui)))];
}

/** rxcui.json -> RxCUIs (empty when no exact / normalized match). */
export function parseIdGroup(json: unknown): string[] {
  return arr(obj(obj(json).idGroup).rxnormId).map(str).filter(Boolean);
}

/** properties.json -> the concept, or null when the RxCUI is unknown ({}). */
export function parseProperties(json: unknown): RxConcept | null {
  return toConcept(obj(json).properties);
}

/** allProperties.json?prop=attributes -> strength and DEA schedule. */
export function parseAttributes(json: unknown): { strength?: string; deaSchedule?: string } {
  const props = arr(obj(obj(json).propConceptGroup).propConcept).map(obj);
  const val = (name: string) => str(props.find(p => str(p.propName) === name)?.propValue).trim() || undefined;
  return { strength: val('AVAILABLE_STRENGTH'), deaSchedule: val('SCHEDULE') };
}

/** related.json?tty=DF+IN+BN concepts -> dose form, ingredient names, brand names. */
export function relatedParts(all: RxConcept[]): { doseForm?: string; ingredients: string[]; brands: string[] } {
  const names = (tty: string) => all.filter(c => c.tty === tty).map(c => c.name);
  return { doseForm: names('DF')[0], ingredients: names('IN'), brands: names('BN') };
}

export const parseRelatedParts = (json: unknown) => relatedParts(parseConceptGroups(json));

/** ndcs.json -> NDC list (11-digit, as RxNav returns them). */
export function parseNdcs(json: unknown): string[] {
  return arr(obj(obj(obj(json).ndcGroup).ndcList).ndc).map(str).filter(s => /^\d{11}$/.test(s));
}

/** version.json -> "05-Oct-2026". */
export function parseVersion(json: unknown): string | undefined {
  return str(obj(json).version).trim() || undefined;
}

/** The label staff pick from: branded drugs read brand-first ("Zoloft 50 MG Oral Tablet"). */
export function displayName(c: RxConcept): string {
  if (c.tty === 'SBD' || c.tty === 'BPCK') {
    const brand = c.name.match(/\[([^\]]+)\]\s*$/)?.[1];
    const syn = c.synonym.replace(/\s*\(as [^)]*\)/gi, '').replace(/\s+/g, ' ').trim();
    if (brand && syn.toLowerCase().startsWith(brand.toLowerCase())) return syn;
    if (brand) return `${brand} (${c.name.replace(/\s*\[[^\]]+\]\s*$/, '')})`;
  }
  return c.name;
}

const toHit = (c: RxConcept): DrugSearchHit => ({ rxcui: c.rxcui, tty: c.tty, name: c.name, display: displayName(c) });

const PRODUCT_SET = new Set<string>(PRODUCT_TTYS);
const INGREDIENT_SET = new Set<string>(INGREDIENT_TTYS);

/** Lower-case words of a query, "50mg" split to "50 mg". */
export function queryTokens(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/(\d)([a-z%])/g, '$1 $2')
    .split(/[^a-z0-9.%/-]+/)
    .filter(Boolean);
}

/** Keep products whose name / display contains every token (used for "sertraline 50", "zoloft tab"). */
export function filterByTokens(hits: DrugSearchHit[], tokens: string[]): DrugSearchHit[] {
  if (!tokens.length) return hits;
  return hits.filter(h => {
    const hay = ` ${queryTokens(`${h.name} ${h.display}`).join(' ')} `;
    return tokens.every(t => hay.includes(` ${t}`));
  });
}

function sortProducts(hits: DrugSearchHit[]): DrugSearchHit[] {
  // Generic (SCD) before branded (SBD), then by name; strengths in numeric order
  const ttyRank = (t: string) => ['SCD', 'SBD', 'GPCK', 'BPCK'].indexOf(t);
  return [...hits].sort((a, b) => ttyRank(a.tty) - ttyRank(b.tty) || a.display.localeCompare(b.display, 'en', { numeric: true }));
}

function dedupe<T extends { rxcui: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(i => (seen.has(i.rxcui) ? false : (seen.add(i.rxcui), true)));
}

// ─── Client ──────────────────────────────────────────────────────────────────

export interface RxNavClientOptions {
  fetch?: RxNavFetch;
  baseUrl?: string;
  timeoutMs?: number;
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export type RxNavClient = ReturnType<typeof createRxNavClient>;

export function createRxNavClient(opts: RxNavClientOptions = {}) {
  const baseUrl = (opts.baseUrl || process.env.RXNAV_BASE_URL || RXNAV_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? RXNAV_TIMEOUT_MS;
  const doFetch: RxNavFetch = opts.fetch || ((url, init) => fetch(url, init));
  const cache = new TtlLru<unknown>(opts.maxEntries ?? RXNAV_CACHE_MAX, opts.ttlMs ?? RXNAV_CACHE_TTL_MS, opts.now);
  const inflight = new Map<string, Promise<unknown>>();
  let calls = 0;

  /** GET one RxNav path (cached). Throws RxNavUnavailableError on any failure. */
  async function getJson(path: string): Promise<unknown> {
    const hit = cache.get(path);
    if (hit !== undefined) return hit;
    const running = inflight.get(path);
    if (running) return running;
    const p = (async () => {
      calls++;
      let res: FetchResponse;
      try {
        res = await doFetch(`${baseUrl}${path}`, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { Accept: 'application/json' },
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : 'error';
        throw new RxNavUnavailableError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
      }
      if (!res.ok) throw new RxNavUnavailableError(`http_${res.status}`);
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new RxNavUnavailableError('bad_json');
      }
      cache.set(path, json);
      return json;
    })();
    inflight.set(path, p);
    try {
      return await p;
    } finally {
      inflight.delete(path);
    }
  }

  const enc = encodeURIComponent;
  const drugs = async (name: string) => parseConceptGroups(await getJson(`/drugs.json?name=${enc(name)}`));
  const approximate = async (term: string, max = 10) =>
    parseApproximate(await getJson(`/approximateTerm.json?term=${enc(term)}&maxEntries=${max}&option=1`));
  const exactIds = async (name: string) => parseIdGroup(await getJson(`/rxcui.json?name=${enc(name)}&search=2`));
  const properties = async (rxcui: string) => parseProperties(await getJson(`/rxcui/${enc(rxcui)}/properties.json`));
  const related = async (rxcui: string, ttys: string[]) =>
    parseConceptGroups(await getJson(`/rxcui/${enc(rxcui)}/related.json?tty=${ttys.join('+')}`));
  const attributes = async (rxcui: string) => parseAttributes(await getJson(`/rxcui/${enc(rxcui)}/allProperties.json?prop=attributes`));
  const ndcs = async (rxcui: string) => parseNdcs(await getJson(`/rxcui/${enc(rxcui)}/ndcs.json`));
  const version = async () => parseVersion(await getJson('/version.json'));

  /** Products (SCD / SBD / packs) reachable from an RxCUI of any term type. */
  async function productsFrom(rxcui: string): Promise<RxConcept[]> {
    const p = await properties(rxcui);
    if (!p) return [];
    if (PRODUCT_SET.has(p.tty)) return [p];
    return (await related(rxcui, ['SCD', 'SBD'])).filter(c => PRODUCT_SET.has(c.tty));
  }

  /**
   * Medication typeahead: specific drugs with strength and form (SCD / SBD), searched by brand or
   * generic name. "sertraline 50" narrows by the extra words; misspellings fall back to approximateTerm.
   */
  async function searchMedications(query: string, limit = 60): Promise<DrugSearchHit[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    let hits = (await drugs(q)).filter(c => PRODUCT_SET.has(c.tty)).map(toHit);
    const tokens = queryTokens(q);
    if (!hits.length && tokens.length > 1) {
      // "zoloft 50 mg": search the name part, keep products carrying the rest
      const nameWords: string[] = [];
      for (const t of tokens) {
        if (/^\d/.test(t)) break;
        nameWords.push(t);
      }
      const base = (nameWords.length ? nameWords : tokens.slice(0, 1)).join(' ');
      const rest = tokens.slice(base.split(' ').length);
      if (base !== q.toLowerCase()) {
        hits = filterByTokens((await drugs(base)).filter(c => PRODUCT_SET.has(c.tty)).map(toHit), rest);
      }
    }
    if (!hits.length) {
      const ids = (await approximate(q, 10)).slice(0, 3);
      const groups = await Promise.all(ids.map(id => productsFrom(id)));
      hits = groups.flat().map(toHit);
    }
    return sortProducts(dedupe(hits)).slice(0, limit);
  }

  /** Brand -> its ingredient (single IN, or the MIN of a combination); null when not one concept. */
  async function brandIngredient(rxcui: string): Promise<RxConcept | null> {
    const parts = await related(rxcui, ['IN', 'MIN']);
    const min = parts.filter(c => c.tty === 'MIN');
    if (min.length === 1) return min[0];
    const ins = parts.filter(c => c.tty === 'IN');
    return ins.length === 1 ? ins[0] : null;
  }

  /**
   * Drug-allergy typeahead: ingredients (IN / PIN / MIN). A brand typed ("Zoloft") resolves to its
   * ingredient and reads "Zoloft (sertraline)".
   */
  async function searchAllergens(query: string, limit = 15): Promise<DrugSearchHit[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const [exact, approx] = await Promise.all([exactIds(q), approximate(q, 20)]);
    const ids = [...new Set([...exact, ...approx])].slice(0, 8);
    const props = (await Promise.all(ids.map(id => properties(id)))).filter((p): p is RxConcept => Boolean(p));
    const out: DrugSearchHit[] = [];
    for (const p of props) {
      if (INGREDIENT_SET.has(p.tty)) out.push(toHit(p));
      else if (p.tty === 'BN') {
        const ing = await brandIngredient(p.rxcui);
        if (ing) out.push({ ...toHit(ing), display: `${p.name} (${ing.name})` });
      }
    }
    return dedupe(out).slice(0, limit);
  }

  /**
   * Full code for one RxCUI: name, TTY, generic / brand, dose form, strength, NDCs, DEA schedule and
   * the RxNorm release. null when RxNav does not know the RxCUI.
   */
  async function getDrugCode(rxcui: string, now: Date = new Date()): Promise<DrugCode | null> {
    if (!/^\d{1,10}$/.test(rxcui)) return null;
    const p = await properties(rxcui);
    if (!p) return null;
    const product = isProductTty(p.tty);
    const [attrs, parts, ndcList, ver] = await Promise.all([
      product ? attributes(rxcui) : Promise.resolve({ strength: undefined, deaSchedule: undefined } as ReturnType<typeof parseAttributes>),
      product || p.tty === 'BN' ? related(rxcui, ['DF', 'IN', 'BN']).then(relatedParts) : Promise.resolve(null),
      product ? ndcs(rxcui) : Promise.resolve([] as string[]),
      version().catch(() => undefined),
    ]);
    const branded = p.tty === 'SBD' || p.tty === 'BPCK' || p.tty === 'BN';
    const brandFromName = p.name.match(/\[([^\]]+)\]\s*$/)?.[1];
    const genericName = isIngredientTty(p.tty) ? p.name : parts?.ingredients.length ? parts.ingredients.join(' / ') : p.name;
    return {
      rxcui: p.rxcui,
      tty: p.tty,
      name: p.name,
      display: displayName(p),
      genericName,
      ...(branded ? { brandName: p.tty === 'BN' ? p.name : brandFromName || parts?.brands[0] } : {}),
      ...(product && parts?.doseForm ? { doseForm: parts.doseForm } : {}),
      ...(product && attrs.strength ? { strength: attrs.strength } : {}),
      ndcs: ndcList,
      ...(attrs.deaSchedule ? { deaSchedule: attrs.deaSchedule } : {}),
      ...(ver ? { version: `RxNorm ${ver}` } : {}),
      lookedUpAt: now.toISOString(),
    };
  }

  return {
    searchMedications,
    searchAllergens,
    getDrugCode,
    /** Low-level lookups used by the backfill matcher */
    drugs,
    exactIds,
    properties,
    approximate,
    brandIngredient,
    stats: () => ({ cached: cache.size, calls }),
    clearCache: () => cache.clear(),
  };
}

/** Process-wide client (shared cache) for API routes and scripts. */
let shared: RxNavClient | null = null;
export function rxnav(): RxNavClient {
  if (!shared) shared = createRxNavClient();
  return shared;
}
