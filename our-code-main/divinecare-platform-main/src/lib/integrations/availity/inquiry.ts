import { AvailityEligibilityError } from './errors';
import type { CoveragesPayerConfig } from './payer';
import {
  formatDateOnly,
  mapPatientGender,
  splitPersonName,
} from './mapping';

/** Official Coverages POST /v1/coverages request-body field names. */
const COVERAGE_REQUEST_FIELDS = [
  'payerId',
  'providerLastName',
  'providerFirstName',
  'providerType',
  'providerNpi',
  'providerTaxId',
  'payerAssignedProviderId',
  'providerSSN',
  'providerPIN',
  'providerCity',
  'providerState',
  'providerZipCode',
  'providerSpecialty',
  'placeOfService',
  'submitterId',
  'asOfDate',
  'toDate',
  'serviceType',
  'cardIssueDate',
  'procedureCode',
  'memberId',
  'medicaidId',
  'patientSSN',
  'patientLastName',
  'patientFirstName',
  'patientMiddleName',
  'patientSuffix',
  'patientGender',
  'patientBirthDate',
  'patientState',
  'groupNumber',
  'subscriberRelationship',
] as const;

type CoverageRequestField = (typeof COVERAGE_REQUEST_FIELDS)[number];

export type EligibilitySource = {
  payerId: string;
  insuranceMemberId: string | null;
  insuranceGroupNumber: string | null;
  clientName: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  state: string | null;
  providerNpi: string | null;
  providerName: string | null;
  /** Date of service for asOfDate (defaults to today when omitted). */
  asOfDate?: Date | null;
};

function elementOf(config: CoveragesPayerConfig, field: string) {
  return config.elements[field];
}

function isAllowed(config: CoveragesPayerConfig, field: string): boolean {
  const el = elementOf(config, field);
  if (!el) return true;
  if (el.allowed === false) return false;
  return true;
}

function isRequired(config: CoveragesPayerConfig, field: string): boolean {
  return elementOf(config, field)?.required === true;
}

function applyPattern(config: CoveragesPayerConfig, field: string, value: string): string | undefined {
  const el = elementOf(config, field);
  let next = value.trim();
  if (!next) return undefined;
  if (el?.maxLength && next.length > el.maxLength) next = next.slice(0, el.maxLength);
  if (el?.pattern) {
    try {
      if (!new RegExp(el.pattern).test(next)) return undefined;
    } catch {
      return next;
    }
  }
  return next;
}

export function buildCoveragesFormBody(
  source: EligibilitySource,
  config: CoveragesPayerConfig
): URLSearchParams {
  const patient = splitPersonName(source.clientName);
  const provider = splitPersonName(source.providerName);
  const candidates: Partial<Record<CoverageRequestField, string | undefined>> = {
    payerId: source.payerId,
    providerNpi: source.providerNpi ?? undefined,
    providerLastName: provider.lastName,
    providerFirstName: provider.firstName,
    memberId: source.insuranceMemberId ?? undefined,
    groupNumber: source.insuranceGroupNumber ?? undefined,
    patientLastName: patient.lastName,
    patientFirstName: patient.firstName,
    patientBirthDate: formatDateOnly(source.dateOfBirth),
    patientGender: mapPatientGender(source.gender),
    patientState: source.state?.trim().toUpperCase(),
    asOfDate: formatDateOnly(source.asOfDate ?? new Date()),
  };

  const body = new URLSearchParams();
  const missing: { field?: string; errorMessage: string }[] = [];

  for (const field of COVERAGE_REQUEST_FIELDS) {
    if (!isAllowed(config, field)) continue;

    let value = candidates[field];
    const el = elementOf(config, field);
    if (!value && el?.defaultValue && isRequired(config, field)) {
      value = el.defaultValue;
    }
    if (!value) {
      if (isRequired(config, field)) {
        missing.push({
          field,
          errorMessage: el?.errorMessage || `Missing required eligibility field: ${field}`,
        });
      }
      continue;
    }

    const checked = applyPattern(config, field, value);
    if (!checked) {
      missing.push({
        field,
        errorMessage: el?.errorMessage || `Invalid value for ${field}`,
      });
      continue;
    }

    if (field === 'serviceType') {
      body.append('serviceType', checked);
      continue;
    }
    body.set(field, checked);
  }

  if (missing.length) {
    throw new AvailityEligibilityError(
      'Client or provider is missing information required by this payer',
      400,
      'missing_fields',
      missing
    );
  }

  if (![...body.keys()].length) {
    throw new AvailityEligibilityError(
      'No allowed Coverages fields could be sent for this payer',
      400,
      'missing_fields'
    );
  }

  return body;
}
