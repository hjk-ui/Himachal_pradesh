import { DrFirstError } from './errors';
import type { IntegrationPatient, IntegrationPrescriber } from './types';
function splitName(row: { name: string; legalFirstName?: string | null; middleInitial?: string | null; legalLastName?: string | null }) {
  const parts = row.name.trim().split(/\s+/);
  const firstName = row.legalFirstName?.trim() || parts[0] || '';
  const lastName = row.legalLastName?.trim() || parts.slice(1).join(' ') || '';
  // Always pass middleName (may be '') so Rcopia XML emits <MiddleName></MiddleName> when cleared.
  const middleName = (row.middleInitial || '').trim();
  return { firstName, lastName, middleName };
}

function mapSex(value?: string | null): 'M' | 'F' | 'U' {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'male' || normalized === 'm') return 'M';
  if (normalized === 'female' || normalized === 'f') return 'F';
  return 'U';
}

export function mapPatient(row: {
  id: string;
  name: string;
  dateOfBirth: Date | null;
  legalFirstName?: string | null;
  middleInitial?: string | null;
  legalLastName?: string | null;
  gender?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
  mrn?: string | null;
}, organizationId: string): IntegrationPatient {
  const date = row.dateOfBirth;
  const names = splitName(row);
  if (!row.id || !organizationId || !row.name.trim() || !names.firstName || !date || !Number.isFinite(date.getTime()) || date > new Date()) {
    throw new DrFirstError('DRFIRST_PATIENT_INVALID');
  }
  const optional = (value?: string | null) => value?.trim() || undefined;
  return {
    id: row.id,
    organizationId,
    name: row.name.trim(),
    ...names,
    dateOfBirth: date.toISOString().slice(0, 10),
    sex: mapSex(row.gender),
    addressLine1: optional(row.addressLine1),
    city: optional(row.city),
    state: optional(row.state)?.toUpperCase(),
    postalCode: optional(row.postalCode),
    phone: optional(row.phone),
    email: optional(row.email)?.toLowerCase(),
    mrn: optional(row.mrn),
  };
}
export function mapPrescriber(row: { id: string; name: string | null; email?: string | null; npi?: string | null }, organizationId: string): IntegrationPrescriber {
  const npi = row.npi?.trim();
  if (!row.id || !organizationId || !row.name?.trim() || (npi && !/^\d{10}$/.test(npi))) throw new DrFirstError('DRFIRST_PRESCRIBER_INVALID');
  const email = row.email?.trim().toLowerCase();
  return { id: row.id, organizationId, name: row.name.trim(), ...(email ? { email } : {}), ...(npi ? { npi } : {}) };
}
