import { DrFirstError } from './errors';
import type { IntegrationPatient, IntegrationPrescriber } from './types';
export function mapPatient(row: { id: string; name: string; dateOfBirth: Date | null }, organizationId: string): IntegrationPatient {
  const date = row.dateOfBirth;
  if (!row.id || !organizationId || !row.name.trim() || !date || !Number.isFinite(date.getTime()) || date > new Date()) throw new DrFirstError('DRFIRST_PATIENT_INVALID');
  return { id: row.id, organizationId, name: row.name.trim(), dateOfBirth: date.toISOString().slice(0, 10) };
}
export function mapPrescriber(row: { id: string; name: string | null; npi?: string | null }, organizationId: string): IntegrationPrescriber {
  const npi = row.npi?.trim();
  if (!row.id || !organizationId || !row.name?.trim() || (npi && !/^\d{10}$/.test(npi))) throw new DrFirstError('DRFIRST_PRESCRIBER_INVALID');
  // Enrollment and whether NPI is mandatory belong to the future official adapter.
  return { id: row.id, organizationId, name: row.name.trim(), ...(npi ? { npi } : {}) };
}
