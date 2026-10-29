import { buildClientName, normalizeDate, normalizeGender, normalizePhone } from '@/lib/migration/normalize';
import type { CanonicalClientField } from '@/lib/migration/fieldMaps';
import { resolveRoleAlias } from '@/lib/migration/roleAliases';
import { parseLegalNameSource } from '@/lib/clients/legalName';
import {
  ethnicityFromText,
  genderIdentityFromText,
  isValidMedicaidId,
  languageFromText,
  maritalStatusFromText,
  normalizeStateCode,
  normalizeUsPhone,
  normalizeUsZip,
  pronounsFromText,
  raceCodesFromText,
  relationshipFromText,
  sexAtBirthFromText,
  sexCodeFromText,
  sexualOrientationFromText,
  yesNoFromText,
} from '@/lib/clients/demographics';
import type { Role } from '@prisma/client';

export type ValidatedClient = {
  name: string;
  /** Legal first / last: from the first / last columns or a deterministic "Last, First M"; else null */
  firstName: string | null;
  middleInitial: string | null;
  lastName: string | null;
  /** The legal name could not be split without guessing: imported with the display name, flagged */
  needsNameReview: boolean;
  nameReviewReason: string | null;
  legalMiddleName: string | null;
  /** Coded demographics (src/lib/clients/demographics.ts); null when absent or not mappable */
  administrativeSex: string | null;
  sexAtBirth: string | null;
  genderIdentity: string | null;
  sexualOrientation: string | null;
  pronouns: string | null;
  race: string[];
  ethnicity: string | null;
  preferredLanguage: string | null;
  interpreterNeeded: boolean | null;
  maritalStatus: string | null;
  county: string | null;
  phoneType: string | null;
  phoneSecondaryType: string | null;
  emergencyContactRelationship: string | null;
  guardianName: string | null;
  guardianRelationship: string | null;
  guardianPhone: string | null;
  guarantorFirstName: string | null;
  guarantorLastName: string | null;
  guarantorRelationship: string | null;
  guarantorDateOfBirth: Date | null;
  guarantorPhone: string | null;
  guarantorAddressLine1: string | null;
  guarantorAddressLine2: string | null;
  guarantorCity: string | null;
  guarantorState: string | null;
  guarantorPostalCode: string | null;
  medicaidId: string | null;
  deceasedAt: Date | null;
  /** Source values that are not in a standard code set (reported to staff, not imported) */
  unmapped: Array<{ field: string; value: string }>;
  /** Preferred name / suffix when the export has the columns */
  preferredName: string | null;
  nameSuffix: string | null;
  email: string | null;
  phone: string | null;
  mrn: string | null;
  sourceId: string | null;
  /** Required for new patients; may be absent when updating an existing patient by source id */
  dateOfBirth: Date | null;
  gender: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  insurancePayer: string | null;
  insuranceMemberId: string | null;
  insuranceGroupNumber: string | null;
  primaryDiagnosis: string | null;
  primaryDiagnosisCode: string | null;
  /** Source system marks the patient inactive; null when the file has no such column */
  inactive: boolean | null;
  phoneSecondary: string | null;
  insuranceType: string | null;
  insuranceCoverageType: string | null;
  insurancePayerPhone: string | null;
  insuranceEffectiveFrom: Date | null;
  insuranceEffectiveTo: Date | null;
  copayAmount: number | null;
  /** Deductible / coinsurance text; kept as a pinned Billing office note */
  coverageNote: string | null;
  /** The primary policy itself is marked inactive in the source; its details are not imported */
  insuranceInactive: boolean;
  /** Provider names from the source, in its order (e.g. Valant "Pt. Assigned Prv") */
  assignedProviders: string[];
  /** Row has a source id but no name columns: usable only to update an existing patient */
  namesMissing: boolean;
  /** Clinic name or city from the source system, matched to a Location on import */
  location: string | null;
  /** Valant assigned facility exactly as exported (whitespace collapsed); stored on Client.valantFacility */
  valantFacility: string | null;
};

export type ValidatedStaff = {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  npi: string | null;
  dea: string | null;
  phone: string | null;
  licenseNumber: string | null;
  supervisorEmail: string | null;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; field?: string };

/** Assigned-facility cell: trimmed, single spaces, at most 200 chars; blank / "None" = null */
export function normalizeValantFacility(v?: string | null): string | null {
  const t = (v ?? '').trim().replace(/\s+/g, ' ');
  return t && !/^none$/i.test(t) ? t.slice(0, 200) : null;
}

/** Valant writes the literal "None" for empty pick-lists */
function noneToNull(v?: string | null): string | null {
  const t = emptyToNull(v);
  return t && !/^none$/i.test(t) ? t : null;
}

function parseMoney(v?: string | null): number | null {
  const t = emptyToNull(v)?.replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
}

function emptyToNull(v?: string | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

/** first + last + dob required; email format if present; zip ≤10 */
export function validateClient(
  fields: Partial<Record<CanonicalClientField, string>>
): ValidationResult<ValidatedClient> {
  const firstName = emptyToNull(fields.firstName);
  const lastName = emptyToNull(fields.lastName);
  const name = buildClientName(fields);
  // Partial exports (e.g. ID + assigned providers) carry no names; they can only update by source id
  const namesMissing = !firstName && !lastName && !name && Boolean(emptyToNull(fields.sourceId));

  if (!namesMissing && (!name || name.length < 2) && !(firstName && lastName)) {
    return { ok: false, error: 'firstName and lastName are required', field: 'name' };
  }

  // Legal name: the first / last columns, else ONLY a deterministic "Last, First M" split of the
  // full-name column. Anything else is imported under its display name and flagged for review.
  let resolvedFirst: string | null = firstName && lastName ? firstName : null;
  let resolvedLast: string | null = firstName && lastName ? lastName : null;
  let parsedMi: string | null = null;
  let parsedSuffix: string | null = null;
  let nameReviewReason: string | null = null;
  if (!namesMissing && !(resolvedFirst && resolvedLast)) {
    const parsed = parseLegalNameSource(emptyToNull(fields.name) ?? [lastName, firstName].filter(Boolean).join(', '));
    if (parsed.ok === false) {
      nameReviewReason = firstName || lastName ? 'Only one of first / last name in the source' : parsed.reason;
    } else {
      resolvedFirst = parsed.firstName;
      resolvedLast = parsed.lastName;
      parsedMi = parsed.middleInitial;
      parsedSuffix = parsed.suffix;
    }
  }

  const displayName = (resolvedFirst && resolvedLast ? `${resolvedFirst} ${resolvedLast}` : name) || '';

  const dobRaw = emptyToNull(fields.dateOfBirth);
  if (!dobRaw && !emptyToNull(fields.sourceId)) {
    return { ok: false, error: 'date of birth is required', field: 'dob' };
  }
  const dateOfBirth = dobRaw ? normalizeDate(dobRaw) : null;
  if (dobRaw && !dateOfBirth) {
    return { ok: false, error: `Invalid date of birth: ${dobRaw}`, field: 'dob' };
  }

  const email = emptyToNull(fields.email)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: `Invalid email: ${email}`, field: 'email' };
  }

  let postalCode = emptyToNull(fields.postalCode);
  if (postalCode && postalCode.length > 10) {
    postalCode = postalCode.slice(0, 10);
  }
  // Standard forms when they parse ("21201-1234", "MD"); otherwise kept as exported for staff to fix
  postalCode = normalizeUsZip(postalCode) ?? postalCode;

  // Coded demographics: exact label / synonym matches only; the rest is reported as unmapped
  const unmapped: Array<{ field: string; value: string }> = [];
  const coded = (field: string, r: { code: string | null; unmapped: string | null }) => {
    if (r.unmapped) unmapped.push({ field, value: r.unmapped.slice(0, 80) });
    return r.code;
  };
  // Sex: the sex column; a legacy gender column only when it literally says male / female
  const sexFromSex = coded('sex', sexCodeFromText(fields.administrativeSex));
  const legacyGender = sexCodeFromText(fields.gender).code;
  const administrativeSex = sexFromSex ?? (legacyGender === 'M' || legacyGender === 'F' ? legacyGender : null);
  const race = raceCodesFromText(fields.race);
  for (const v of race.unmapped) unmapped.push({ field: 'race', value: v.slice(0, 80) });

  // Phones: main phone first; typed columns fill the main / secondary phone (never invented)
  const typed = (
    [
      ['mobile', normalizePhone(fields.phoneMobile)],
      ['home', normalizePhone(fields.phoneHome)],
      ['work', normalizePhone(fields.phoneWork)],
    ] as const
  ).filter((t): t is readonly ['mobile' | 'home' | 'work', string] => Boolean(t[1]));
  const digits = (v: string | null) => normalizeUsPhone(v)?.digits ?? v;
  let phone = normalizePhone(fields.phone);
  let phoneType: string | null = phone ? typed.find((t) => digits(t[1]) === digits(phone))?.[0] ?? null : null;
  if (!phone && typed.length) {
    phone = typed[0][1];
    phoneType = typed[0][0];
  }
  let phoneSecondary = normalizePhone(fields.phoneSecondary);
  let phoneSecondaryType: string | null = phoneSecondary ? typed.find((t) => digits(t[1]) === digits(phoneSecondary))?.[0] ?? null : null;
  if (!phoneSecondary) {
    const other = typed.find((t) => digits(t[1]) !== digits(phone));
    if (other) {
      phoneSecondary = other[1];
      phoneSecondaryType = other[0];
    }
  }
  const medicaidRaw = emptyToNull(fields.medicaidId)?.replace(/\s/g, '') ?? null;
  if (medicaidRaw && !isValidMedicaidId(medicaidRaw)) unmapped.push({ field: 'medicaidId', value: 'not 11 digits' });

  return {
    ok: true,
    value: {
      name: displayName,
      firstName: resolvedFirst,
      middleInitial: emptyToNull(fields.middleInitial)?.replace(/\./g, '').slice(0, 1).toUpperCase() ?? parsedMi,
      lastName: resolvedLast,
      needsNameReview: !namesMissing && !(resolvedFirst && resolvedLast),
      nameReviewReason,
      legalMiddleName: emptyToNull(fields.legalMiddleName)?.slice(0, 80) ?? null,
      administrativeSex,
      sexAtBirth: coded('sexAtBirth', sexAtBirthFromText(fields.sexAtBirth)),
      genderIdentity: coded('genderIdentity', genderIdentityFromText(fields.genderIdentity)),
      sexualOrientation: coded('sexualOrientation', sexualOrientationFromText(fields.sexualOrientation)),
      pronouns: coded('pronouns', pronounsFromText(fields.pronouns)),
      race: race.codes,
      ethnicity: coded('ethnicity', ethnicityFromText(fields.ethnicity)),
      preferredLanguage: coded('preferredLanguage', languageFromText(fields.preferredLanguage)),
      interpreterNeeded: yesNoFromText(fields.interpreterNeeded),
      maritalStatus: coded('maritalStatus', maritalStatusFromText(fields.maritalStatus)),
      county: noneToNull(fields.county)?.slice(0, 80) ?? null,
      phoneType,
      phoneSecondaryType,
      emergencyContactRelationship: coded('emergencyContactRelationship', relationshipFromText(fields.emergencyContactRelationship)),
      guardianName: noneToNull(fields.guardianName)?.slice(0, 160) ?? null,
      guardianRelationship: coded('guardianRelationship', relationshipFromText(fields.guardianRelationship)),
      guardianPhone: normalizePhone(fields.guardianPhone),
      guarantorFirstName: noneToNull(fields.guarantorFirstName)?.slice(0, 80) ?? null,
      guarantorLastName: noneToNull(fields.guarantorLastName)?.slice(0, 80) ?? null,
      guarantorRelationship: coded('guarantorRelationship', relationshipFromText(fields.guarantorRelationship)),
      guarantorDateOfBirth: fields.guarantorDateOfBirth ? normalizeDate(fields.guarantorDateOfBirth) : null,
      guarantorPhone: normalizePhone(fields.guarantorPhone),
      guarantorAddressLine1: noneToNull(fields.guarantorAddressLine1),
      guarantorAddressLine2: noneToNull(fields.guarantorAddressLine2),
      guarantorCity: noneToNull(fields.guarantorCity),
      guarantorState: normalizeStateCode(fields.guarantorState) ?? noneToNull(fields.guarantorState),
      guarantorPostalCode: normalizeUsZip(fields.guarantorPostalCode) ?? noneToNull(fields.guarantorPostalCode),
      medicaidId: medicaidRaw,
      deceasedAt: fields.deceasedAt ? normalizeDate(fields.deceasedAt) : null,
      unmapped,
      preferredName: emptyToNull(fields.preferredName)?.slice(0, 80) ?? null,
      nameSuffix: emptyToNull(fields.nameSuffix)?.slice(0, 20) ?? parsedSuffix,
      email,
      phone,
      mrn: emptyToNull(fields.mrn)?.toUpperCase() ?? null,
      sourceId: emptyToNull(fields.sourceId),
      dateOfBirth,
      // Legacy display value: the gender column, else the sex column (as earlier imports stored it)
      gender: normalizeGender(emptyToNull(fields.gender) ?? fields.administrativeSex),
      addressLine1: emptyToNull(fields.addressLine1),
      addressLine2: emptyToNull(fields.addressLine2),
      city: emptyToNull(fields.city),
      state: normalizeStateCode(fields.state) ?? emptyToNull(fields.state),
      postalCode,
      emergencyContactName: emptyToNull(fields.emergencyContactName),
      emergencyContactPhone: normalizePhone(fields.emergencyContactPhone),
      insurancePayer: emptyToNull(fields.insurancePayer),
      insuranceMemberId: emptyToNull(fields.insuranceMemberId),
      insuranceGroupNumber: emptyToNull(fields.insuranceGroupNumber),
      primaryDiagnosis: emptyToNull(fields.primaryDiagnosis),
      primaryDiagnosisCode: emptyToNull(fields.primaryDiagnosisCode),
      inactive: emptyToNull(fields.inactive) == null ? null : /^(true|yes|y|1|inactive)$/i.test(fields.inactive!.trim()),
      phoneSecondary,
      insuranceType: noneToNull(fields.insuranceType),
      insuranceCoverageType: noneToNull(fields.insuranceCoverageType),
      insurancePayerPhone: normalizePhone(fields.insurancePayerPhone),
      insuranceEffectiveFrom: fields.insuranceEffectiveFrom ? normalizeDate(fields.insuranceEffectiveFrom) : null,
      insuranceEffectiveTo: fields.insuranceEffectiveTo ? normalizeDate(fields.insuranceEffectiveTo) : null,
      copayAmount: parseMoney(fields.copayAmount),
      coverageNote: noneToNull(fields.coverageNote)?.slice(0, 1000) ?? null,
      insuranceInactive: /^(true|yes|y|1)$/i.test(emptyToNull(fields.insuranceInactive) ?? ''),
      // Entries are separated by a comma with no space; "Name, CRNP-PMH" keeps its credential
      assignedProviders: (emptyToNull(fields.assignedProviders) ?? '')
        .split(/,(?=\S)/)
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 25),
      namesMissing,
      location: emptyToNull(fields.location),
      valantFacility: normalizeValantFacility(fields.valantFacility),
    },
  };
}

/** first + last + email + role required; NPI if present must be 10 digits */
export function validateStaff(row: Record<string, unknown>): ValidationResult<ValidatedStaff> {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      for (const [rk, rv] of Object.entries(row)) {
        if (rk.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') === k && rv != null) {
          const s = String(rv).trim();
          if (s) return s;
        }
      }
    }
    return null;
  };

  const first = pick('first_name', 'firstname', 'first');
  const last = pick('last_name', 'lastname', 'last');
  const full = pick('name', 'full_name', 'fullname', 'staff_name');

  let firstName = first;
  let lastName = last;
  if ((!firstName || !lastName) && full) {
    if (full.includes(',')) {
      const [l, f] = full.split(',');
      lastName = lastName || l?.trim() || null;
      firstName = firstName || f?.trim() || null;
    } else {
      const parts = full.split(/\s+/);
      firstName = firstName || parts[0] || null;
      lastName = lastName || parts.slice(1).join(' ') || null;
    }
  }

  if (!firstName || !lastName) {
    return {
      ok: false,
      error: 'firstName and lastName are required',
      field: 'name',
    };
  }

  const name = `${firstName} ${lastName}`.trim();

  const emailRaw = pick('email', 'email_address', 'emailaddress', 'work_email');
  if (!emailRaw) {
    return { ok: false, error: 'Staff email is required', field: 'email' };
  }
  const email = emailRaw.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: `Invalid email: ${email}`, field: 'email' };
  }

  const roleRaw = pick('role', 'title', 'job_title', 'jobtitle', 'position', 'credentials');
  const role = resolveRoleAlias(roleRaw);
  if (!role) {
    return {
      ok: false,
      error: roleRaw
        ? `Unrecognized role/title: ${roleRaw}`
        : 'Role / job title is required',
      field: 'role',
    };
  }

  const npiRaw = pick('npi', 'npi_number');
  let npi: string | null = null;
  if (npiRaw) {
    const digits = npiRaw.replace(/\D/g, '');
    if (digits.length !== 10) {
      return {
        ok: false,
        error: 'NPI must be exactly 10 digits when provided',
        field: 'npi',
      };
    }
    npi = digits;
  }

  return {
    ok: true,
    value: {
      name,
      firstName,
      lastName,
      email,
      role,
      npi,
      dea: pick('dea', 'dea_number'),
      phone: normalizePhone(pick('phone', 'phone_number', 'mobile', 'cell')),
      licenseNumber: pick('license', 'license_number', 'licensenumber', 'license_no'),
      supervisorEmail: pick(
        'supervisor_email',
        'supervisoremail',
        'supervisor',
        'manager_email'
      )?.toLowerCase() ?? null,
    },
  };
}
