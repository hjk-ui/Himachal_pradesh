/** Parse common DOB formats → Date or null */
export function normalizeDate(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Excel serial date (days since 1899-12-30)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const ms = excelEpoch + Math.floor(n) * 86400000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  // ISO / YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.slice(0, 10) + 'T12:00:00.000Z');
    if (!Number.isNaN(d.getTime())) return d;
  }

  // MM/DD/YYYY or M/D/YY, optionally followed by a time ("1/2/1980 12:00:00 AM" from Valant)
  const mdy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T]\d{1,2}:\d{2}.*)?$/);
  if (mdy) {
    let year = Number(mdy[3]);
    if (year < 100) year += year >= 30 ? 1900 : 2000;
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const d = new Date(Date.UTC(year, month - 1, day, 12));
    if (
      !Number.isNaN(d.getTime()) &&
      d.getUTCFullYear() === year &&
      d.getUTCMonth() === month - 1 &&
      d.getUTCDate() === day
    ) {
      return d;
    }
  }

  // DD/MM/YYYY when day > 12
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (day > 12 && month <= 12) {
      const d = new Date(Date.UTC(year, month - 1, day, 12));
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  const fallback = new Date(s);
  if (!Number.isNaN(fallback.getTime())) {
    // Normalize to noon UTC to avoid TZ off-by-one on date-only values
    return new Date(
      Date.UTC(
        fallback.getFullYear(),
        fallback.getMonth(),
        fallback.getDate(),
        12
      )
    );
  }
  return null;
}

/** Map free-text gender → Male | Female | Non-binary | Other | Unknown | null */
export function normalizeGender(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  // A blank cell is "not recorded", never "Unknown" (that would be a fabricated answer)
  if (!s) return null;

  if (['m', 'male', 'man', 'boy', 'masc'].includes(s)) return 'Male';
  if (['f', 'female', 'woman', 'girl', 'fem'].includes(s)) return 'Female';
  if (
    [
      'nb',
      'non',
      'nonbinary',
      'non-binary',
      'non binary',
      'they',
      'them',
      'enby',
      'genderqueer',
    ].includes(s)
  ) {
    return 'Non-binary';
  }
  if (['other', 'o', 'x', 'intersex'].includes(s)) return 'Other';
  if (
    ['u', 'unkn', 'unknown', 'unspecified', 'prefer not to say', 'n/a', 'na'].includes(s)
  ) {
    return 'Unknown';
  }

  if (['Male', 'Female', 'Non-binary', 'Other', 'Unknown'].includes(String(raw).trim())) {
    return String(raw).trim();
  }

  return String(raw).trim().slice(0, 40);
}

/** Keep digits, spaces, +, -, (, ) only */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const cleaned = s.replace(/[^\d+\-() ]/g, '').trim();
  // Placeholders like (000) 000-0000 mean "no phone"
  if (!/[1-9]/.test(cleaned)) return null;
  return cleaned || null;
}

/** Format Date as YYYY-MM-DD */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildClientName(fields: {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string | null {
  const full = fields.name?.trim();
  if (full) return full;
  const parts = [fields.firstName?.trim(), fields.lastName?.trim()].filter(Boolean);
  if (parts.length) return parts.join(' ');
  return null;
}
