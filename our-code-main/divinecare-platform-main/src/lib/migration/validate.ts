import { buildClientName, normalizeDate, normalizeGender, normalizePhone } from '@/lib/migration/normalize';
import type { CanonicalClientField } from '@/lib/migration/fieldMaps';
import { resolveRoleAlias } from '@/lib/migration/roleAliases';
import type { Role } from '@prisma/client';

export type ValidatedClient = {
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  mrn: string | null;
  sourceId: string | null;
  dateOfBirth: Date;
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

  if (!firstName || !lastName) {
    // Allow full-name-only rows if we can split "Last, First" or "First Last"
    if (!name || name.length < 2) {
      return {
        ok: false,
        error: 'firstName and lastName are required',
        field: 'name',
      };
    }
  }

  const resolvedFirst =
    firstName ||
    (name?.includes(',')
      ? name.split(',')[1]?.trim()
      : name?.split(/\s+/)[0]) ||
    '';
  const resolvedLast =
    lastName ||
    (name?.includes(',')
      ? name.split(',')[0]?.trim()
      : name?.split(/\s+/).slice(1).join(' ')) ||
    '';

  if (!resolvedFirst || !resolvedLast) {
    return {
      ok: false,
      error: 'firstName and lastName are required',
      field: 'name',
    };
  }

  const displayName = name || `${resolvedFirst} ${resolvedLast}`.trim();

  const dobRaw = emptyToNull(fields.dateOfBirth);
  if (!dobRaw) {
    return { ok: false, error: 'date of birth is required', field: 'dob' };
  }
  const dateOfBirth = normalizeDate(dobRaw);
  if (!dateOfBirth) {
    return { ok: false, error: `Invalid date of birth: ${dobRaw}`, field: 'dob' };
  }

  let email = emptyToNull(fields.email)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: `Invalid email: ${email}`, field: 'email' };
  }

  let postalCode = emptyToNull(fields.postalCode);
  if (postalCode && postalCode.length > 10) {
    postalCode = postalCode.slice(0, 10);
  }

  return {
    ok: true,
    value: {
      name: displayName,
      firstName: resolvedFirst,
      lastName: resolvedLast,
      email,
      phone: normalizePhone(fields.phone),
      mrn: emptyToNull(fields.mrn)?.toUpperCase() ?? null,
      sourceId: emptyToNull(fields.sourceId),
      dateOfBirth,
      gender: normalizeGender(fields.gender),
      addressLine1: emptyToNull(fields.addressLine1),
      addressLine2: emptyToNull(fields.addressLine2),
      city: emptyToNull(fields.city),
      state: emptyToNull(fields.state),
      postalCode,
      emergencyContactName: emptyToNull(fields.emergencyContactName),
      emergencyContactPhone: normalizePhone(fields.emergencyContactPhone),
      insurancePayer: emptyToNull(fields.insurancePayer),
      insuranceMemberId: emptyToNull(fields.insuranceMemberId),
      insuranceGroupNumber: emptyToNull(fields.insuranceGroupNumber),
      primaryDiagnosis: emptyToNull(fields.primaryDiagnosis),
      primaryDiagnosisCode: emptyToNull(fields.primaryDiagnosisCode),
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
