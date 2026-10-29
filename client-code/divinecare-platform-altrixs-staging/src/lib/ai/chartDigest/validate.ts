/**
 * Map-step reply parsing and the deterministic citation validator. Pure.
 *
 * A fact is kept only when at least one of its citations survives:
 *  - the cited source exists in this chunk (alias S1.. → source key);
 *  - the quote is 3–20 words, has no ellipsis, and is found verbatim (whitespace, case, quote marks
 *    and dashes normalized) in the cited page — or another page of the same source, in which case
 *    the page is corrected;
 * Uncited facts are dropped. A medication trial also needs its drug name in the cited text, and a
 * dose is kept only when it appears there. A fact date must be the cited source's date or appear in
 * the cited text; otherwise the earliest cited source date is used. Nothing is ever invented.
 */
import type { Citation, DigestItem, MedicationTrial } from '@/lib/ai/chartDigest/types';
import { ITEM_SECTIONS, emptySections, type DigestSections } from '@/lib/ai/chartDigest/types';

export const MAX_QUOTE_WORDS = 20;
export const MIN_QUOTE_WORDS = 3;
export const MAX_TEXT_CHARS = 240;
export const MAX_ITEMS_PER_SECTION_PER_CHUNK = 15;

export type RawCite = { src?: unknown; page?: unknown; quote?: unknown };

export type DropCounts = {
  uncited: number;
  citeUnknownSource: number;
  citeQuoteNotFound: number;
  citeQuoteLength: number;
  drugNotInSource: number;
  doseNotInSource: number;
  empty: number;
};

export function emptyDropCounts(): DropCounts {
  return { uncited: 0, citeUnknownSource: 0, citeQuoteNotFound: 0, citeQuoteLength: 0, drugNotInSource: 0, doseNotInSource: 0, empty: 0 };
}

/** Lower case, unified quotes / dashes, single spaces */
export function normalizeForMatch(s: string): string {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/­/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trim surrounding quote marks / punctuation from a model quote */
function cleanQuote(q: string): string {
  return q.trim().replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '').replace(/\s+/g, ' ');
}

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export type ValidationSource = { key: string; date: string; pages: string[] };

/** Normalized page texts are cached per validation run */
export class SourceIndex {
  private readonly norm = new Map<string, string[]>();
  constructor(private readonly byKey: Map<string, ValidationSource>) {}
  get(key: string): ValidationSource | undefined {
    return this.byKey.get(key);
  }
  pages(key: string): string[] {
    let n = this.norm.get(key);
    if (!n) {
      n = (this.byKey.get(key)?.pages ?? []).map(normalizeForMatch);
      this.norm.set(key, n);
    }
    return n;
  }
  fullText(key: string): string {
    return this.pages(key).join(' ');
  }
}

/** Validate one citation; returns the corrected citation or a drop reason */
export function checkCitation(
  raw: RawCite,
  aliases: Map<string, string>,
  index: SourceIndex
): { ok: true; cite: Citation; reason?: undefined } | { ok: false; reason: 'citeUnknownSource' | 'citeQuoteLength' | 'citeQuoteNotFound'; cite?: undefined } {
  const alias = typeof raw.src === 'string' ? raw.src.trim().toUpperCase() : '';
  const key = aliases.get(alias);
  const src = key ? index.get(key) : undefined;
  if (!key || !src) return { ok: false, reason: 'citeUnknownSource' };
  const quote = typeof raw.quote === 'string' ? cleanQuote(raw.quote) : '';
  const words = wordCount(quote);
  if (words < MIN_QUOTE_WORDS || words > MAX_QUOTE_WORDS || /\.\.\.|…/.test(quote)) return { ok: false, reason: 'citeQuoteLength' };
  const q = normalizeForMatch(quote);
  const pages = index.pages(key);
  const asked = Number.isInteger(raw.page) ? (raw.page as number) : Number.parseInt(String(raw.page ?? ''), 10);
  let page: number | null = null;
  if (asked >= 1 && asked <= pages.length && pages[asked - 1].includes(q)) page = asked;
  else {
    const i = pages.findIndex((p) => p.includes(q));
    if (i >= 0) page = i + 1;
  }
  if (page == null) return { ok: false, reason: 'citeQuoteNotFound' };
  return { ok: true, cite: { source: key, page: pages.length > 1 ? page : null, date: src.date, quote } };
}

const ISO_FULL = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
const YEAR = /^\d{4}$/;

/** Date kept only when it is a cited source date or appears in the cited text */
export function checkDate(raw: unknown, cites: Citation[], index: SourceIndex): string | null {
  const fallback = cites.map((c) => c.date).sort()[0] ?? null;
  const d = typeof raw === 'string' ? raw.trim() : '';
  if (!d) return fallback;
  if (cites.some((c) => c.date === d)) return d;
  const texts = [...new Set(cites.map((c) => c.source))].map((k) => index.fullText(k));
  const found = (needle: string) => texts.some((t) => t.includes(needle));
  if (ISO_FULL.test(d)) {
    const [y, m, day] = d.split('-');
    const forms = [d, `${+m}/${+day}/${y}`, `${m}/${day}/${y}`, `${+m}/${+day}/${y.slice(2)}`, `${m}/${day}/${y.slice(2)}`];
    return forms.some(found) ? d : fallback;
  }
  if (ISO_MONTH.test(d)) {
    const [y, m] = d.split('-');
    return found(d) || found(`${+m}/${y}`) || found(`${m}/${y}`) ? d : fallback;
  }
  if (YEAR.test(d)) return found(d) ? d : fallback;
  return fallback;
}

const clip = (s: unknown, n = MAX_TEXT_CHARS) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** "50mg" / "50 mg" / "50 MG" → same */
export function normalizeDose(s: string): string {
  return normalizeForMatch(s).replace(/(\d)\s+(mg|mcg|g|ml|units?|iu)\b/g, '$1$2');
}

function drugInText(drug: string, texts: string[]): boolean {
  const d = normalizeForMatch(drug).replace(/[^a-z0-9 -]/g, '').trim();
  if (d.length < 3) return false;
  const re = new RegExp(`\\b${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  return texts.some((t) => re.test(t));
}

function citesOf(rawCites: unknown, aliases: Map<string, string>, index: SourceIndex, drops: DropCounts): Citation[] {
  const list = Array.isArray(rawCites) ? (rawCites as RawCite[]) : [];
  const out: Citation[] = [];
  const seen = new Set<string>();
  for (const rc of list.slice(0, 6)) {
    const r = checkCitation(rc && typeof rc === 'object' ? rc : {}, aliases, index);
    if (r.ok === false) {
      drops[r.reason]++;
      continue;
    }
    const k = `${r.cite.source}|${normalizeForMatch(r.cite.quote)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r.cite);
  }
  return out;
}

/** Parse + validate one map reply into digest sections (citations resolved to source keys) */
export function validateMapReply(
  reply: string,
  aliases: Map<string, string>,
  index: SourceIndex,
  part2Keys: Set<string>
): { sections: DigestSections; kept: number; drops: DropCounts } {
  const r = validateReplySections(reply, ITEM_SECTIONS, aliases, index, part2Keys);
  const sections = emptySections();
  for (const s of ITEM_SECTIONS) sections[s] = r.items[s] ?? [];
  sections.medicationTrials = r.medicationTrials;
  return { sections, kept: r.kept, drops: r.drops };
}

/**
 * Section-list-agnostic core (the BH digest and the medical digest share it): each listed item
 * section plus "medicationTrials", every fact validated against its cited source text.
 */
export function validateReplySections<S extends string>(
  reply: string,
  sectionNames: readonly S[],
  aliases: Map<string, string>,
  index: SourceIndex,
  part2Keys: Set<string>
): { items: Record<S, DigestItem[]>; medicationTrials: MedicationTrial[]; kept: number; drops: DropCounts } {
  const drops = emptyDropCounts();
  const items = Object.fromEntries(sectionNames.map((s) => [s, [] as DigestItem[]])) as Record<S, DigestItem[]>;
  const medicationTrials: MedicationTrial[] = [];
  let parsed: Record<string, unknown> = {};
  try {
    const p = JSON.parse(reply);
    if (p && typeof p === 'object' && !Array.isArray(p)) parsed = p as Record<string, unknown>;
  } catch {
    return { items, medicationTrials, kept: 0, drops };
  }
  let kept = 0;
  const isPart2 = (cites: Citation[]) => cites.some((c) => part2Keys.has(c.source));

  for (const section of sectionNames) {
    const list = Array.isArray(parsed[section]) ? (parsed[section] as Array<Record<string, unknown>>) : [];
    for (const raw of list.slice(0, MAX_ITEMS_PER_SECTION_PER_CHUNK)) {
      if (!raw || typeof raw !== 'object') continue;
      const text = clip(raw.text);
      if (!text) {
        drops.empty++;
        continue;
      }
      const cites = citesOf(raw.cites, aliases, index, drops);
      if (!cites.length) {
        drops.uncited++;
        continue;
      }
      const item: DigestItem = { text, date: checkDate(raw.date, cites, index), kind: clip(raw.kind, 40) || null, cites };
      if (isPart2(cites)) item.part2 = true;
      items[section].push(item);
      kept++;
    }
  }

  const meds = Array.isArray(parsed.medicationTrials) ? (parsed.medicationTrials as Array<Record<string, unknown>>) : [];
  for (const raw of meds.slice(0, MAX_ITEMS_PER_SECTION_PER_CHUNK)) {
    if (!raw || typeof raw !== 'object') continue;
    const drug = clip(raw.drug, 80);
    if (!drug) {
      drops.empty++;
      continue;
    }
    const cites = citesOf(raw.cites, aliases, index, drops);
    if (!cites.length) {
      drops.uncited++;
      continue;
    }
    const texts = [...new Set(cites.map((c) => c.source))].map((k) => index.fullText(k));
    if (!drugInText(drug, texts)) {
      drops.drugNotInSource++;
      continue;
    }
    const doseTexts = texts.map(normalizeDose);
    const rawDoses = Array.isArray(raw.doses) ? raw.doses : typeof raw.dose === 'string' ? [raw.dose] : [];
    const doses: string[] = [];
    for (const d of rawDoses.map((x) => clip(x, 40)).filter(Boolean)) {
      if (doseTexts.some((t) => t.includes(normalizeDose(d)))) doses.push(d);
      else drops.doseNotInSource++;
    }
    const trial: MedicationTrial = {
      drug,
      doses,
      start: raw.start ? checkDate(raw.start, cites, index) : null,
      end: raw.end ? checkDate(raw.end, cites, index) : null,
      response: clip(raw.response, 160) || null,
      reasonStopped: clip(raw.reasonStopped, 160) || null,
      sideEffects: (Array.isArray(raw.sideEffects) ? raw.sideEffects : []).map((x) => clip(x, 60)).filter(Boolean).slice(0, 6),
      cites,
    };
    if (isPart2(cites)) trial.part2 = true;
    medicationTrials.push(trial);
    kept++;
  }
  return { items, medicationTrials, kept, drops };
}

export function addDrops(a: DropCounts, b: DropCounts): DropCounts {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof DropCounts)[]) out[k] += b[k];
  return out;
}
