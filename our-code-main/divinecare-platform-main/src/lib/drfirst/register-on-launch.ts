import type { parseDrFirstSettings } from './settings';
import { DrFirstError } from './errors';

type RegisterMode = ReturnType<typeof parseDrFirstSettings>['registerOnLaunch'];

export function shouldRegisterOnLaunch(
  mode: RegisterMode,
  patient: { sourcePlatform?: string | null; importedAt?: Date | null; rcopiaPatientId?: string | null }
): 'register' | 'use_existing' | 'block' {
  const imported = Boolean(patient.sourcePlatform || patient.importedAt);
  if (patient.rcopiaPatientId) return 'use_existing';
  if (mode === 'off') {
    return 'block';
  }
  if (mode === 'non_imported') {
    if (imported) return 'block';
    return 'register';
  }
  // mode === 'true' — every patient
  return 'register';
}

/** Exact Oct 23 human labels for incomplete demographics (409 response). */
export function missingDemographicsLabels(row: {
  name?: string | null;
  legalFirstName?: string | null;
  legalLastName?: string | null;
  legalNameNeedsReview?: boolean | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  noFixedAddress?: boolean | null;
}): string[] {
  const missing: string[] = [];
  const first = row.legalFirstName?.trim() || row.name?.trim().split(/\s+/)[0];
  const last =
    row.legalLastName?.trim() ||
    (row.name?.trim().includes(' ') ? row.name.trim().split(/\s+/).slice(-1)[0] : '');
  if (!first) missing.push('Legal first name');
  if (!last) missing.push('Legal last name');
  if (row.legalNameNeedsReview) missing.push('Legal name needs staff review');
  if (!row.dateOfBirth || !Number.isFinite(row.dateOfBirth.getTime())) {
    missing.push('Date of birth');
  } else if (row.dateOfBirth.getTime() > Date.now()) {
    missing.push('Date of birth is in the future');
  }
  if (!row.gender?.trim()) missing.push('Sex (as on insurance card / ID)');
  if (row.noFixedAddress) {
    if (!row.city?.trim() || !row.state?.trim() || !row.postalCode?.trim()) {
      missing.push('Clinic address (city, state, ZIP) for a client with no fixed address');
    }
  } else {
    if (!row.addressLine1?.trim()) missing.push('Street address');
    if (!row.city?.trim()) missing.push('City');
    const state = row.state?.trim().toUpperCase() || '';
    if (!state) missing.push('State');
    else if (!/^[A-Z]{2}$/.test(state)) missing.push('State is not a valid 2-letter US state code');
    const zip = row.postalCode?.trim() || '';
    if (!zip) missing.push('ZIP code');
    else if (!/^\d{5}(-\d{4})?$/.test(zip)) {
      missing.push('ZIP code is not a valid 5-digit ZIP or ZIP+4');
    }
  }
  return missing;
}

/** Exact 409 body for demographics hard-stop. */
export function demographicsIncompleteMessage(labels: string[]): string {
  const list = labels.length ? labels.join(', ') : 'the missing demographics';
  return `DrFirst was not opened: add ${list} to this patient's chart (Edit demographics), then open DrFirst again. DrFirst needs them to create the patient.`;
}

export function uploadFailedMessage(reason: string): string {
  return `DrFirst was not opened: the patient could not be updated in DrFirst first (${reason}).`;
}

export function chartPartialFailureMessage(): string {
  return 'DrFirst was not opened: some problems, allergies or medications could not be sent to DrFirst. Try again in a minute.';
}

export function assertRegisterAllowed(
  mode: RegisterMode,
  patient: { sourcePlatform?: string | null; importedAt?: Date | null; rcopiaPatientId?: string | null }
) {
  const decision = shouldRegisterOnLaunch(mode, patient);
  if (decision === 'block' && !patient.rcopiaPatientId) {
    throw new DrFirstError(
      'DRFIRST_REGISTER_BLOCKED',
      409,
      mode === 'non_imported'
        ? 'Imported patients are not registered to DrFirst on staging (register-on-launch=non_imported).'
        : 'Register-on-launch is off; map the patient in DrFirst before launch.'
    );
  }
  return decision;
}
