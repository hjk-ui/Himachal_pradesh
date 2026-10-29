import type { Role } from '@prisma/client';

export const PII_PRIVILEGED_ROLES = [
  'SUPER_ADMIN',
  'PRACTICE_DIRECTOR',
  'ADMIN',
  'DIRECTOR',
  'PHYSICIAN',
  'PSYCHIATRIST',
  'NP',
  'MEDICAL_NP',
  'THERAPIST',
  'CLINICIAN',
  'CASE_MANAGER',
] as const satisfies readonly Role[];

export function canSeePii(role: Role | string | null | undefined): boolean {
  if (!role) return false;
  return (PII_PRIVILEGED_ROLES as readonly string[]).includes(role);
}

/** Masked phone: ••• ••• •••• */
export function maskPhone(_value?: string | null): string {
  return '••• ••• ••••';
}

/** Keep domain only: ••••@domain */
export function maskEmail(value?: string | null): string {
  if (!value) return '';
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return '••••@hidden';
  return `••••@${value.slice(at + 1)}`;
}

/** Masked street address */
export function maskAddress(_value?: string | null): string {
  return '•••••••••••••••••';
}

type PiiShape = {
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContact?: { phone?: string | null; name?: string | null } | null;
  phoneSecondary?: string | null;
  guardianPhone?: string | null;
  guarantorPhone?: string | null;
  guarantorAddressLine1?: string | null;
  guarantorAddressLine2?: string | null;
  guarantorPostalCode?: string | null;
  medicaidId?: string | null;
};

/**
 * Mask contact PII for non-privileged roles.
 * Masks: phone, email, address lines, postalCode, emergencyContactPhone / emergencyContact.phone,
 * secondary / guardian / guarantor phones, guarantor address, Medicaid number.
 * Leaves: name, DOB, diagnosis, emergency contact name, city, state.
 */
export function maskClientPii<T extends PiiShape>(
  client: T,
  role: Role | string | null | undefined
): T {
  if (canSeePii(role)) return client;

  const out: T = { ...client };

  if (out.email) out.email = maskEmail(out.email);
  if (out.phone) out.phone = maskPhone(out.phone);
  if (out.addressLine1) out.addressLine1 = maskAddress(out.addressLine1);
  if (out.addressLine2) out.addressLine2 = maskAddress(out.addressLine2);
  if (out.postalCode) out.postalCode = '•••••';
  if (out.emergencyContactPhone) {
    out.emergencyContactPhone = maskPhone(out.emergencyContactPhone);
  }
  if (out.phoneSecondary) out.phoneSecondary = maskPhone(out.phoneSecondary);
  if (out.guardianPhone) out.guardianPhone = maskPhone(out.guardianPhone);
  if (out.guarantorPhone) out.guarantorPhone = maskPhone(out.guarantorPhone);
  if (out.guarantorAddressLine1) out.guarantorAddressLine1 = maskAddress(out.guarantorAddressLine1);
  if (out.guarantorAddressLine2) out.guarantorAddressLine2 = maskAddress(out.guarantorAddressLine2);
  if (out.guarantorPostalCode) out.guarantorPostalCode = '•••••';
  if (out.medicaidId) out.medicaidId = `•••••••${out.medicaidId.slice(-4)}`;
  if (out.emergencyContact && typeof out.emergencyContact === 'object') {
    out.emergencyContact = {
      ...out.emergencyContact,
      phone: out.emergencyContact.phone
        ? maskPhone(out.emergencyContact.phone)
        : out.emergencyContact.phone,
    };
  }

  return out;
}
