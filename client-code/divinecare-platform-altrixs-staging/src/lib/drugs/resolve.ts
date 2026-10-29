/**
 * Server-side: turn an RxCUI chosen in the drug typeahead into the code stored on the record.
 * The browser only sends the RxCUI; name, TTY, form, strength and NDCs always come from RxNav here.
 */
import { z } from 'zod';
import { RxNavUnavailableError, rxnav, type RxNavClient } from './rxnav';
import { ALLERGEN_TYPES, DRUG_LOOKUP_UNAVAILABLE, isIngredientTty, isProductTty, type DrugCode } from './types';

export const rxcuiSchema = z.string().trim().regex(/^\d{1,10}$/, 'Invalid RxNorm code');
export const allergenTypeSchema = z.enum(ALLERGEN_TYPES);

export type DrugKind = 'medication' | 'allergy';

export type ResolveResult =
  | { ok: true; code: DrugCode }
  | { ok: false; unavailable: true; error: string }
  | { ok: false; unavailable: false; error: string };

export async function resolveDrugCode(rxcui: string, kind: DrugKind, client: RxNavClient = rxnav()): Promise<ResolveResult> {
  try {
    const code = await client.getDrugCode(rxcui);
    if (!code) return { ok: false, unavailable: false, error: 'RxNorm code not found' };
    if (kind === 'medication' && !isProductTty(code.tty)) {
      return { ok: false, unavailable: false, error: 'Choose a specific strength and form' };
    }
    if (kind === 'allergy' && !isProductTty(code.tty) && !isIngredientTty(code.tty)) {
      return { ok: false, unavailable: false, error: 'Choose a drug ingredient' };
    }
    return { ok: true, code };
  } catch (err) {
    if (err instanceof RxNavUnavailableError) return { ok: false, unavailable: true, error: DRUG_LOOKUP_UNAVAILABLE };
    throw err;
  }
}

/**
 * For create routes: resolve an optional RxCUI. RxNav down -> the record is saved as free text with
 * a warning (coded later); an RxCUI RxNav rejects -> a 400 for the caller.
 */
export async function optionalDrugCode(
  rxcui: string | null | undefined,
  kind: DrugKind,
): Promise<{ code: DrugCode | null; warning?: string; invalid?: string }> {
  if (!rxcui) return { code: null };
  const r = await resolveDrugCode(rxcui, kind);
  if (r.ok === true) return { code: r.code };
  if (r.unavailable) return { code: null, warning: `${r.error}. Saved without a drug code; code it from the chart later.` };
  return { code: null, invalid: r.error };
}
