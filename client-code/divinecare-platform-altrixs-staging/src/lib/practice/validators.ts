/**
 * Practice identifier validators. Pure (no Prisma, no server-only) so the settings forms,
 * the API and the tests share one definition.
 */

/** NPI check digit: Luhn over "80840" + the 10 digits (CMS NPI standard). */
export function isValidNpi(value: string | null | undefined): boolean {
  const npi = (value || '').trim();
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = ('80840' + npi).split('').map(Number);
  let sum = 0;
  for (let i = digits.length - 1, dbl = false; i >= 0; i--, dbl = !dbl) {
    let d = digits[i];
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * EIN campus prefixes the IRS assigns (first two digits). Prefixes outside this list
 * (00, 07-09, 17-19, 28, 29, 49, 69, 70, 78, 79, 89, 96, 97) are never issued.
 */
const EIN_PREFIXES = new Set([
  '01', '02', '03', '04', '05', '06',
  '10', '11', '12', '13', '14', '15', '16',
  '20', '21', '22', '23', '24', '25', '26', '27',
  '30', '31', '32', '33', '34', '35', '36', '37', '38', '39',
  '40', '41', '42', '43', '44', '45', '46', '47', '48',
  '50', '51', '52', '53', '54', '55', '56', '57', '58', '59',
  '60', '61', '62', '63', '64', '65', '66', '67', '68',
  '71', '72', '73', '74', '75', '76', '77',
  '80', '81', '82', '83', '84', '85', '86', '87', '88',
  '90', '91', '92', '93', '94', '95', '98', '99',
]);

/** Digits only (accepts "12-3456789"). */
export function normalizeEin(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

export function isValidEin(value: string | null | undefined): boolean {
  const raw = (value || '').trim();
  if (!/^\d{2}-?\d{7}$/.test(raw)) return false;
  const ein = normalizeEin(raw);
  return EIN_PREFIXES.has(ein.slice(0, 2)) && ein !== '000000000';
}

/** "XX-XXX6789" — the only form a tax ID is ever returned in. */
export function maskTaxId(value: string | null | undefined): string {
  const ein = normalizeEin(value);
  if (!ein) return '';
  return `XX-XXX${ein.slice(-4)}`;
}

/** NUCC Health Care Provider Taxonomy code: 10 characters ending in X (e.g. 261QM0801X). */
export function isValidTaxonomy(value: string | null | undefined): boolean {
  return /^\d{3}[0-9A-Z]{6}X$/.test((value || '').trim().toUpperCase());
}

/** CMS CLIA number: 2 digits, "D", 7 digits. */
export function isValidClia(value: string | null | undefined): boolean {
  return /^\d{2}D\d{7}$/.test((value || '').trim().toUpperCase());
}

/** CMS place-of-service code (2 digits). */
export function isValidPos(value: string | null | undefined): boolean {
  return /^\d{2}$/.test((value || '').trim());
}

/** US phone: 10 digits after stripping formatting (a leading 1 is dropped). */
export function normalizePhone(value: string | null | undefined): string {
  const d = (value || '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

export function isValidPhone(value: string | null | undefined): boolean {
  return normalizePhone(value).length === 10;
}

export function formatPhone(value: string | null | undefined): string {
  const d = normalizePhone(value);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (value || '');
}

/** ZIP or ZIP+4 (stored as 5 or 9 digits). */
export function normalizeZip(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

export function isValidZip(value: string | null | undefined, requirePlus4 = false): boolean {
  const z = normalizeZip(value);
  return requirePlus4 ? z.length === 9 : z.length === 5 || z.length === 9;
}

/** Medicare PTAN: carrier-assigned, alphanumeric, up to 10 characters. */
export function isValidPtan(value: string | null | undefined): boolean {
  return /^[A-Z0-9]{4,10}$/.test((value || '').trim().toUpperCase());
}

/** Maryland Medicaid provider number (MMIS): 9 digits. */
export function isValidMdMedicaidNumber(value: string | null | undefined): boolean {
  return /^\d{9}$/.test((value || '').trim());
}
