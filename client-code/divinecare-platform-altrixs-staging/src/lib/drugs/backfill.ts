/**
 * Drug-code backfill plan (scripts/codify-meds-allergies.ts): match existing uncoded medications and
 * allergies against RxNorm and decide what may be applied. Pure apart from RxNav (injectable client).
 *
 * Applied with --apply: ONLY unambiguous exact matches (codify.ts) whose full code resolves, plus
 * food / environmental classification of obvious non-drug allergens. Everything else is listed for staff.
 */
import { matchAllergy, matchMedication, type MatchResult, type UncodedAllergy, type UncodedMedication } from './codify';
import { RxNavUnavailableError, type RxNavClient } from './rxnav';
import { allergyCodeFields, isIngredientTty, isProductTty, medicationCodeFields, type DrugCode } from './types';

export type BackfillKind = 'medication' | 'allergy';

export interface BackfillItem {
  kind: BackfillKind;
  id: string;
  clientId: string | null;
  text: string;
  result: MatchResult;
  /** Resolved full code for an exact match */
  code?: DrugCode;
}

export type BackfillStatus = MatchResult['status'];

export interface BackfillPlan {
  items: BackfillItem[];
  counts: Record<BackfillKind, Record<BackfillStatus, number> & { total: number }>;
}

const zero = (): Record<BackfillStatus, number> & { total: number } => ({
  exact: 0, review: 0, no_match: 0, non_drug: 0, skip: 0, unavailable: 0, total: 0,
});

/** Resolve an exact match's full code; anything unexpected demotes it to review (never applied). */
async function withCode(kind: BackfillKind, result: MatchResult, rx: RxNavClient): Promise<{ result: MatchResult; code?: DrugCode }> {
  if (result.status !== 'exact') return { result };
  try {
    const code = await rx.getDrugCode(result.rxcui);
    const ok = code && (kind === 'medication' ? isProductTty(code.tty) && code.doseForm && code.strength : isIngredientTty(code.tty) || isProductTty(code.tty));
    if (!code || !ok) return { result: { status: 'review', reason: `RxNorm ${result.rxcui} could not be resolved to a full code`, candidates: [] } };
    return { result, code };
  } catch (err) {
    if (err instanceof RxNavUnavailableError) return { result: { status: 'unavailable', reason: err.reason } };
    throw err;
  }
}

export async function planBackfill(
  input: {
    medications: (UncodedMedication & { id: string; clientId: string | null })[];
    allergies: (UncodedAllergy & { id: string; clientId: string | null })[];
  },
  rx: RxNavClient,
): Promise<BackfillPlan> {
  const items: BackfillItem[] = [];
  for (const m of input.medications) {
    const { result, code } = await withCode('medication', await matchMedication(m, rx), rx);
    items.push({ kind: 'medication', id: m.id, clientId: m.clientId, text: [m.drugName || m.medicationName, m.dosage].filter(Boolean).join(' '), result, ...(code ? { code } : {}) });
  }
  for (const a of input.allergies) {
    const { result, code } = await withCode('allergy', await matchAllergy(a, rx), rx);
    items.push({ kind: 'allergy', id: a.id, clientId: a.clientId, text: a.allergen, result, ...(code ? { code } : {}) });
  }
  const counts = { medication: zero(), allergy: zero() };
  for (const i of items) {
    counts[i.kind][i.result.status] += 1;
    counts[i.kind].total += 1;
  }
  return { items, counts };
}

/** The writes --apply makes: exact codes and non-drug classification only. */
export function backfillUpdates(plan: BackfillPlan, now: Date = new Date()) {
  const medications: { id: string; data: ReturnType<typeof medicationCodeFields> }[] = [];
  const allergies: { id: string; data: Record<string, unknown> }[] = [];
  for (const i of plan.items) {
    if (i.result.status === 'exact' && i.code) {
      if (i.kind === 'medication') medications.push({ id: i.id, data: medicationCodeFields(i.code, now) });
      else allergies.push({ id: i.id, data: allergyCodeFields(i.code, now) });
    } else if (i.kind === 'allergy' && i.result.status === 'non_drug') {
      allergies.push({ id: i.id, data: { allergenType: i.result.allergenType } });
    }
  }
  return { medications, allergies };
}
