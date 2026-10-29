/**
 * Drug codification shared types (client-safe: no network, no database).
 *
 * Codes come from the NLM RxNav REST API (RxNorm, rebuilt monthly): DrFirst certification
 * AUM2 / AUM3 / AUR1 (drug allergies) and MUM2 / MUM3 / MUM4 / MUR1 (medications).
 * See src/lib/drugs/rxnav.ts (lookup) and docs/drfirst-certification/README.md.
 */

/** Allergy kinds. DrFirst only requires a drug code for drug allergies (AUM2). */
export const ALLERGEN_TYPES = ['drug', 'food', 'environmental'] as const;
export type AllergenType = (typeof ALLERGEN_TYPES)[number];

export const ALLERGEN_TYPE_LABEL: Record<AllergenType, string> = {
  drug: 'Drug',
  food: 'Food',
  environmental: 'Environmental',
};

/** RxNorm term types a medication is coded to: a specific clinical / branded drug (strength + form). */
export const PRODUCT_TTYS = ['SCD', 'SBD', 'GPCK', 'BPCK'] as const;
/** RxNorm term types a drug allergy is coded to (ingredient level), or a specific product. */
export const ALLERGEN_TTYS = ['IN', 'PIN', 'MIN', ...PRODUCT_TTYS] as const;
export const INGREDIENT_TTYS = ['IN', 'PIN', 'MIN'] as const;

export const isProductTty = (tty?: string | null) => Boolean(tty && (PRODUCT_TTYS as readonly string[]).includes(tty));
export const isIngredientTty = (tty?: string | null) => Boolean(tty && (INGREDIENT_TTYS as readonly string[]).includes(tty));

/** Shown whenever RxNav cannot be reached: the record is saved as free text and coded later. */
export const DRUG_LOOKUP_UNAVAILABLE = 'Drug lookup unavailable — enter as free text';

/** Most NDCs sent per drug to DrFirst (send_medication / send_allergy NDCID list: MUR1 / AUR1). */
export const MAX_NDCS_SENT = 10;

/** One typeahead hit: an RxNorm concept (product for medications, ingredient for allergies). */
export interface DrugSearchHit {
  rxcui: string;
  tty: string;
  /** RxNorm normalized name, e.g. "sertraline 50 MG Oral Tablet [Zoloft]" */
  name: string;
  /** What staff see, e.g. "Zoloft 50 MG Oral Tablet" (brand first for branded drugs) */
  display: string;
}

/** Everything stored on a coded record (resolved server-side from the RxCUI only). */
export interface DrugCode {
  rxcui: string;
  tty: string;
  name: string;
  display: string;
  /** Ingredient name(s), " / "-joined for combinations */
  genericName: string;
  /** Branded drugs (SBD / BPCK / BN) only */
  brandName?: string;
  /** RxNorm dose form, e.g. "Oral Tablet" (products only) */
  doseForm?: string;
  /** RxNorm available strength, e.g. "50 MG" or "325 MG / 7.5 MG" (products only) */
  strength?: string;
  /** Active NDCs for the product (11-digit), empty for ingredients */
  ndcs: string[];
  /** RxNorm DEA schedule attribute ('0' = not controlled) */
  deaSchedule?: string;
  /** RxNorm release, e.g. "RxNorm 05-Oct-2026" (AUM3 / MUM3: monthly-updated database) */
  version?: string;
  /** ISO time of the lookup */
  lookedUpAt: string;
}

/** ClientMedication columns written for a coded medication. */
export function medicationCodeFields(code: DrugCode, now: Date = new Date()) {
  return {
    rxnormId: code.rxcui,
    rxnormTty: code.tty,
    rxnormName: code.name,
    drugName: code.display,
    genericName: code.genericName || null,
    brandName: code.brandName || null,
    doseForm: code.doseForm || null,
    strength: code.strength || null,
    ndcCodes: code.ndcs,
    ndcCode: code.ndcs[0] || null,
    drugCodedAt: now,
    drugCodeVersion: code.version || null,
  };
}

/** MedicalAllergy columns written for a coded drug allergy. */
export function allergyCodeFields(code: DrugCode, now: Date = new Date()) {
  return {
    allergenType: 'drug' as const,
    rxnormId: code.rxcui,
    rxnormTty: code.tty,
    rxnormName: code.name,
    genericName: code.genericName || null,
    brandName: code.brandName || null,
    doseForm: code.doseForm || null,
    strength: code.strength || null,
    ndcCodes: code.ndcs,
    drugCodedAt: now,
    drugCodeVersion: code.version || null,
  };
}

/** EhrPrescription columns written for a coded prescription. */
export function prescriptionCodeFields(code: DrugCode, now: Date = new Date()) {
  const { drugName: _d, ndcCode: _n, ...rest } = medicationCodeFields(code, now);
  void _d;
  void _n;
  return rest;
}

/** A drug allergy still needing a code: active, recorded here, drug or not yet classified, no RxNorm. */
export function allergyNeedsCode(a: {
  allergen: string;
  allergenType?: string | null;
  rxnormId?: string | null;
  status?: string | null;
  source?: string | null;
}): boolean {
  if (a.source === 'drfirst') return false;
  if (/^(inactive|resolved|entered in error|deleted)$/i.test((a.status || '').trim())) return false;
  if (/^(nka|nkda|nkma|no known (drug |medication )?allerg(y|ies)( documented)?)\.?$/i.test(a.allergen.trim())) return false;
  if (a.allergenType && a.allergenType !== 'drug') return false;
  return !a.rxnormId;
}
