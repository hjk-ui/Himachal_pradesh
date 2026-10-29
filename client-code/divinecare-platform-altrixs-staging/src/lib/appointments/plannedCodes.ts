/**
 * Planned billing codes on an appointment (Valant-style "Primary Code / Add-on Code" at booking).
 * Pure: safe in tests, API routes and client components (no server imports).
 *
 * Compliance rules (the reason this module exists as its own layer):
 *  - Planned codes are a SCHEDULING plan. They prefill the progress note when the provider starts
 *    it (only when the note has no code yet). The provider can change them, and the SIGNED NOTE's
 *    codes are what bill. Planned codes never override documented codes and never create a claim.
 *  - Charges come from the practice fee schedule only. No fee schedule entry -> "No fee set" and the
 *    charge stays empty (never a built-in or invented amount).
 *  - Add-ons are suggested, never added automatically.
 */
import { pickFee, type FeeItem } from '@/lib/billing/feeSchedule';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PlannedLine = {
  code: string;
  units: number;
  modifiers: string[];
  /** Line total (fee x units) in cents; null = no fee set */
  chargeCents: number | null;
  /** Billing roles: why the charge differs from the fee schedule */
  overrideReason: string | null;
  isAddOn: boolean;
};

export type PlannedPlan = {
  /** lines[0] = primary (isAddOn false); the rest are add-ons */
  lines: PlannedLine[];
  /** Staff override; null = automatic from visit mode and patient location */
  placeOfService: string | null;
  supervisingProviderId: string | null;
  discountCents: number | null;
  discountNote: string | null;
};

export const EMPTY_PLAN: PlannedPlan = { lines: [], placeOfService: null, supervisingProviderId: null, discountCents: null, discountNote: null };

export const MAX_ADD_ONS = 3;
export const NO_FEE_SET = 'No fee set';

// ─── Roles ─────────────────────────────────────────────────────────────────────

type MaybeRole = string | null | undefined;
const has = (list: readonly string[], role: MaybeRole) => Boolean(role && list.includes(String(role)));

/** Front desk, office manager, billing and leadership: set codes on any appointment they can open. */
export const PLANNED_CODE_DESK_ROLES = ['FRONT_DESK', 'OFFICE_MANAGER', 'BILLING', 'ADMIN', 'SUPER_ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'] as const;
/** Rendering clinicians: see and edit codes on their OWN appointments only. */
export const PLANNED_CODE_CLINICIAN_ROLES = [
  'THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'PHYSICIAN', 'MEDICAL_NP', 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'CRISIS_RESPONDER',
] as const;
/** Charge override (with a reason): billing core. */
export const CHARGE_OVERRIDE_ROLES = ['BILLING', 'ADMIN', 'SUPER_ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'] as const;
/** Courtesy discount: billing (incl. billing-core leadership), front desk and office manager. */
export const DISCOUNT_ROLES = ['BILLING', 'FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'SUPER_ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'] as const;
/** Section open by default for these roles; collapsed for clinicians. */
const OPEN_BY_DEFAULT_ROLES = ['FRONT_DESK', 'OFFICE_MANAGER', 'BILLING', 'ADMIN', 'SUPER_ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'] as const;

export function canEditPlannedCodes(role: MaybeRole, opts: { isOwnAppointment: boolean }): boolean {
  if (has(PLANNED_CODE_DESK_ROLES, role)) return true;
  return has(PLANNED_CODE_CLINICIAN_ROLES, role) && opts.isOwnAppointment;
}
export function canOverrideCharge(role: MaybeRole): boolean {
  return has(CHARGE_OVERRIDE_ROLES, role);
}
export function canSetDiscount(role: MaybeRole): boolean {
  return has(DISCOUNT_ROLES, role);
}
export function billingSectionOpenByDefault(role: MaybeRole): boolean {
  return has(OPEN_BY_DEFAULT_ROLES, role);
}

// ─── Codes ─────────────────────────────────────────────────────────────────────

/** CPT (5 digits), CPT category II/III (4 digits + letter) or HCPCS (letter + 4 digits). */
const CODE_RE = /^(?:\d{5}|\d{4}[A-Z]|[A-Z]\d{4})$/;
const MODIFIER_RE = /^[A-Z0-9]{2}$/;
const EM_RE = /^992(0[2-5]|1[1-5])$/;

export function normalizeCode(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toUpperCase().split(/[\s-]/)[0] ?? '';
}
export function isValidCode(code: string): boolean {
  return CODE_RE.test(code);
}
export function isEmCode(code: string): boolean {
  return EM_RE.test(normalizeCode(code));
}
export function normalizeModifiers(mods: readonly (string | null | undefined)[] | null | undefined): string[] {
  return (mods || []).map((m) => String(m ?? '').trim().toUpperCase()).filter(Boolean);
}

const PSYCH_ADD_ONS = new Set(['90833', '90836', '90838']);
/** Add-on-only codes: never a primary. */
export const ADD_ON_CODES = new Set(['90785', '90833', '90836', '90838', '90840', '90863', '99354', '99355', '99417']);
/** Primaries 90785 (interactive complexity) may be added to (CPT; E/M only with a psychotherapy add-on). */
const INTERACTIVE_PRIMARY = new Set(['90791', '90792', '90832', '90834', '90837', '90853']);
const PSYCHOTHERAPY_PRIMARY = new Set(['90832', '90834', '90837']);
/** Conservative per-visit unit cap of 1 (same list as claimRules' per-day cap). */
const ONE_UNIT_CODES = new Set(['90791', '90792', '90832', '90833', '90834', '90836', '90837', '90838', '90839', '90846', '90847', '90853', '90785']);
const TELEHEALTH_MODIFIERS = new Set(['95', 'GT', '93', 'FQ']);

export function isAddOnCode(code: string): boolean {
  return ADD_ON_CODES.has(normalizeCode(code));
}

export type AddOnSuggestion = { code: string; reason: string };

/**
 * Standard add-on suggestions for the primary. Suggestions only: the UI shows them as chips and
 * never adds them by itself.
 */
export function addOnSuggestions(primary: string | null | undefined, current: readonly string[] = []): AddOnSuggestion[] {
  const p = normalizeCode(primary);
  if (!p) return [];
  const have = new Set(current.map(normalizeCode));
  const out: AddOnSuggestion[] = [];
  if (EM_RE.test(p)) {
    if (![...have].some((c) => PSYCH_ADD_ONS.has(c))) {
      out.push({ code: '90833', reason: 'Psychotherapy add-on with E/M, 16-37 min' });
      out.push({ code: '90836', reason: 'Psychotherapy add-on with E/M, 38-52 min' });
      out.push({ code: '90838', reason: 'Psychotherapy add-on with E/M, 53+ min' });
    }
  }
  if ((INTERACTIVE_PRIMARY.has(p) || (EM_RE.test(p) && [...have].some((c) => PSYCH_ADD_ONS.has(c)))) && !have.has('90785')) {
    out.push({ code: '90785', reason: 'Interactive complexity (when documented)' });
  }
  if (p === '90839' && !have.has('90840')) {
    out.push({ code: '90840', reason: 'Crisis, each additional 30 min (75+ min total)' });
  }
  return out;
}

// ─── Validation ────────────────────────────────────────────────────────────────

export type PlanCheck = { errors: string[]; warnings: string[] };

/** Code, unit, modifier and add-on edits for a planned visit (no minutes yet: time rules apply on the note). */
export function validatePlannedLines(lines: readonly Pick<PlannedLine, 'code' | 'units' | 'modifiers' | 'isAddOn'>[]): PlanCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!lines.length) return { errors, warnings };
  const primary = lines.find((l) => !l.isAddOn) ?? null;
  const addOns = lines.filter((l) => l.isAddOn);
  if (!primary) errors.push('Add-on codes need a primary code.');
  if (lines.filter((l) => !l.isAddOn).length > 1) errors.push('Only one primary code per appointment.');
  if (addOns.length > MAX_ADD_ONS) errors.push(`Up to ${MAX_ADD_ONS} add-on codes.`);
  const seen = new Set<string>();
  for (const l of lines) {
    const code = normalizeCode(l.code);
    const label = l.isAddOn ? `Add-on ${code || '(blank)'}` : `Primary ${code || '(blank)'}`;
    if (!isValidCode(code)) {
      errors.push(`${label}: not a CPT/HCPCS code (5 characters, e.g. 90834 or H0005).`);
      continue;
    }
    if (seen.has(code)) errors.push(`${code} is listed twice.`);
    seen.add(code);
    if (!l.isAddOn && ADD_ON_CODES.has(code)) errors.push(`${code} is an add-on code and can't be the primary code.`);
    const units = Number(l.units);
    if (!Number.isInteger(units) || units < 1 || units > 99) errors.push(`${code}: units must be a whole number from 1 to 99.`);
    else if (ONE_UNIT_CODES.has(code) && units > 1) errors.push(`${code} is billed once per visit (1 unit).`);
    else if (code === '90840' && units > 4) errors.push('90840: more than 4 units (over 3 hours of crisis care) needs billing review.');
    const mods = normalizeModifiers(l.modifiers);
    if (mods.length > 4) errors.push(`${code}: up to 4 modifiers.`);
    for (const m of mods) if (!MODIFIER_RE.test(m)) errors.push(`${code}: modifier "${m}" must be 2 letters or digits.`);
    if (new Set(mods).size !== mods.length) errors.push(`${code}: a modifier is repeated.`);
    if (mods.includes('GT') && mods.includes('95') && mods.length === 2) warnings.push(`${code}: 95 and GT together; most payers want one (check the payer rule).`);
  }
  const codes = lines.map((l) => normalizeCode(l.code));
  const p = primary ? normalizeCode(primary.code) : '';
  const hasCode = (c: string) => codes.includes(c);
  const psychAddOns = codes.filter((c) => PSYCH_ADD_ONS.has(c));
  if (psychAddOns.length && !EM_RE.test(p)) {
    errors.push(`${psychAddOns.join(', ')} is a psychotherapy add-on and needs an E/M primary (99202-99215).`);
  }
  if (psychAddOns.length > 1) errors.push('Only one psychotherapy add-on (90833 / 90836 / 90838) with an E/M.');
  if (hasCode('90840') && p !== '90839') errors.push('90840 (crisis, each additional 30 minutes) needs 90839 as the primary.');
  if (hasCode('90785')) {
    if (hasCode('90839') || hasCode('90840')) errors.push('90785 (interactive complexity) can\'t be billed with crisis psychotherapy 90839 / 90840.');
    else if (!INTERACTIVE_PRIMARY.has(p) && !(EM_RE.test(p) && psychAddOns.length)) {
      errors.push('90785 needs a psychiatric primary (90791, 90792, 90832, 90834, 90837, 90853, or an E/M with 90833 / 90836 / 90838).');
    }
  }
  if ((p === '90791' || p === '90792') && (psychAddOns.length || codes.some((c) => EM_RE.test(c) || PSYCHOTHERAPY_PRIMARY.has(c)))) {
    errors.push(`${p} can't be billed with an E/M or psychotherapy code for the same visit.`);
  }
  return { errors, warnings };
}

/** Courtesy discount checks (amount in cents, note required). */
export function validateDiscount(discountCents: number | null | undefined, note: string | null | undefined, totalChargeCents: number | null): string | null {
  if (discountCents == null || discountCents === 0) return null;
  if (!Number.isInteger(discountCents) || discountCents < 0) return 'Discount must be a positive amount.';
  if (totalChargeCents != null && discountCents > totalChargeCents) return 'Discount can\'t be more than the planned charges.';
  if (!String(note ?? '').trim()) return 'Add a discount note (why the courtesy discount was given).';
  return null;
}

// ─── Visit defaults ───────────────────────────────────────────────────────────

export type VisitMode = { isVirtual: boolean; audioOnly: boolean; patientLocationType?: string | null };

/** POS 11 office; telehealth 10 (patient at home, the default until check-in says otherwise) or 02 (other). */
export function autoPlaceOfService(v: VisitMode): '11' | '10' | '02' {
  if (!v.isVirtual && !v.audioOnly) return '11';
  return v.patientLocationType === 'other' ? '02' : '10';
}

export const PLACE_OF_SERVICE_OPTIONS = [
  { value: '11', label: '11 Office' },
  { value: '10', label: '10 Telehealth, patient home' },
  { value: '02', label: '02 Telehealth, other location' },
  { value: '12', label: '12 Home' },
  { value: '53', label: '53 Community mental health center' },
  { value: '99', label: '99 Other' },
] as const;

export type PayerTelehealthRule = {
  payerName?: string | null;
  /** 95 | GT | both | none */
  telehealthModifier?: string | null;
  /** 93 | FQ | none | not_allowed */
  audioOnlyModifier?: string | null;
} | null;

/**
 * Telehealth modifier for planned codes: 95 by default, or the payer's rule from the Waystar payer
 * mapping when the client's payer is mapped (GT, both, none; audio-only 93 / FQ).
 */
export function telehealthModifierFor(v: Pick<VisitMode, 'isVirtual' | 'audioOnly'>, rule: PayerTelehealthRule): { modifiers: string[]; note: string | null } {
  if (!v.isVirtual && !v.audioOnly) return { modifiers: [], note: null };
  const payer = rule?.payerName || 'the payer';
  if (v.audioOnly) {
    const a = String(rule?.audioOnlyModifier ?? '').trim();
    if (!rule) return { modifiers: ['93'], note: 'Payer not mapped: 93 (audio-only) suggested; billing confirms.' };
    if (a === '93' || a === 'FQ') return { modifiers: [a], note: `Audio-only modifier per ${payer}.` };
    if (a === 'none') return { modifiers: [], note: `${payer} takes no audio-only modifier.` };
    return { modifiers: [], note: `${payer} is not set up to accept audio-only telehealth; confirm before the visit.` };
  }
  const t = String(rule?.telehealthModifier ?? '95').trim() || '95';
  if (t === 'GT') return { modifiers: ['GT'], note: `GT per ${payer}.` };
  if (t === 'both') return { modifiers: ['GT', '95'], note: `GT and 95 per ${payer}.` };
  if (t === 'none') return { modifiers: [], note: `${payer} takes no telehealth modifier.` };
  return { modifiers: ['95'], note: rule ? null : 'Payer not mapped: 95 (default).' };
}

/** Swap telehealth modifiers for the visit's rule, keeping every other modifier staff entered. */
export function withTelehealthModifiers(mods: readonly string[], telehealthMods: readonly string[]): string[] {
  const kept = normalizeModifiers(mods).filter((m) => !TELEHEALTH_MODIFIERS.has(m));
  return [...kept, ...telehealthMods].slice(0, 4);
}

/** Default primary code for an appointment type (scheduling settings services[].defaultCpt, matched by title or id). */
export function defaultCodeForType(
  services: readonly { id?: string | null; title?: string | null; defaultCpt?: string | null }[] | null | undefined,
  type: string | null | undefined
): string | null {
  const t = String(type ?? '').trim().toLowerCase();
  if (!t) return null;
  const svc = (services || []).find((s) => String(s.title ?? '').trim().toLowerCase() === t || String(s.id ?? '').trim().toLowerCase() === t);
  const code = normalizeCode(svc?.defaultCpt);
  return code && isValidCode(code) ? code : null;
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

export type PlannedPrice = { chargeCents: number | null; feeCode: string | null; message: string | null };

/**
 * Charge for a planned line from the fee schedule (variant by telehealth / self-pay / child).
 * The built-in code list is NOT a fee schedule: no matching fee schedule row -> chargeCents null
 * and "No fee set". Never invents an amount.
 */
export function plannedCharge(
  items: readonly FeeItem[],
  line: { code: string; units: number; modifiers?: readonly string[] },
  ctx: { telehealth: boolean; selfPay: boolean; child: boolean }
): PlannedPrice {
  const code = normalizeCode(line.code);
  if (!isValidCode(code)) return { chargeCents: null, feeCode: null, message: null };
  const telehealth = ctx.telehealth || normalizeModifiers(line.modifiers).some((m) => TELEHEALTH_MODIFIERS.has(m));
  const q = pickFee([...items], { cpt: code, telehealth, selfPay: ctx.selfPay, child: ctx.child });
  if (q.source === 'constants' || q.feeMissing || !q.code) return { chargeCents: null, feeCode: null, message: NO_FEE_SET };
  const units = Math.max(1, Math.min(99, Math.trunc(Number(line.units) || 1)));
  return { chargeCents: q.feeCents * units, feeCode: q.code, message: q.needsReview ? 'Fee schedule row flagged for review' : null };
}

// ─── Save rules (role checks, override reason, discount) ──────────────────────

export type PlanInput = {
  lines: { code: string; units?: number; modifiers?: string[]; chargeCents?: number | null; overrideReason?: string | null; isAddOn?: boolean }[];
  placeOfService?: string | null;
  supervisingProviderId?: string | null;
  discountCents?: number | null;
  discountNote?: string | null;
};

export type PreparedPlan =
  | { ok: true; plan: PlannedPlan; changedFields: string[] }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Turn staff input into the stored plan. `feeCharges[i]` = fee schedule charge for input line i
 * (null = no fee set), computed by the caller. Non-billing roles always get the fee schedule
 * charge (any charge they send is ignored); billing roles may override with a reason.
 */
export function preparePlanForSave(
  input: PlanInput,
  opts: { role: MaybeRole; isOwnAppointment: boolean; feeCharges: (number | null)[]; existing: PlannedPlan | null }
): PreparedPlan {
  if (!canEditPlannedCodes(opts.role, { isOwnAppointment: opts.isOwnAppointment })) {
    return { ok: false, status: 403, error: 'Only front desk, office manager, billing, leadership or the visit\'s own clinician can set billing codes.' };
  }
  const existing = opts.existing ?? EMPTY_PLAN;
  const raw = (input.lines || []).filter((l) => normalizeCode(l.code));
  // Primary first, then add-ons in the order entered
  const ordered = [...raw.filter((l) => !l.isAddOn), ...raw.filter((l) => l.isAddOn)];
  const feeFor = (l: (typeof raw)[number]) => opts.feeCharges[input.lines.indexOf(l)] ?? null;
  const lines: PlannedLine[] = [];
  for (const l of ordered) {
    const code = normalizeCode(l.code);
    const units = l.units == null ? 1 : Number(l.units);
    const fee = feeFor(l);
    let chargeCents = fee;
    let overrideReason: string | null = null;
    const sent = l.chargeCents;
    if (sent != null && sent !== fee && canOverrideCharge(opts.role)) {
      if (!Number.isInteger(sent) || sent < 0) return { ok: false, status: 400, error: `${code}: charge must be a positive amount.` };
      const reason = String(l.overrideReason ?? '').trim();
      if (reason.length < 3) return { ok: false, status: 400, error: `${code}: add a reason for changing the fee schedule charge.` };
      chargeCents = sent;
      overrideReason = reason.slice(0, 300);
    } else if (!canOverrideCharge(opts.role)) {
      // Keep billing's earlier override when someone else saves the same code and units
      const kept = existing.lines.find((e) => e.code === code && e.units === units && e.isAddOn === Boolean(l.isAddOn) && e.overrideReason);
      if (kept) {
        chargeCents = kept.chargeCents;
        overrideReason = kept.overrideReason;
      }
    }
    lines.push({ code, units, modifiers: normalizeModifiers(l.modifiers), chargeCents, overrideReason, isAddOn: Boolean(l.isAddOn) });
  }
  const check = validatePlannedLines(lines);
  if (check.errors.length) return { ok: false, status: 400, error: check.errors[0] };

  const pos = input.placeOfService === undefined ? existing.placeOfService : (String(input.placeOfService ?? '').trim() || null);
  if (pos && !/^\d{2}$/.test(pos)) return { ok: false, status: 400, error: 'Place of service is a 2-digit code.' };

  let discountCents = existing.discountCents;
  let discountNote = existing.discountNote;
  const wantsDiscount = input.discountCents !== undefined || input.discountNote !== undefined;
  if (wantsDiscount) {
    const nextCents = input.discountCents === undefined ? existing.discountCents : input.discountCents || null;
    const nextNote = input.discountNote === undefined ? existing.discountNote : String(input.discountNote ?? '').trim().slice(0, 500) || null;
    const changed = (nextCents ?? null) !== (existing.discountCents ?? null) || (nextNote ?? null) !== (existing.discountNote ?? null);
    if (changed) {
      if (!canSetDiscount(opts.role)) return { ok: false, status: 403, error: 'Only billing, front desk and office manager can set a courtesy discount.' };
      const total = lines.every((l) => l.chargeCents != null) && lines.length ? lines.reduce((t, l) => t + (l.chargeCents ?? 0), 0) : null;
      const bad = validateDiscount(nextCents, nextNote, total);
      if (bad) return { ok: false, status: 400, error: bad };
      discountCents = nextCents ?? null;
      discountNote = nextCents ? nextNote : null;
    }
  }
  const plan: PlannedPlan = {
    lines,
    placeOfService: pos,
    supervisingProviderId: input.supervisingProviderId === undefined ? existing.supervisingProviderId : input.supervisingProviderId || null,
    discountCents,
    discountNote,
  };
  return { ok: true, plan, changedFields: planChangedFields(existing, plan) };
}

/** Field names that changed (for the audit log: field names and codes only, never notes or amounts). */
export function planChangedFields(before: PlannedPlan, after: PlannedPlan): string[] {
  const out: string[] = [];
  const pb = before.lines.find((l) => !l.isAddOn);
  const pa = after.lines.find((l) => !l.isAddOn);
  if ((pb?.code ?? null) !== (pa?.code ?? null)) out.push('primaryCode');
  if ((pb?.units ?? null) !== (pa?.units ?? null)) out.push('units');
  const modsOf = (p: PlannedPlan) => p.lines.map((l) => l.modifiers.join(':')).join('|');
  if (modsOf(before) !== modsOf(after)) out.push('modifiers');
  const addOnsOf = (p: PlannedPlan) => p.lines.filter((l) => l.isAddOn).map((l) => `${l.code}x${l.units}`).join(',');
  if (addOnsOf(before) !== addOnsOf(after)) out.push('addOnCodes');
  const chargesOf = (p: PlannedPlan) => p.lines.map((l) => `${l.chargeCents ?? ''}/${l.overrideReason ? 1 : 0}`).join('|');
  if (chargesOf(before) !== chargesOf(after)) out.push(after.lines.some((l) => l.overrideReason) ? 'chargeOverride' : 'charge');
  if (before.placeOfService !== after.placeOfService) out.push('placeOfService');
  if (before.supervisingProviderId !== after.supervisingProviderId) out.push('supervisingProvider');
  if (before.discountCents !== after.discountCents || before.discountNote !== after.discountNote) out.push('courtesyDiscount');
  return out;
}

// ─── Display ───────────────────────────────────────────────────────────────────

/** "90834-95 + 90785" (codes and modifiers only). Null when no codes are planned. */
export function plannedCodeSummary(lines: readonly Pick<PlannedLine, 'code' | 'modifiers' | 'isAddOn' | 'units'>[]): string | null {
  if (!lines.length) return null;
  const fmt = (l: (typeof lines)[number]) => [l.code, ...l.modifiers].join('-') + (l.units > 1 ? ` x${l.units}` : '');
  const primary = lines.find((l) => !l.isAddOn);
  const addOns = lines.filter((l) => l.isAddOn);
  return [primary ? fmt(primary) : null, ...addOns.map(fmt)].filter(Boolean).join(' + ');
}

/** Primary code only (calendar tooltip). */
export function plannedPrimaryCode(lines: readonly Pick<PlannedLine, 'code' | 'isAddOn'>[]): string | null {
  return lines.find((l) => !l.isAddOn)?.code ?? null;
}

// ─── Note prefill and the signed-code hint ────────────────────────────────────

/** Psychotherapy add-ons a progress note can carry as its second line (ProgressNote.addOnCptCode). */
const NOTE_ADD_ONS = PSYCH_ADD_ONS;

export type NotePrefill = { cptCode: string; addOnCptCode: string | null; modifiers: string[] };

/**
 * Codes to prefill a note from the plan. Null when the note already has a code: documented codes
 * are never overridden. The provider can change the prefill before signing.
 */
export function notePrefillFromPlan(
  note: { cptCode?: string | null; billingCode?: string | null } | null | undefined,
  lines: readonly Pick<PlannedLine, 'code' | 'modifiers' | 'isAddOn'>[] | null | undefined
): NotePrefill | null {
  if (note && (String(note.cptCode ?? '').trim() || String(note.billingCode ?? '').trim())) return null;
  const primary = (lines || []).find((l) => !l.isAddOn);
  if (!primary || !isValidCode(normalizeCode(primary.code))) return null;
  const addOn = (lines || []).find((l) => l.isAddOn && NOTE_ADD_ONS.has(normalizeCode(l.code)));
  return { cptCode: normalizeCode(primary.code), addOnCptCode: addOn ? normalizeCode(addOn.code) : null, modifiers: normalizeModifiers(primary.modifiers) };
}

/** "Scheduled as 90834" when the note's (signed) code differs from the planned primary; null otherwise. */
export function scheduledCodeHint(noteCpt: string | null | undefined, plannedPrimary: string | null | undefined): string | null {
  const planned = normalizeCode(plannedPrimary);
  if (!planned) return null;
  const documented = normalizeCode(noteCpt);
  if (documented && documented === planned) return null;
  return `Scheduled as ${planned}`;
}
