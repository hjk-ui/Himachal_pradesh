/** Map our Client.name onto Availity patientFirstName / patientLastName. */
export function splitPersonName(fullName: string | null | undefined): {
  firstName?: string;
  lastName?: string;
} {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** Availity sample / genderCode values: M, F, U. */
export function mapPatientGender(gender: string | null | undefined): string | undefined {
  const value = (gender ?? '').trim();
  if (!value) return undefined;
  if (/^[MFU]$/i.test(value)) return value.toUpperCase();
  if (/^male$/i.test(value) || /^m$/i.test(value)) return 'M';
  if (/^female$/i.test(value) || /^f$/i.test(value)) return 'F';
  if (/^unknown$/i.test(value) || /^u$/i.test(value)) return 'U';
  return undefined;
}

export function formatDateOnly(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

export function normalizeMatchKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function namesMatch(a: string, b: string): boolean {
  const left = normalizeMatchKey(a);
  const right = normalizeMatchKey(b);
  return Boolean(left) && left === right;
}
