/** 42 CFR Part 2 disclosure vocabularies. No database access: safe in the browser. */

export const DISCLOSURE_BASES = [
  { value: 'consent', label: 'Written patient consent (42 CFR 2.31)' },
  { value: 'medical_emergency', label: 'Medical emergency (42 CFR 2.51)' },
  { value: 'court_order', label: 'Court order (42 CFR 2.61-2.67)' },
  { value: 'audit_evaluation', label: 'Audit or evaluation (42 CFR 2.53)' },
  { value: 'research', label: 'Research (42 CFR 2.52)' },
  { value: 'other_exception', label: 'Other exception allowed by Part 2' },
] as const;

export const DISCLOSURE_METHODS = [
  { value: 'mail', label: 'Mail' },
  { value: 'fax', label: 'Fax' },
  { value: 'electronic', label: 'Secure electronic (email / Direct)' },
  { value: 'hie', label: 'Health information exchange' },
  { value: 'portal', label: 'Patient / payer portal' },
  { value: 'in_person', label: 'In person (paper copy)' },
  { value: 'phone', label: 'Phone (verbal)' },
  { value: 'other', label: 'Other' },
] as const;

export type DisclosureBasis = (typeof DISCLOSURE_BASES)[number]['value'];
export type DisclosureMethod = (typeof DISCLOSURE_METHODS)[number]['value'];

export function disclosureBasisLabel(v: string): string {
  return DISCLOSURE_BASES.find((b) => b.value === v)?.label ?? v;
}

export function disclosureMethodLabel(v: string): string {
  return DISCLOSURE_METHODS.find((m) => m.value === v)?.label ?? v;
}

export type Part2DisclosureView = {
  id: string;
  clientId: string;
  consentFormId: string | null;
  consentReference: string | null;
  basis: string;
  disclosedTo: string;
  purpose: string;
  informationDisclosed: string;
  method: string;
  disclosedAt: string;
  disclosedById: string;
  disclosedByName: string | null;
  createdAt: string;
};
