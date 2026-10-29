/**
 * Registry of the six MDH AOT forms (revised 06/25/2026). Pure: safe in the browser and in tests.
 */
import { progress, type FormData, type FormDefinition, type FormType } from './engine';
import { TREATMENT_PLAN, treatmentPlanSchema } from './treatmentPlan';
import { PSYCHIATRIST_AFFIDAVIT, affidavitSchema } from './affidavit';
import { EP_NOTIFICATION, epNotificationSchema } from './epNotification';
import { CONTINUED_TREATMENT_PLAN, continuedPlanSchema } from './continuedPlan';
import { NONRESPONSIVE_LETTER, nonresponsiveLetterSchema } from './nonresponsiveLetter';
import { COMPLAINT, complaintSchema } from './complaint';
import { canSignSlot, type SignActor } from './roles';

export * from './engine';

/** Order shown in the participant's Forms tab (court sequence first). */
export const FORM_TYPES: FormType[] = [
  'psychiatrist_affidavit',
  'treatment_plan',
  'nonresponsive_letter',
  'ep_notification',
  'continued_treatment_plan',
  'complaint',
];

export const FORM_DEFINITIONS: Record<FormType, FormDefinition> = {
  treatment_plan: TREATMENT_PLAN,
  psychiatrist_affidavit: PSYCHIATRIST_AFFIDAVIT,
  ep_notification: EP_NOTIFICATION,
  continued_treatment_plan: CONTINUED_TREATMENT_PLAN,
  nonresponsive_letter: NONRESPONSIVE_LETTER,
  complaint: COMPLAINT,
};

export const FORM_SCHEMAS = {
  treatment_plan: treatmentPlanSchema,
  psychiatrist_affidavit: affidavitSchema,
  ep_notification: epNotificationSchema,
  continued_treatment_plan: continuedPlanSchema,
  nonresponsive_letter: nonresponsiveLetterSchema,
  complaint: complaintSchema,
} as const;

export function isFormType(v: unknown): v is FormType {
  return typeof v === 'string' && (FORM_TYPES as string[]).includes(v);
}

export function getDefinition(type: string): FormDefinition | null {
  return isFormType(type) ? FORM_DEFINITIONS[type] : null;
}

// ─── Signatures (stored in data._meta.signatures; written only by the sign API) ──

export type FormSignature = {
  slot: string;
  userId: string;
  name: string;
  role: string;
  title?: string | null;
  signedAt: string;
  attestation: string;
};

export type DocMeta = {
  signatures?: FormSignature[];
  /** Field keys filled from the chart / participant record on creation, with where each came from */
  prefilled?: Record<string, string>;
  /** Earlier signed version this draft amends (signing it supersedes that one) */
  amendsId?: string | null;
  /** Non-responsive letter only: recorded after signing */
  mailing?: { trackingNumber: string; mailedDate: string; recordedAt: string; recordedById: string } | null;
};

export function docMeta(data: unknown): DocMeta {
  const m = data && typeof data === 'object' ? (data as Record<string, unknown>)._meta : null;
  return m && typeof m === 'object' ? (m as DocMeta) : {};
}

export function formFields(data: unknown): FormData {
  if (!data || typeof data !== 'object') return {};
  const { _meta, ...rest } = data as Record<string, unknown>;
  void _meta;
  return rest;
}

/** Slots still to sign, and whether this actor may sign one of them. */
export function signingState(def: FormDefinition, data: unknown, actor?: SignActor) {
  const sigs = docMeta(data).signatures ?? [];
  const pending = def.signers.filter((s) => !sigs.some((x) => x.slot === s.id));
  const mine = actor ? pending.filter((s) => canSignSlot(s, actor)) : [];
  return { signatures: sigs, pending, mySlots: mine, complete: pending.length === 0 };
}

/** Validate and normalise a draft's form fields (strips unknown keys; applies derived fields). */
export function parseFormData(type: FormType, input: unknown): { ok: boolean; data?: FormData; error?: string } {
  const parsed = FORM_SCHEMAS[type].safeParse(formFields(input));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `Invalid ${first?.path?.join('.') || 'form data'}: ${first?.message ?? 'invalid'}` };
  }
  const def = FORM_DEFINITIONS[type];
  const data = def.derive ? def.derive(parsed.data as FormData) : (parsed.data as FormData);
  return { ok: true, data };
}

export function formProgress(type: FormType, data: unknown) {
  return progress(FORM_DEFINITIONS[type], formFields(data));
}

export { canSignSlot };
export type { SignActor };
