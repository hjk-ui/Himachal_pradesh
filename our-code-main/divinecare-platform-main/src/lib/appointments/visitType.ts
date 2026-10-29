/**
 * Visit type (modality) — Telehealth vs In person — catalog, lock rules, exact copy.
 * Pure: shared by the API, the service, and VisitTypeChange (client component).
 * Backed by Appointment.isVirtual; Appointment.type (the service) is not touched.
 */

export type VisitTypeValue = 'in_person' | 'telehealth';

export type VisitTypeOption = {
  value: VisitTypeValue;
  label: string;
  isVirtual: boolean;
};

export const VISIT_TYPE_CATALOG: readonly VisitTypeOption[] = [
  { value: 'in_person', label: 'In person', isVirtual: false },
  { value: 'telehealth', label: 'Telehealth', isVirtual: true },
];

export const VISIT_TYPE_REASON_MAX = 300;

export const VISIT_TYPE_LOCKED_CODE = 'VISIT_TYPE_LOCKED';
export const VISIT_TYPE_BILLED_CODE = 'VISIT_TYPE_BILLED';

export const VISIT_TYPE_LOCKED_MESSAGE = 'The note is signed; the visit type is final.';
export const VISIT_TYPE_BILLED_MESSAGE = 'Visit already billed — use a charge correction';

export function visitTypeFromVirtual(isVirtual: boolean): VisitTypeOption {
  return VISIT_TYPE_CATALOG.find((o) => o.isVirtual === isVirtual) ?? VISIT_TYPE_CATALOG[0];
}

export function findVisitType(value: string | null | undefined): VisitTypeOption | null {
  return VISIT_TYPE_CATALOG.find((o) => o.value === value) ?? null;
}

/** Claims that have left the building — a status change would no longer match what was billed. */
export const BILLED_CLAIM_STATUSES = ['SUBMITTED', 'ACCEPTED', 'DENIED', 'PAID'] as const;

export type VisitTypeLock =
  | { locked: false }
  | { locked: true; code: typeof VISIT_TYPE_LOCKED_CODE | typeof VISIT_TYPE_BILLED_CODE; message: string };

/** Signed note wins over billed: the note message is the more fundamental reason. */
export function evaluateVisitTypeLock(input: {
  noteStatus: string | null | undefined;
  billed: boolean;
}): VisitTypeLock {
  if ((input.noteStatus ?? '').toUpperCase() === 'SIGNED') {
    return { locked: true, code: VISIT_TYPE_LOCKED_CODE, message: VISIT_TYPE_LOCKED_MESSAGE };
  }
  if (input.billed) {
    return { locked: true, code: VISIT_TYPE_BILLED_CODE, message: VISIT_TYPE_BILLED_MESSAGE };
  }
  return { locked: false };
}
