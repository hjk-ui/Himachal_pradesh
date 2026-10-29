export type DenialCategoryKey =
  | 'Authorization'
  | 'Med Necessity'
  | 'Missing Info'
  | 'Eligibility'
  | 'Timely Filing'
  | 'Other';

export const DENIAL_CATEGORY_ORDER: DenialCategoryKey[] = [
  'Authorization',
  'Med Necessity',
  'Missing Info',
  'Eligibility',
  'Timely Filing',
];

export const DENIAL_CATEGORY_TONE: Record<DenialCategoryKey, string> = {
  Authorization: 'bg-violet-600',
  'Med Necessity': 'bg-orange-500',
  'Missing Info': 'bg-teal-500',
  Eligibility: 'bg-blue-500',
  'Timely Filing': 'bg-red-500',
  Other: 'bg-slate-400',
};

export function denialCategory(reasonCode: string, reasonText: string): DenialCategoryKey {
  const hay = `${reasonCode} ${reasonText}`.toLowerCase();
  if (/\bco-?15\b|\b197\b|prior.?auth|authoriz/.test(hay)) return 'Authorization';
  if (/\bco-?50\b|\bn243\b|med(?:ical)?\s*nec/.test(hay)) return 'Med Necessity';
  if (/\bco-?16\b|missing|incomplete|attachment|incomplete documentation/.test(hay)) return 'Missing Info';
  if (/\bco-?27\b|eligib|coverage terminated/.test(hay)) return 'Eligibility';
  if (/\bco-?29\b|timely|filing/.test(hay)) return 'Timely Filing';
  return 'Other';
}

const CATEGORY_REASON_CODE: Record<DenialCategoryKey, string> = {
  Authorization: 'CO-15',
  'Med Necessity': 'CO-50',
  'Missing Info': 'CO-16',
  Eligibility: 'CO-27',
  'Timely Filing': 'CO-29',
  Other: 'CO-16',
};

export function reasonCodeFromText(reason: string | null | undefined): string {
  const text = reason || '';
  return CATEGORY_REASON_CODE[denialCategory(text, text)];
}
