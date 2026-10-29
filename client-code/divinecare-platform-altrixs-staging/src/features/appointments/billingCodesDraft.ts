/**
 * Booking panel "Billing codes" draft (client state) and the PUT body built from it.
 * Planned codes only: they prefill the note; the signed note's codes bill.
 */
import {
  EMPTY_PLAN,
  MAX_ADD_ONS,
  normalizeCode,
  normalizeModifiers,
  withTelehealthModifiers,
  type PlanInput,
  type PlannedPlan,
} from '@/lib/appointments/plannedCodes';

export type DraftLine = {
  code: string;
  units: number;
  /** Always 4 slots (Modifier 1-4); blanks are dropped on save */
  modifiers: string[];
  /** Billing override of the fee schedule charge (cents); null = fee schedule */
  overrideCents: number | null;
  overrideReason: string;
};

export type CodesDraft = {
  primary: DraftLine;
  addOns: DraftLine[];
  /** '' = automatic from visit mode / patient location */
  placeOfService: string;
  supervisingProviderId: string;
  /** Dollars as typed */
  discount: string;
  discountNote: string;
  /** Staff changed something: save it with the appointment */
  dirty: boolean;
  /** Primary still follows the appointment type / group default */
  primaryAuto: boolean;
  /** Telehealth modifiers still follow the visit mode / payer rule */
  modifiersAuto: boolean;
  /** A saved plan was loaded (edit mode) */
  loaded: boolean;
  /** From the server for this actor and appointment (quote / GET) */
  canEdit: boolean;
  canSetDiscount: boolean;
};

export const blankLine = (code = ''): DraftLine => ({ code, units: 1, modifiers: ['', '', '', ''], overrideCents: null, overrideReason: '' });

export function emptyCodesDraft(): CodesDraft {
  return {
    primary: blankLine(),
    addOns: [],
    placeOfService: '',
    supervisingProviderId: '',
    discount: '',
    discountNote: '',
    dirty: false,
    primaryAuto: true,
    modifiersAuto: true,
    loaded: false,
    canEdit: false,
    canSetDiscount: false,
  };
}

const four = (mods: readonly string[]) => [...normalizeModifiers(mods), '', '', '', ''].slice(0, 4);

/** Draft from a saved plan (edit mode). */
export function draftFromPlan(plan: PlannedPlan | null | undefined): CodesDraft {
  const p = plan ?? EMPTY_PLAN;
  const d = emptyCodesDraft();
  const toLine = (l: PlannedPlan['lines'][number]): DraftLine => ({
    code: l.code,
    units: l.units,
    modifiers: four(l.modifiers),
    overrideCents: l.overrideReason ? l.chargeCents : null,
    overrideReason: l.overrideReason ?? '',
  });
  const primary = p.lines.find((l) => !l.isAddOn);
  if (primary) {
    d.primary = toLine(primary);
    d.primaryAuto = false;
    d.modifiersAuto = false;
  }
  d.addOns = p.lines.filter((l) => l.isAddOn).slice(0, MAX_ADD_ONS).map(toLine);
  d.placeOfService = p.placeOfService ?? '';
  d.supervisingProviderId = p.supervisingProviderId ?? '';
  d.discount = p.discountCents ? (p.discountCents / 100).toFixed(2) : '';
  d.discountNote = p.discountNote ?? '';
  d.loaded = p.lines.length > 0 || Boolean(p.placeOfService || p.supervisingProviderId || p.discountCents);
  return d;
}

/** Apply the booking defaults while staff have not taken over the field. */
export function applyDefaults(d: CodesDraft, defaults: { primary: string | null; telehealthModifiers: string[] }): CodesDraft {
  let next = d;
  if (d.primaryAuto && defaults.primary && normalizeCode(d.primary.code) !== defaults.primary) {
    next = { ...next, primary: { ...blankLine(defaults.primary), modifiers: next.primary.modifiers } };
  }
  if (next.modifiersAuto && normalizeCode(next.primary.code)) {
    const mods = four(withTelehealthModifiers(next.primary.modifiers, defaults.telehealthModifiers));
    if (mods.join('|') !== next.primary.modifiers.join('|')) next = { ...next, primary: { ...next.primary, modifiers: mods } };
  }
  return next;
}

export function dollarsToCents(v: string): number | null {
  const t = v.replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

/** Lines for the quote API (code, units, modifiers). */
export function quoteLines(d: CodesDraft) {
  return [
    ...(normalizeCode(d.primary.code) ? [{ code: d.primary.code, units: d.primary.units, modifiers: normalizeModifiers(d.primary.modifiers), isAddOn: false }] : []),
    ...d.addOns.filter((l) => normalizeCode(l.code)).map((l) => ({ code: l.code, units: l.units, modifiers: normalizeModifiers(l.modifiers), isAddOn: true })),
  ];
}

/** PUT /api/appointments/[id]/codes body. Discount fields only when the role may set them. */
export function codesPayload(d: CodesDraft, opts: { canSetDiscount: boolean }): PlanInput {
  const line = (l: DraftLine, isAddOn: boolean) => ({
    code: normalizeCode(l.code),
    units: l.units,
    modifiers: normalizeModifiers(l.modifiers),
    chargeCents: l.overrideCents,
    overrideReason: l.overrideReason.trim() || null,
    isAddOn,
  });
  const lines = [
    ...(normalizeCode(d.primary.code) ? [line(d.primary, false)] : []),
    ...d.addOns.filter((l) => normalizeCode(l.code)).map((l) => line(l, true)),
  ];
  const cents = dollarsToCents(d.discount);
  return {
    lines,
    placeOfService: d.placeOfService || null,
    supervisingProviderId: d.supervisingProviderId || null,
    ...(opts.canSetDiscount ? { discountCents: cents == null || Number.isNaN(cents) ? null : cents, discountNote: d.discountNote.trim() || null } : {}),
  };
}

/** Save the codes with this booking? Staff changed them, or a new booking has a default primary. */
export function shouldSaveCodes(d: CodesDraft, mode: 'create' | 'edit'): boolean {
  if (!d.canEdit) return false;
  if (d.dirty) return true;
  return mode === 'create' && Boolean(normalizeCode(d.primary.code));
}
