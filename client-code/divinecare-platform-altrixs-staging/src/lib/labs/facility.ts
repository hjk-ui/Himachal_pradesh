import { PRACTICE } from '@/lib/practice';

/**
 * Identifiers that go on a lab order / requisition. Never invented: the ordering NPI comes
 * from the clinician's staff profile, the CLIA number only from configuration.
 */

/**
 * Performing labs. No electronic interface exists yet (no HL7 / lab-vendor ordering connection):
 * every order prints a requisition that goes with the specimen or the patient. Lab account
 * numbers are not stored here — none have been provided.
 */
export const PERFORMING_LABS = [
  { id: 'QUEST', label: 'Quest Diagnostics', short: 'Quest' },
  { id: 'LABCORP', label: 'Labcorp', short: 'Labcorp' },
  { id: 'IN_HOUSE', label: 'In-house (performed in the practice)', short: 'In-house' },
] as const;

export type PerformingLabId = (typeof PERFORMING_LABS)[number]['id'];

export function performingLabLabel(id: string | null | undefined, short = false): string {
  const hit = PERFORMING_LABS.find((l) => l.id === id);
  return hit ? (short ? hit.short : hit.label) : id || '—';
}

export const COLLECTION_SITES = [
  { id: 'in_office', label: 'Collected in office' },
  { id: 'patient_service_center', label: 'Patient service center (patient goes to the lab)' },
] as const;

export const BILL_TO_OPTIONS = [
  { id: 'insurance', label: 'Insurance' },
  { id: 'patient', label: 'Patient (self-pay)' },
  { id: 'client', label: 'Client bill (practice account)' },
] as const;

/** NPPES NPIs are exactly 10 digits. */
export function normalizeNpi(value: string | null | undefined): string | null {
  const v = (value || '').trim();
  return /^\d{10}$/.test(v) ? v : null;
}

/** CMS CLIA numbers: 2 digits, "D", 7 digits (e.g. 21Dxxxxxxx). */
export function normalizeClia(value: string | null | undefined): string | null {
  const v = (value || '').trim().toUpperCase();
  return /^\d{2}D\d{7}$/.test(v) ? v : null;
}

/** Facility CLIA from env LAB_FACILITY_CLIA; null (omitted from requisition + hash) when unset/invalid. */
export function labFacilityClia(): string | null {
  return normalizeClia(process.env.LAB_FACILITY_CLIA);
}

/** Facility name: the tenant organization's name, else the practice profile. */
export function labFacilityName(organizationName?: string | null): string {
  return organizationName?.trim() || PRACTICE.name;
}

/**
 * Tamper-evidence payload for the e-signature hash. CLIA is appended only when one is
 * configured, so an unset CLIA is never represented by a made-up value.
 */
export function labSignaturePayload(parts: {
  orderNumber: string;
  patientRef: string;
  signerNpi: string;
  signerName: string;
  signedAt: Date;
  facilityClia: string | null;
}): string {
  const base = `${parts.orderNumber}|${parts.patientRef}|${parts.signerNpi}|${parts.signerName}|${parts.signedAt.toISOString()}`;
  return parts.facilityClia ? `${base}|${parts.facilityClia}` : base;
}
