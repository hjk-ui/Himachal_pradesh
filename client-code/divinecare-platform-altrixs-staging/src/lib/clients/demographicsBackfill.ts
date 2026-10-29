/**
 * Pure planning for scripts/backfill-client-legal-names.ts (no database). For one client row it
 * decides which deterministic fixes apply and what must be flagged for staff. Never guesses:
 *  - legal first / last only from a "Last, First M" display name (parseLegalNameSource);
 *  - administrativeSex only from a legacy gender that literally says male / female;
 *  - state / ZIP only when they normalize exactly ("Maryland" -> MD, 212011234 -> 21201-1234).
 */
import { clientNameFromLegal, parseLegalNameSource } from '@/lib/clients/legalName';
import { normalizeStateCode, normalizeUsZip } from '@/lib/clients/demographics';

export type BackfillRow = {
  id: string;
  name: string;
  legalFirstName: string | null;
  legalLastName: string | null;
  middleInitial: string | null;
  nameSuffix: string | null;
  needsNameReview: boolean;
  nameReviewReason: string | null;
  gender: string | null;
  administrativeSex: string | null;
  state: string | null;
  postalCode: string | null;
};

export type NameOutcome = 'already_set' | 'parsed' | 'flagged' | 'already_flagged';

export type BackfillPlan = {
  name: NameOutcome;
  /** Why the name was flagged (no name text in it) */
  nameReason: string | null;
  sex: 'already_set' | 'mapped' | 'unmapped' | 'missing';
  /** Legacy gender bucket when sex is unmapped (e.g. "unknown", "non-binary") for the report */
  legacyGenderBucket: string | null;
  stateNormalized: boolean;
  zipNormalized: boolean;
  /** Prisma update data; empty when nothing changes */
  data: Record<string, unknown>;
};

function blank(v: string | null | undefined) {
  return !(v ?? '').trim();
}

export function planClientBackfill(c: BackfillRow): BackfillPlan {
  const data: Record<string, unknown> = {};
  let name: NameOutcome;
  let nameReason: string | null = null;

  const hasFirst = !blank(c.legalFirstName);
  const hasLast = !blank(c.legalLastName);
  if (hasFirst && hasLast) {
    name = 'already_set';
  } else if (hasFirst || hasLast) {
    nameReason = 'Only one of legal first / last name on file';
    name = c.needsNameReview ? 'already_flagged' : 'flagged';
  } else {
    const parsed = parseLegalNameSource(c.name);
    if (parsed.ok === false) {
      nameReason = parsed.reason;
      name = c.needsNameReview ? 'already_flagged' : 'flagged';
    } else {
      name = 'parsed';
      data.legalFirstName = parsed.firstName;
      data.legalLastName = parsed.lastName;
      if (parsed.middleInitial && blank(c.middleInitial)) data.middleInitial = parsed.middleInitial;
      if (parsed.suffix && blank(c.nameSuffix)) data.nameSuffix = parsed.suffix;
      // Display name follows the legal pieces ("First Last")
      data.name = clientNameFromLegal({ legalFirstName: parsed.firstName, legalLastName: parsed.lastName });
      if (c.needsNameReview) {
        data.needsNameReview = false;
        data.nameReviewReason = null;
      }
    }
  }
  if (name === 'flagged') {
    data.needsNameReview = true;
    data.nameReviewReason = nameReason;
  }

  let sex: BackfillPlan['sex'];
  let legacyGenderBucket: string | null = null;
  if (!blank(c.administrativeSex)) sex = 'already_set';
  else {
    const g = (c.gender ?? '').trim().toLowerCase();
    if (g === 'm' || g === 'male') {
      sex = 'mapped';
      data.administrativeSex = 'M';
    } else if (g === 'f' || g === 'female') {
      sex = 'mapped';
      data.administrativeSex = 'F';
    } else if (!g) sex = 'missing';
    else {
      sex = 'unmapped';
      legacyGenderBucket = g.slice(0, 40);
    }
  }

  let stateNormalized = false;
  if (!blank(c.state)) {
    const st = normalizeStateCode(c.state);
    if (st && st !== c.state) {
      data.state = st;
      stateNormalized = true;
    }
  }
  let zipNormalized = false;
  if (!blank(c.postalCode)) {
    const z = normalizeUsZip(c.postalCode);
    if (z && z !== c.postalCode) {
      data.postalCode = z;
      zipNormalized = true;
    }
  }

  return { name, nameReason, sex, legacyGenderBucket, stateNormalized, zipNormalized, data };
}
