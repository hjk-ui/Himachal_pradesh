import { z } from 'zod';

/**
 * Where a medication on the list came from (ClientMedication.source).
 * Medication-history reconciliation ahead of e-prescribing; DrFirst-synced rows
 * use 'prescribed' / 'reported'.
 */
export const MEDICATION_SOURCES = ['outside_provider', 'self_reported', 'prescribed', 'otc'] as const;
export type MedicationSource = (typeof MEDICATION_SOURCES)[number];

export const medicationSourceSchema = z.enum(MEDICATION_SOURCES);

export const MEDICATION_SOURCE_OPTIONS: { value: MedicationSource; label: string }[] = [
  { value: 'outside_provider', label: 'Outside provider' },
  { value: 'self_reported', label: 'Self-reported' },
  { value: 'prescribed', label: 'Prescribed here' },
  { value: 'otc', label: 'OTC' },
];

const LABELS: Record<string, string> = {
  outside_provider: 'Outside provider',
  self_reported: 'Self-reported',
  prescribed: 'Prescribed here',
  otc: 'OTC',
  reported: 'Reported',
};

export function medicationSourceLabel(source?: string | null): string | null {
  if (!source) return null;
  return LABELS[source] ?? source;
}
