/**
 * Backfill matcher: existing free-text medications / allergies -> RxNorm (scripts/codify-meds-allergies.ts).
 *
 * Only an unambiguous exact match is ever applied automatically:
 *  - medication: the recorded RxNorm code itself, an exact normalized RxNorm name, or exactly ONE
 *    single-ingredient product of the recorded drug at the recorded strength (and the recorded form,
 *    when there is one). No strength on the record, several strengths, or several forms at that
 *    strength -> staff review. A strength is never guessed.
 *  - drug allergy: exactly one RxNorm ingredient for the exact (normalized) name, or a brand name
 *    with exactly one ingredient. Anything else -> staff review with suggestions.
 *  - food / environmental allergens (peanut, latex ...) are classified, never coded.
 */
import { doseFormOf, strengthOf } from '@/lib/drfirst/chartMapping';
import { RxNavUnavailableError, type RxConcept, type RxNavClient } from './rxnav';
import { isIngredientTty, isProductTty, type AllergenType, type DrugSearchHit } from './types';

export type MatchResult =
  | { status: 'exact'; rxcui: string; reason: string }
  | { status: 'review'; reason: string; candidates: DrugSearchHit[] }
  | { status: 'no_match'; reason: string; candidates: DrugSearchHit[] }
  | { status: 'non_drug'; allergenType: Exclude<AllergenType, 'drug'>; reason: string }
  | { status: 'skip'; reason: string }
  | { status: 'unavailable'; reason: string };

// ─── Strength / form helpers ─────────────────────────────────────────────────

/** "50 mg" / "50MG" / ".5 mg/mL" / "1,000 units" -> "50mg" / "0.5mg/ml" / "1000unt" */
export function strengthKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/(^|[^\d])\.(\d)/g, (_m, pre: string, d: string) => `${pre}0.${d}`)
    .replace(/units?/g, 'unt')
    .replace(/mcg|µg|ug/g, 'mcg')
    .replace(/actuations?/g, 'actuat')
    .replace(/\/1(?=[a-z])/g, '/');
}

const STRENGTH_IN_NAME = /(\d+(?:\.\d+)?)\s(MG|MCG|UNT|MEQ|ML|%|GM|G|MMOL|BAU|AU|PNU|IR)(?:\/(\d+(?:\.\d+)?\s)?(ML|MG|HR|ACTUAT|GM|G|SQCM))?/g;

/** The single strength in an RxNorm product name ("12 HR ... 150 MG Extended Release ..." -> "150 MG"); null for combinations. */
export function productStrength(name: string): string | null {
  if (name.includes(' / ')) return null;
  const found = [...name.matchAll(STRENGTH_IN_NAME)].map(m => m[0]);
  return found.length === 1 ? found[0] : null;
}

/** Does the product name carry every word of the chart's dose form ("extended-release tablet")? */
export function productHasForm(name: string, form: string): boolean {
  const hay = name.toLowerCase().replace(/-/g, ' ');
  return form
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/s\b/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .every(w => hay.includes(w));
}

const brandOf = (name: string) => name.match(/\[([^\]]+)\]\s*$/)?.[1]?.toLowerCase();
const hit = (c: RxConcept): DrugSearchHit => ({ rxcui: c.rxcui, tty: c.tty, name: c.name, display: c.name });

/** The drug-name part of free text: everything before the first number ("Sertraline 50 mg tablet" -> "sertraline"). */
export function drugNamePart(text: string): string {
  return text
    .split(/\s(?=\d)|\(|,/)[0]
    .replace(/\b(tabs?|tablets?|caps?|capsules?|oral|solution|er|xr|xl|sr|cr|la|dr|ir|odt)\b\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ─── Medications ─────────────────────────────────────────────────────────────

export interface UncodedMedication {
  medicationName: string;
  drugName?: string | null;
  dosage?: string | null;
  brandName?: string | null;
  genericName?: string | null;
  rxnormId?: string | null;
}

async function guarded(fn: () => Promise<MatchResult>): Promise<MatchResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RxNavUnavailableError) return { status: 'unavailable', reason: err.reason };
    throw err;
  }
}

export function matchMedication(m: UncodedMedication, rx: RxNavClient): Promise<MatchResult> {
  return guarded(async () => {
    // A code already on the record (older entry / import) only needs its name, form and strength
    if (m.rxnormId?.trim()) {
      const p = await rx.properties(m.rxnormId.trim());
      if (p && isProductTty(p.tty)) return { status: 'exact', rxcui: p.rxcui, reason: 'RxNorm code already on the record' };
      return { status: 'review', reason: `recorded RxNorm ${m.rxnormId} is not a specific drug (strength + form)`, candidates: [] };
    }
    const text = (m.drugName || m.medicationName || '').trim();
    if (!text) return { status: 'skip', reason: 'no medication name' };

    // 1. The text is already an RxNorm product name ("sertraline 50 MG Oral Tablet")
    const exact = await rx.exactIds(text);
    if (exact.length === 1) {
      const p = await rx.properties(exact[0]);
      if (p && isProductTty(p.tty)) return { status: 'exact', rxcui: p.rxcui, reason: 'exact RxNorm name' };
    }

    // 2. Drug name + recorded strength (+ recorded form)
    const name = drugNamePart(text) || (m.genericName || m.brandName || '').toLowerCase().trim();
    if (!name) return { status: 'no_match', reason: 'no drug name before the strength', candidates: [] };
    const products = (await rx.drugs(name)).filter(c => isProductTty(c.tty) && !c.name.includes(' / '));
    if (!products.length) return { status: 'no_match', reason: `no RxNorm drug named "${name}"`, candidates: [] };

    const isBrand = products.some(c => c.tty === 'SBD' && brandOf(c.name) === name);
    const pool = products.filter(c => (isBrand ? c.tty === 'SBD' && brandOf(c.name) === name : c.tty === 'SCD'));
    const strength = strengthOf(m.dosage, text);
    if (!strength) {
      return { status: 'review', reason: 'no strength on the record (never guessed)', candidates: pool.slice(0, 12).map(hit) };
    }
    const key = strengthKey(strength);
    const atStrength = pool.filter(c => {
      const s = productStrength(c.name);
      return s !== null && strengthKey(s) === key;
    });
    if (!atStrength.length) {
      return { status: 'review', reason: `no ${isBrand ? 'branded' : 'generic'} ${name} product at ${strength}`, candidates: pool.slice(0, 12).map(hit) };
    }
    const form = doseFormOf(text, m.dosage);
    const matches = form ? atStrength.filter(c => productHasForm(c.name, form)) : atStrength;
    if (matches.length === 1) {
      return { status: 'exact', rxcui: matches[0].rxcui, reason: form ? `only product at ${strength} ${form}` : `only product at ${strength}` };
    }
    return {
      status: 'review',
      reason: matches.length ? `${matches.length} products at ${strength}${form ? ` ${form}` : ''} (form / release not clear)` : `no ${strength} product as ${form}`,
      candidates: (matches.length ? matches : atStrength).map(hit),
    };
  });
}

// ─── Allergies ───────────────────────────────────────────────────────────────

const FOOD = /^(peanuts?|tree ?nuts?|nuts?|almonds?|cashews?|walnuts?|pecans?|shellfish|shrimp|crab|lobster|fish|eggs?|egg whites?|milk|dairy|lactose|cow'?s milk|wheat|gluten|soy|soya|sesame|strawberr(y|ies)|tomato(es)?|chocolate|corn|citrus|kiwi|banana|avocado|mushrooms?|food dyes?|red dye)( allerg(y|ies))?$/i;
const ENVIRONMENTAL = /^(latex|natural rubber latex|pollens?|seasonal|hay fever|dust|dust mites?|mold|mould|grass|ragweed|trees?|cats?|dogs?|pet dander|dander|animal dander|bees?|bee stings?|wasps?|insect stings?|hornets?|fire ants?|nickel|adhesives?|tape|adhesive tape|perfumes?|fragrances?|smoke|cockroach(es)?)( allerg(y|ies))?$/i;

export function classifyNonDrug(allergen: string): Exclude<AllergenType, 'drug'> | null {
  const t = allergen.trim().replace(/\s+/g, ' ');
  if (FOOD.test(t)) return 'food';
  if (ENVIRONMENTAL.test(t)) return 'environmental';
  return null;
}

export interface UncodedAllergy {
  allergen: string;
  allergenType?: string | null;
}

const NKA = /^(nka|nkda|nkma|no known (drug |medication )?allerg(y|ies)( documented)?)\.?$/i;

export function matchAllergy(a: UncodedAllergy, rx: RxNavClient): Promise<MatchResult> {
  return guarded(async () => {
    const text = a.allergen.trim();
    if (!text) return { status: 'skip', reason: 'no allergen' };
    if (NKA.test(text)) return { status: 'skip', reason: 'no known allergies entry' };
    if (a.allergenType && a.allergenType !== 'drug') return { status: 'skip', reason: `${a.allergenType} allergy (no drug code needed)` };
    if (!a.allergenType) {
      const nonDrug = classifyNonDrug(text);
      if (nonDrug) return { status: 'non_drug', allergenType: nonDrug, reason: `"${text}" classified as ${nonDrug}` };
    }
    const ids = await rx.exactIds(text);
    if (ids.length === 1) {
      const p = await rx.properties(ids[0]);
      if (p && isIngredientTty(p.tty)) return { status: 'exact', rxcui: p.rxcui, reason: 'exact RxNorm ingredient' };
      if (p && p.tty === 'BN') {
        const ing = await rx.brandIngredient(p.rxcui);
        if (ing) return { status: 'exact', rxcui: ing.rxcui, reason: `brand ${p.name} -> ${ing.name}` };
      }
    }
    const candidates = await rx.searchAllergens(text, 6);
    return candidates.length
      ? { status: 'review', reason: ids.length > 1 ? 'several RxNorm concepts for this name' : 'no exact RxNorm ingredient', candidates }
      : { status: 'no_match', reason: 'not found in RxNorm', candidates: [] };
  });
}
