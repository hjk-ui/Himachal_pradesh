import { z } from 'zod';

/**
 * Client demographics to industry standard: code sets, normalizers, and the readiness checks used
 * before DrFirst Rcopia patient sync, Waystar 837P / 270 / 276 and FHIR US Core Patient.
 * Pure (no database): safe to import from client components, routes and scripts.
 *
 * Rules: nothing is defaulted or guessed. A missing value stays null and is reported as missing.
 * "Declined to answer" is a recorded answer (HL7 NullFlavor ASKU), not a gap.
 */

// ─── Code sets ──────────────────────────────────────────────────────────────

export type CodeOption = { code: string; label: string };

export const NULL_FLAVOR_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-NullFlavor';
/** Asked but declined */
export const DECLINED = 'ASKU';
export const UNKNOWN = 'UNK';
export const OTHER = 'OTH';
export const NULL_FLAVORS = new Set([DECLINED, UNKNOWN, OTHER]);

/** HL7 AdministrativeGender as X12 DMG03 / Rcopia <Sex>: the sex on the insurance card / legal ID */
export const ADMINISTRATIVE_SEX: CodeOption[] = [
  { code: 'F', label: 'Female' },
  { code: 'M', label: 'Male' },
  { code: 'U', label: 'Unknown / not on ID' },
];

/** US Core birth sex (http://hl7.org/fhir/us/core/ValueSet/birthsex) */
export const SEX_AT_BIRTH: CodeOption[] = [
  { code: 'F', label: 'Female' },
  { code: 'M', label: 'Male' },
  { code: UNKNOWN, label: 'Unknown' },
  { code: DECLINED, label: 'Declined to answer' },
];

/** USCDI gender identity (SNOMED CT, US Core genderIdentity value set) */
export const GENDER_IDENTITY: CodeOption[] = [
  { code: '446141000124107', label: 'Female' },
  { code: '446151000124109', label: 'Male' },
  { code: '407376001', label: 'Transgender female (male-to-female)' },
  { code: '407377005', label: 'Transgender male (female-to-male)' },
  { code: '33791000087105', label: 'Non-binary' },
  { code: '446131000124102', label: 'Genderqueer / gender non-conforming' },
  { code: OTHER, label: 'Other' },
  { code: UNKNOWN, label: 'Unknown' },
  { code: DECLINED, label: 'Declined to answer' },
];

/** USCDI sexual orientation (SNOMED CT) */
export const SEXUAL_ORIENTATION: CodeOption[] = [
  { code: '20430005', label: 'Straight or heterosexual' },
  { code: '38628009', label: 'Lesbian, gay or homosexual' },
  { code: '42035005', label: 'Bisexual' },
  { code: OTHER, label: 'Something else' },
  { code: UNKNOWN, label: "Don't know" },
  { code: DECLINED, label: 'Declined to answer' },
];

/** Pronouns: LOINC 90778-2 answer list LL5144-2 */
export const PRONOUNS: CodeOption[] = [
  { code: 'LA29518-0', label: 'he/him/his' },
  { code: 'LA29519-8', label: 'she/her/hers' },
  { code: 'LA29520-6', label: 'they/them/theirs' },
  { code: OTHER, label: 'Other' },
  { code: DECLINED, label: 'Declined to answer' },
];

/** OMB race categories (CDC Race & Ethnicity code system 2.16.840.1.113883.6.238); multi-select */
export const RACE: CodeOption[] = [
  { code: '1002-5', label: 'American Indian or Alaska Native' },
  { code: '2028-9', label: 'Asian' },
  { code: '2054-5', label: 'Black or African American' },
  { code: '2076-8', label: 'Native Hawaiian or Other Pacific Islander' },
  { code: '2106-3', label: 'White' },
  { code: UNKNOWN, label: 'Unknown' },
  { code: DECLINED, label: 'Declined to answer' },
];

/** OMB ethnicity categories (CDC Race & Ethnicity code system) */
export const ETHNICITY: CodeOption[] = [
  { code: '2135-2', label: 'Hispanic or Latino' },
  { code: '2186-5', label: 'Not Hispanic or Latino' },
  { code: UNKNOWN, label: 'Unknown' },
  { code: DECLINED, label: 'Declined to answer' },
];

/** HL7 v3 MaritalStatus (FHIR R4 marital-status value set) */
export const MARITAL_STATUS: CodeOption[] = [
  { code: 'S', label: 'Never married' },
  { code: 'M', label: 'Married' },
  { code: 'T', label: 'Domestic partner' },
  { code: 'L', label: 'Legally separated' },
  { code: 'D', label: 'Divorced' },
  { code: 'W', label: 'Widowed' },
  { code: 'A', label: 'Annulled' },
  { code: 'I', label: 'Interlocutory' },
  { code: 'P', label: 'Polygamous' },
  { code: 'U', label: 'Unmarried' },
  { code: UNKNOWN, label: 'Unknown' },
];

/** Preferred language: ISO 639-1 (ISO 639-3 where no 2-letter code exists). Common in Maryland first. */
export const LANGUAGES: CodeOption[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'am', label: 'Amharic' },
  { code: 'ar', label: 'Arabic' },
  { code: 'zh', label: 'Chinese' },
  { code: 'fr', label: 'French' },
  { code: 'ht', label: 'Haitian Creole' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ig', label: 'Igbo' },
  { code: 'ko', label: 'Korean' },
  { code: 'fa', label: 'Persian (Farsi)' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'so', label: 'Somali' },
  { code: 'sw', label: 'Swahili' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'ti', label: 'Tigrinya' },
  { code: 'ur', label: 'Urdu' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'ase', label: 'American Sign Language' },
];

/**
 * No street address on file (DrFirst PDUM2): e-prescribing sends Address Line 1 "HOMELESS" / "UNKNOWN"
 * with the client's clinic city / state / ZIP. Staff choose; never inferred from a blank address.
 */
export const ADDRESS_STATUS: CodeOption[] = [
  { code: 'homeless', label: 'No fixed address (homeless)' },
  { code: 'unknown', label: 'Address unknown' },
];

export const PHONE_TYPES: CodeOption[] = [
  { code: 'mobile', label: 'Mobile' },
  { code: 'home', label: 'Home' },
  { code: 'work', label: 'Work' },
];

/** Related persons (emergency contact, guardian, guarantor): HL7 v3 RoleCode */
export const RELATIONSHIPS: CodeOption[] = [
  { code: 'SPS', label: 'Spouse' },
  { code: 'DOMPART', label: 'Domestic partner' },
  { code: 'PRN', label: 'Parent' },
  { code: 'MTH', label: 'Mother' },
  { code: 'FTH', label: 'Father' },
  { code: 'STPPRN', label: 'Step-parent' },
  { code: 'CHILD', label: 'Child' },
  { code: 'SIB', label: 'Sibling' },
  { code: 'GRPRN', label: 'Grandparent' },
  { code: 'GRNDCHILD', label: 'Grandchild' },
  { code: 'FAMMEMB', label: 'Other family member' },
  { code: 'GUARD', label: 'Legal guardian' },
  { code: 'FRND', label: 'Friend' },
  { code: 'NBOR', label: 'Neighbor' },
  { code: 'ROOM', label: 'Roommate' },
  { code: 'ONESELF', label: 'Self' },
  { code: OTHER, label: 'Other' },
];

/** USPS state / territory / military codes */
export const US_STATES: CodeOption[] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'],
  ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands'], ['GU', 'Guam'], ['AS', 'American Samoa'],
  ['MP', 'Northern Mariana Islands'], ['AA', 'Armed Forces Americas'], ['AE', 'Armed Forces Europe'], ['AP', 'Armed Forces Pacific'],
].map(([code, label]) => ({ code, label }));

const codes = (list: CodeOption[]) => new Set(list.map((o) => o.code));
const SETS = {
  administrativeSex: codes(ADMINISTRATIVE_SEX),
  sexAtBirth: codes(SEX_AT_BIRTH),
  genderIdentity: codes(GENDER_IDENTITY),
  sexualOrientation: codes(SEXUAL_ORIENTATION),
  pronouns: codes(PRONOUNS),
  race: codes(RACE),
  ethnicity: codes(ETHNICITY),
  maritalStatus: codes(MARITAL_STATUS),
  phoneType: codes(PHONE_TYPES),
  addressStatus: codes(ADDRESS_STATUS),
  relationship: codes(RELATIONSHIPS),
  state: codes(US_STATES),
};

export function codeLabel(list: CodeOption[], code: string | null | undefined): string | null {
  if (!code) return null;
  return list.find((o) => o.code === code)?.label ?? null;
}

// ─── Normalizers / validators ───────────────────────────────────────────────

/** "21201", "21201-1234", "212011234" -> "21201" / "21201-1234"; anything else -> null */
export function normalizeUsZip(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s || !/^[\d\s-]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 5) return digits;
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return null;
}

/** ZIP digits for X12 N403 / Rcopia: 5 or 9 digits, no hyphen; null when not a valid ZIP / ZIP+4 */
export function zipDigits(raw: string | null | undefined): string | null {
  const z = normalizeUsZip(raw);
  return z ? z.replace('-', '') : null;
}

export type UsPhone = { digits: string; e164: string; display: string };

/**
 * Placeholder / fictitious numbers that must never be sent as a patient phone (DrFirst PDUR2): all
 * digits the same, area code 555 or the 555-01xx fictional range, N11 service codes (211 ... 911) as
 * area code or exchange, a repeated-digit subscriber number (301-000-0000) and 123-456-7890 style
 * sequences. Area codes / exchanges starting 0 or 1 are already rejected by normalizeUsPhone.
 * Takes the 10 NANP digits.
 */
export function isPlaceholderPhone(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return true;
  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  const line = digits.slice(6);
  if (/^(\d)\1{9}$/.test(digits)) return true;
  if (area === '555' || (exchange === '555' && line.startsWith('01'))) return true;
  if (/^[2-9]11$/.test(area) || /^[2-9]11$/.test(exchange)) return true;
  if (/^(\d)\1{6}$/.test(exchange + line)) return true; // e.g. 301-000-0000, 410-111-1111
  if (digits === '1234567890' || exchange + line === '1234567') return true;
  return false;
}

/**
 * NANP (US) phone: 10 digits (or 11 with a leading 1), area code and exchange starting 2-9.
 * Extensions ("x123") are not part of the number and make it invalid here; enter them separately.
 */
export function normalizeUsPhone(raw: string | null | undefined): UsPhone | null {
  const s = (raw ?? '').trim();
  if (!s || /[A-Za-z]/.test(s)) return null;
  let digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return {
    digits,
    e164: `+1${digits}`,
    display: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
  };
}

const STATE_BY_NAME = new Map(US_STATES.map((s) => [s.label.toLowerCase(), s.code]));

/** "md" / "Maryland" -> "MD"; null when not a USPS state / territory code or name */
export function normalizeStateCode(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().replace(/\.$/, '');
  if (!s) return null;
  const up = s.toUpperCase();
  if (SETS.state.has(up)) return up;
  return STATE_BY_NAME.get(s.toLowerCase()) ?? null;
}

/** Maryland Medical Assistance recipient number: 11 digits */
export function isValidMedicaidId(raw: string | null | undefined): boolean {
  return /^\d{11}$/.test((raw ?? '').trim());
}

/**
 * X12 / Rcopia sex code. The structured administrativeSex wins; otherwise only a legacy
 * Client.gender that literally says male / female maps (M / F). Anything else (blank, "Unknown"
 * written by older imports, gender-identity words) is NOT mapped: it must be entered.
 */
export function administrativeSexCode(c: { administrativeSex?: string | null; gender?: string | null }): 'F' | 'M' | 'U' | null {
  const a = (c.administrativeSex ?? '').trim().toUpperCase();
  if (a === 'F' || a === 'M' || a === 'U') return a;
  const g = (c.gender ?? '').trim().toLowerCase();
  if (g === 'm' || g === 'male') return 'M';
  if (g === 'f' || g === 'female') return 'F';
  return null;
}

/** FHIR Patient.gender (administrative-gender) from the X12 code */
export function fhirAdministrativeGender(code: 'F' | 'M' | 'U' | null): 'female' | 'male' | 'unknown' | undefined {
  if (code === 'F') return 'female';
  if (code === 'M') return 'male';
  if (code === 'U') return 'unknown';
  return undefined;
}

/** Legacy display value kept in Client.gender when staff set administrativeSex */
export function legacyGenderFromSex(code: string | null | undefined): string | null {
  if (code === 'F') return 'Female';
  if (code === 'M') return 'Male';
  if (code === 'U') return 'Unknown';
  return null;
}

function validDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}

// ─── Readiness checks ───────────────────────────────────────────────────────

export type DemographicsInput = {
  name?: string | null;
  legalFirstName?: string | null;
  legalLastName?: string | null;
  needsNameReview?: boolean | null;
  mrn?: string | null;
  dateOfBirth?: Date | string | null;
  administrativeSex?: string | null;
  gender?: string | null;
  sexAtBirth?: string | null;
  race?: string[] | null;
  ethnicity?: string | null;
  preferredLanguage?: string | null;
  addressLine1?: string | null;
  /** 'homeless' | 'unknown': no street address on file (see ADDRESS_STATUS) */
  addressStatus?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
  insurancePayer?: string | null;
  insuranceMemberId?: string | null;
  insuranceType?: string | null;
  medicaidId?: string | null;
};

export type DemographicGap = { field: string; label: string; severity: 'required' | 'recommended' };
export type Readiness = { ready: boolean; missing: DemographicGap[] };
export type DemographicsReadiness = { drfirst: Readiness; claims: Readiness; fhir: Readiness };

const req = (field: string, label: string): DemographicGap => ({ field, label, severity: 'required' });
const rec = (field: string, label: string): DemographicGap => ({ field, label, severity: 'recommended' });

function nameGaps(c: DemographicsInput): DemographicGap[] {
  const out: DemographicGap[] = [];
  if (!c.legalFirstName?.trim()) out.push(req('legalFirstName', 'Legal first name'));
  if (!c.legalLastName?.trim()) out.push(req('legalLastName', 'Legal last name'));
  if (c.needsNameReview) out.push(req('needsNameReview', 'Legal name needs staff review'));
  return out;
}

function dobGap(c: DemographicsInput, now: Date): DemographicGap[] {
  const d = validDate(c.dateOfBirth);
  if (!d) return [req('dateOfBirth', 'Date of birth')];
  if (d.getTime() > now.getTime()) return [req('dateOfBirth', 'Date of birth is in the future')];
  return [];
}

function sexGap(c: DemographicsInput): DemographicGap[] {
  return administrativeSexCode(c) ? [] : [req('administrativeSex', 'Sex (as on insurance card / ID)')];
}

function addressGaps(c: DemographicsInput, severity: 'required' | 'recommended'): DemographicGap[] {
  const mk = severity === 'required' ? req : rec;
  const out: DemographicGap[] = [];
  if (!c.addressLine1?.trim()) out.push(mk('addressLine1', 'Street address'));
  if (!c.city?.trim()) out.push(mk('city', 'City'));
  if (!c.state?.trim()) out.push(mk('state', 'State'));
  else if (!normalizeStateCode(c.state)) out.push(mk('state', 'State is not a valid 2-letter US state code'));
  if (!c.postalCode?.trim()) out.push(mk('postalCode', 'ZIP code'));
  else if (!normalizeUsZip(c.postalCode)) out.push(mk('postalCode', 'ZIP code is not a valid 5-digit ZIP or ZIP+4'));
  return out;
}

function phoneGap(c: DemographicsInput, severity: 'required' | 'recommended'): DemographicGap[] {
  const mk = severity === 'required' ? req : rec;
  if (!c.phone?.trim()) return [mk('phone', 'Phone')];
  if (!normalizeUsPhone(c.phone)) return [mk('phone', 'Phone is not a valid 10-digit US number')];
  return [];
}

function done(missing: DemographicGap[]): Readiness {
  return { ready: !missing.some((g) => g.severity === 'required'), missing };
}

/**
 * DrFirst Rcopia send_patient / NCPDP SCRIPT patient: legal first + last, DOB, sex and a full
 * US address are required (pharmacies and the Maryland PDMP match on them); phone recommended.
 */
export function drfirstReadiness(c: DemographicsInput, now = new Date()): Readiness {
  // PDUM2: a client marked homeless / address unknown is sent with the clinic's city / state / ZIP
  const noFixedAddress = Boolean(c.addressStatus && SETS.addressStatus.has(c.addressStatus) && !c.addressLine1?.trim());
  const address = noFixedAddress ? [] : addressGaps(c, 'required');
  return done([...nameGaps(c), ...dobGap(c, now), ...sexGap(c), ...address, ...phoneGap(c, 'recommended')]);
}

/**
 * X12 837P 2010BA / 2010CA (and 270 / 276): NM1 legal last / first, N3 / N4 address, DMG DOB + sex,
 * member ID and payer. Subscriber-other-than-patient checks stay in the claim mapper (coverage rows).
 */
export function claimReadiness(c: DemographicsInput, now = new Date()): Readiness {
  const missing = [...nameGaps(c), ...dobGap(c, now), ...sexGap(c), ...addressGaps(c, 'required')];
  if (!c.insurancePayer?.trim()) missing.push(req('insurancePayer', 'Insurance payer'));
  if (!c.insuranceMemberId?.trim()) missing.push(req('insuranceMemberId', 'Insurance member ID'));
  if (/medicaid/i.test(c.insuranceType ?? '') && !c.medicaidId?.trim()) missing.push(rec('medicaidId', 'Maryland Medicaid (MA) number'));
  if (c.medicaidId?.trim() && !isValidMedicaidId(c.medicaidId)) missing.push(rec('medicaidId', 'Medicaid (MA) number is not 11 digits'));
  return done(missing);
}

/**
 * FHIR US Core Patient: identifier (MRN), a name and gender are required; birth date, birth sex,
 * race, ethnicity, preferred language, address and telecom are Must Support (recommended).
 */
export function fhirReadiness(c: DemographicsInput): Readiness {
  const missing: DemographicGap[] = [];
  if (!c.mrn?.trim()) missing.push(req('mrn', 'MRN'));
  if (!c.legalFirstName?.trim() && !c.legalLastName?.trim()) missing.push(req('legalLastName', 'Legal name'));
  missing.push(...sexGap(c));
  if (!validDate(c.dateOfBirth)) missing.push(rec('dateOfBirth', 'Date of birth'));
  if (!c.sexAtBirth?.trim()) missing.push(rec('sexAtBirth', 'Sex assigned at birth'));
  if (!c.race?.length) missing.push(rec('race', 'Race'));
  if (!c.ethnicity?.trim()) missing.push(rec('ethnicity', 'Ethnicity'));
  if (!c.preferredLanguage?.trim()) missing.push(rec('preferredLanguage', 'Preferred language'));
  missing.push(...addressGaps(c, 'recommended'));
  if (!c.phone?.trim() && !c.email?.trim()) missing.push(rec('phone', 'Phone or email'));
  return done(missing);
}

export function demographicsReadiness(c: DemographicsInput, now = new Date()): DemographicsReadiness {
  return { drfirst: drfirstReadiness(c, now), claims: claimReadiness(c, now), fhir: fhirReadiness(c) };
}

/** "Legal first name, Date of birth and ZIP code" for blocking messages */
export function describeGaps(gaps: DemographicGap[], severity: 'required' | 'recommended' = 'required'): string {
  const labels = gaps.filter((g) => g.severity === severity).map((g) => g.label);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

// ─── zod fields for create / update APIs ───────────────────────────────────

const optCode = (set: Set<string>, what: string) =>
  z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((v) => v == null || v === '' || set.has(v), { message: `Unknown ${what} code` });

const optPhone = (what: string) =>
  z
    .string()
    .trim()
    .max(40)
    .optional()
    .nullable()
    .refine((v) => v == null || v === '' || normalizeUsPhone(v) !== null, { message: `${what} must be a valid 10-digit US phone number` });

/** Structured demographic fields (all optional / nullable). Codes must come from the lists above. */
export const demographicFields = {
  legalMiddleName: z.string().trim().max(80).optional().nullable(),
  administrativeSex: optCode(SETS.administrativeSex, 'sex'),
  sexAtBirth: optCode(SETS.sexAtBirth, 'sex at birth'),
  genderIdentity: optCode(SETS.genderIdentity, 'gender identity'),
  sexualOrientation: optCode(SETS.sexualOrientation, 'sexual orientation'),
  pronouns: optCode(SETS.pronouns, 'pronouns'),
  race: z
    .array(z.string().trim())
    .max(7)
    .optional()
    .nullable()
    .refine((v) => !v || v.every((c) => SETS.race.has(c)), { message: 'Unknown race code' })
    .refine((v) => !v || v.length <= 1 || !v.some((c) => NULL_FLAVORS.has(c)), {
      message: '"Declined" / "Unknown" race cannot be combined with a race category',
    }),
  ethnicity: optCode(SETS.ethnicity, 'ethnicity'),
  preferredLanguage: z
    .string()
    .trim()
    .max(20)
    .optional()
    .nullable()
    .refine((v) => v == null || v === '' || /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v), { message: 'Preferred language must be an ISO 639 code (e.g. en, es)' }),
  interpreterNeeded: z.boolean().optional().nullable(),
  maritalStatus: optCode(SETS.maritalStatus, 'marital status'),
  county: z.string().trim().max(80).optional().nullable(),
  phoneType: optCode(SETS.phoneType, 'phone type'),
  phoneSecondaryType: optCode(SETS.phoneType, 'phone type'),
  addressStatus: optCode(SETS.addressStatus, 'address status'),
  emergencyContactRelationship: optCode(SETS.relationship, 'relationship'),
  guardianName: z.string().trim().max(160).optional().nullable(),
  guardianRelationship: optCode(SETS.relationship, 'relationship'),
  guardianPhone: optPhone('Guardian phone'),
  guarantorFirstName: z.string().trim().max(80).optional().nullable(),
  guarantorLastName: z.string().trim().max(80).optional().nullable(),
  guarantorRelationship: optCode(SETS.relationship, 'relationship'),
  guarantorDateOfBirth: z.string().trim().optional().nullable().refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: 'Guarantor date of birth must be YYYY-MM-DD' }),
  guarantorPhone: optPhone('Guarantor phone'),
  guarantorAddressLine1: z.string().trim().max(200).optional().nullable(),
  guarantorAddressLine2: z.string().trim().max(200).optional().nullable(),
  guarantorCity: z.string().trim().max(100).optional().nullable(),
  guarantorState: z.string().trim().max(40).optional().nullable().refine((v) => !v || normalizeStateCode(v) !== null, { message: 'Guarantor state must be a US state code' }),
  guarantorPostalCode: z.string().trim().max(20).optional().nullable().refine((v) => !v || normalizeUsZip(v) !== null, { message: 'Guarantor ZIP must be 5 digits or ZIP+4' }),
  medicaidId: z.string().trim().max(20).optional().nullable().refine((v) => !v || isValidMedicaidId(v), { message: 'Maryland Medicaid (MA) number must be 11 digits' }),
  deceasedAt: z.string().trim().optional().nullable().refine((v) => !v || !Number.isNaN(new Date(v).getTime()), { message: 'Invalid date of death' }),
};

/** Address / contact fields shared by the client forms: validated when present */
export const addressContactFields = {
  state: z.string().trim().max(40).optional().nullable().refine((v) => !v || normalizeStateCode(v) !== null, { message: 'State must be a 2-letter US state code' }),
  postalCode: z.string().trim().max(20).optional().nullable().refine((v) => !v || normalizeUsZip(v) !== null, { message: 'ZIP must be 5 digits or ZIP+4 (12345-6789)' }),
  phone: optPhone('Phone'),
  phoneSecondary: optPhone('Secondary phone'),
  emergencyContactPhone: optPhone('Emergency contact phone'),
};

export type DemographicFieldKey = keyof typeof demographicFields;
export const DEMOGRAPHIC_FIELD_KEYS = Object.keys(demographicFields) as DemographicFieldKey[];

function blankToNull(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t ? t : null;
}

/**
 * Prisma data for the structured demographic fields present in a parsed body (undefined = not sent,
 * left unchanged). Normalizes state / ZIP / dates; codes were validated by the zod fields.
 */
export function demographicUpdateData(body: Partial<Record<DemographicFieldKey, unknown>>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of DEMOGRAPHIC_FIELD_KEYS) {
    const v = body[key];
    if (v === undefined) continue;
    if (key === 'race') data.race = Array.isArray(v) ? Array.from(new Set(v as string[])) : [];
    else if (key === 'interpreterNeeded') data.interpreterNeeded = v == null ? null : Boolean(v);
    else if (key === 'guarantorDateOfBirth') data[key] = blankToNull(v as string) ? new Date(`${(v as string).trim()}T00:00:00.000Z`) : null;
    else if (key === 'deceasedAt') data[key] = blankToNull(v as string) ? new Date((v as string).trim()) : null;
    else if (key === 'guarantorState') data[key] = normalizeStateCode(v as string);
    else if (key === 'guarantorPostalCode') data[key] = normalizeUsZip(v as string);
    else if (key === 'medicaidId') data[key] = blankToNull(v as string)?.replace(/\s/g, '') ?? null;
    else data[key] = blankToNull(v as string | null);
  }
  return data;
}

/**
 * Patient name for X12 270 / 276 / 837 NM1: the structured legal name only. Null when the legal
 * first / last name is missing or flagged for review (a display name is never split).
 */
export function x12PatientName(c: {
  legalFirstName?: string | null;
  legalLastName?: string | null;
  middleInitial?: string | null;
  needsNameReview?: boolean | null;
}): { firstName: string; lastName: string; middleInitial: string | null } | null {
  const first = (c.legalFirstName ?? '').trim();
  const last = (c.legalLastName ?? '').trim();
  if (!first || !last || c.needsNameReview) return null;
  const mi = (c.middleInitial ?? '').replace(/\./g, '').trim().charAt(0).toUpperCase();
  return { firstName: first, lastName: last, middleInitial: mi || null };
}

export const X12_NAME_MISSING = 'Patient legal first and last name are missing or need staff review (set them on the client profile)';

/** Structured demographic fields as the client APIs / forms carry them (dates as YYYY-MM-DD strings) */
export type StructuredDemographics = {
  legalMiddleName?: string | null;
  needsNameReview?: boolean;
  nameReviewReason?: string | null;
  administrativeSex?: string | null;
  sexAtBirth?: string | null;
  genderIdentity?: string | null;
  sexualOrientation?: string | null;
  pronouns?: string | null;
  race?: string[] | null;
  ethnicity?: string | null;
  preferredLanguage?: string | null;
  interpreterNeeded?: boolean | null;
  maritalStatus?: string | null;
  county?: string | null;
  phoneType?: string | null;
  phoneSecondaryType?: string | null;
  emergencyContactRelationship?: string | null;
  guardianName?: string | null;
  guardianRelationship?: string | null;
  guardianPhone?: string | null;
  guarantorFirstName?: string | null;
  guarantorLastName?: string | null;
  guarantorRelationship?: string | null;
  guarantorDateOfBirth?: string | null;
  guarantorPhone?: string | null;
  guarantorAddressLine1?: string | null;
  guarantorAddressLine2?: string | null;
  guarantorCity?: string | null;
  guarantorState?: string | null;
  guarantorPostalCode?: string | null;
  medicaidId?: string | null;
  deceasedAt?: string | null;
  addressStatus?: string | null;
};

const ymdOrNull = (d: Date | null | undefined) => (d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null);

/** API response shape of the structured fields from a Client row */
export function structuredDemographicsOf(c: {
  legalMiddleName?: string | null; needsNameReview?: boolean | null; nameReviewReason?: string | null;
  administrativeSex?: string | null; sexAtBirth?: string | null; genderIdentity?: string | null; sexualOrientation?: string | null;
  pronouns?: string | null; race?: string[] | null; ethnicity?: string | null; preferredLanguage?: string | null;
  interpreterNeeded?: boolean | null; maritalStatus?: string | null; county?: string | null; phoneType?: string | null;
  phoneSecondaryType?: string | null; emergencyContactRelationship?: string | null; guardianName?: string | null;
  guardianRelationship?: string | null; guardianPhone?: string | null; guarantorFirstName?: string | null;
  guarantorLastName?: string | null; guarantorRelationship?: string | null; guarantorDateOfBirth?: Date | null;
  guarantorPhone?: string | null; guarantorAddressLine1?: string | null; guarantorAddressLine2?: string | null;
  guarantorCity?: string | null; guarantorState?: string | null; guarantorPostalCode?: string | null;
  medicaidId?: string | null; deceasedAt?: Date | null; addressStatus?: string | null;
}): StructuredDemographics {
  return {
    legalMiddleName: c.legalMiddleName ?? null,
    needsNameReview: Boolean(c.needsNameReview),
    nameReviewReason: c.nameReviewReason ?? null,
    administrativeSex: c.administrativeSex ?? null,
    sexAtBirth: c.sexAtBirth ?? null,
    genderIdentity: c.genderIdentity ?? null,
    sexualOrientation: c.sexualOrientation ?? null,
    pronouns: c.pronouns ?? null,
    race: c.race ?? [],
    ethnicity: c.ethnicity ?? null,
    preferredLanguage: c.preferredLanguage ?? null,
    interpreterNeeded: c.interpreterNeeded ?? null,
    maritalStatus: c.maritalStatus ?? null,
    county: c.county ?? null,
    phoneType: c.phoneType ?? null,
    phoneSecondaryType: c.phoneSecondaryType ?? null,
    emergencyContactRelationship: c.emergencyContactRelationship ?? null,
    guardianName: c.guardianName ?? null,
    guardianRelationship: c.guardianRelationship ?? null,
    guardianPhone: c.guardianPhone ?? null,
    guarantorFirstName: c.guarantorFirstName ?? null,
    guarantorLastName: c.guarantorLastName ?? null,
    guarantorRelationship: c.guarantorRelationship ?? null,
    guarantorDateOfBirth: ymdOrNull(c.guarantorDateOfBirth),
    guarantorPhone: c.guarantorPhone ?? null,
    guarantorAddressLine1: c.guarantorAddressLine1 ?? null,
    guarantorAddressLine2: c.guarantorAddressLine2 ?? null,
    guarantorCity: c.guarantorCity ?? null,
    guarantorState: c.guarantorState ?? null,
    guarantorPostalCode: c.guarantorPostalCode ?? null,
    medicaidId: c.medicaidId ?? null,
    deceasedAt: ymdOrNull(c.deceasedAt),
    addressStatus: c.addressStatus ?? null,
  };
}

// ─── Free text -> code (imports). Exact matches on known labels / synonyms only; anything else is
// returned as unmapped so staff record it (never a closest-match guess). ─────────────────────────

function textKey(raw: string | null | undefined): string {
  return (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function table(list: CodeOption[], synonyms: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const o of list) {
    m.set(textKey(o.code), o.code);
    m.set(textKey(o.label), o.code);
  }
  for (const [k, v] of Object.entries(synonyms)) m.set(textKey(k), v);
  return m;
}

const DECLINED_WORDS = [
  'declined', 'patient declined', 'refused', 'prefer not to say', 'prefer not to answer',
  'choose not to disclose', 'declined to answer', 'declined to specify', 'asked but declined',
];
const declinedSyn: Record<string, string> = Object.fromEntries(DECLINED_WORDS.map((w) => [w, DECLINED]));

const SEX_TEXT = table(ADMINISTRATIVE_SEX, { m: 'M', male: 'M', f: 'F', female: 'F', u: 'U', unknown: 'U', unk: 'U' });
const SEX_AT_BIRTH_TEXT = table(SEX_AT_BIRTH, { m: 'M', male: 'M', f: 'F', female: 'F', unknown: UNKNOWN, ...declinedSyn });
const GENDER_IDENTITY_TEXT = table(GENDER_IDENTITY, {
  male: '446151000124109', man: '446151000124109', female: '446141000124107', woman: '446141000124107',
  'transgender female': '407376001', 'trans woman': '407376001', 'transgender woman': '407376001', mtf: '407376001',
  'transgender male': '407377005', 'trans man': '407377005', 'transgender man': '407377005', ftm: '407377005',
  nonbinary: '33791000087105', 'non binary': '33791000087105', genderqueer: '446131000124102',
  other: OTHER, unknown: UNKNOWN, ...declinedSyn,
});
const ORIENTATION_TEXT = table(SEXUAL_ORIENTATION, {
  heterosexual: '20430005', straight: '20430005', 'gay or lesbian': '38628009', gay: '38628009', lesbian: '38628009',
  homosexual: '38628009', bisexual: '42035005', 'something else': OTHER, other: OTHER, 'dont know': UNKNOWN,
  unknown: UNKNOWN, ...declinedSyn,
});
const PRONOUN_TEXT = table(PRONOUNS, {
  'he/him': 'LA29518-0', he: 'LA29518-0', 'she/her': 'LA29519-8', she: 'LA29519-8',
  'they/them': 'LA29520-6', they: 'LA29520-6', other: OTHER, ...declinedSyn,
});
const RACE_TEXT = table(RACE, {
  white: '2106-3', caucasian: '2106-3', black: '2054-5', 'african american': '2054-5', asian: '2028-9',
  'american indian': '1002-5', 'alaska native': '1002-5', 'native american': '1002-5',
  'native hawaiian': '2076-8', 'pacific islander': '2076-8', 'other pacific islander': '2076-8',
  unknown: UNKNOWN, ...declinedSyn,
});
const ETHNICITY_TEXT = table(ETHNICITY, {
  hispanic: '2135-2', latino: '2135-2', latina: '2135-2', latinx: '2135-2', 'hispanic/latino': '2135-2',
  'not hispanic': '2186-5', 'non hispanic': '2186-5', 'not hispanic/latino': '2186-5', 'non hispanic or latino': '2186-5',
  unknown: UNKNOWN, ...declinedSyn,
});
const LANGUAGE_TEXT = table(LANGUAGES, {
  espanol: 'es', 'español': 'es', mandarin: 'cmn', cantonese: 'yue', farsi: 'fa', 'haitian creole': 'ht',
  asl: 'ase', 'sign language': 'ase', filipino: 'tl',
});
const MARITAL_TEXT = table(MARITAL_STATUS, {
  single: 'S', 'never married': 'S', married: 'M', divorced: 'D', widowed: 'W', widow: 'W', widower: 'W',
  separated: 'L', 'legally separated': 'L', 'domestic partner': 'T', 'life partner': 'T', annulled: 'A', unknown: UNKNOWN,
});
const RELATIONSHIP_TEXT = table(RELATIONSHIPS, {
  spouse: 'SPS', husband: 'SPS', wife: 'SPS', 'domestic partner': 'DOMPART', mother: 'MTH', mom: 'MTH', father: 'FTH', dad: 'FTH',
  parent: 'PRN', stepparent: 'STPPRN', stepmother: 'STPPRN', stepfather: 'STPPRN', child: 'CHILD', son: 'CHILD', daughter: 'CHILD',
  sibling: 'SIB', brother: 'SIB', sister: 'SIB', grandparent: 'GRPRN', grandmother: 'GRPRN', grandfather: 'GRPRN',
  grandchild: 'GRNDCHILD', grandson: 'GRNDCHILD', granddaughter: 'GRNDCHILD', aunt: 'FAMMEMB', uncle: 'FAMMEMB', cousin: 'FAMMEMB',
  relative: 'FAMMEMB', guardian: 'GUARD', 'legal guardian': 'GUARD', friend: 'FRND', neighbor: 'NBOR', roommate: 'ROOM', self: 'ONESELF',
});

export type CodeFromText = { code: string | null; unmapped: string | null };

function mapOne(map: Map<string, string>, raw: string | null | undefined): CodeFromText {
  const t = (raw ?? '').trim();
  if (!t || /^none$/i.test(t)) return { code: null, unmapped: null };
  const code = map.get(textKey(t)) ?? null;
  return { code, unmapped: code ? null : t };
}

export const sexCodeFromText = (raw: string | null | undefined) => mapOne(SEX_TEXT, raw);
export const sexAtBirthFromText = (raw: string | null | undefined) => mapOne(SEX_AT_BIRTH_TEXT, raw);
export const genderIdentityFromText = (raw: string | null | undefined) => mapOne(GENDER_IDENTITY_TEXT, raw);
export const sexualOrientationFromText = (raw: string | null | undefined) => mapOne(ORIENTATION_TEXT, raw);
export const pronounsFromText = (raw: string | null | undefined) => mapOne(PRONOUN_TEXT, raw);
export const ethnicityFromText = (raw: string | null | undefined) => mapOne(ETHNICITY_TEXT, raw);
export const languageFromText = (raw: string | null | undefined) => mapOne(LANGUAGE_TEXT, raw);
export const maritalStatusFromText = (raw: string | null | undefined) => mapOne(MARITAL_TEXT, raw);
export const relationshipFromText = (raw: string | null | undefined) => mapOne(RELATIONSHIP_TEXT, raw);

/** Race cell, possibly several values ("White; Asian"). Unmapped parts ("Two or more races", "Other") are returned. */
export function raceCodesFromText(raw: string | null | undefined): { codes: string[]; unmapped: string[] } {
  const t = (raw ?? '').trim();
  if (!t || /^none$/i.test(t)) return { codes: [], unmapped: [] };
  const whole = RACE_TEXT.get(textKey(t));
  const parts = whole ? [t] : t.split(/[;,|]/).map((p) => p.trim()).filter(Boolean);
  const codes: string[] = [];
  const unmapped: string[] = [];
  for (const p of parts) {
    const c = RACE_TEXT.get(textKey(p));
    if (c) {
      if (!codes.includes(c)) codes.push(c);
    } else unmapped.push(p);
  }
  // A declined / unknown answer alongside categories is contradictory: keep only the categories
  const categories = codes.filter((c) => !NULL_FLAVORS.has(c));
  return { codes: categories.length ? RACE.map((r) => r.code).filter((c) => categories.includes(c)) : codes.slice(0, 1), unmapped };
}

/** Yes / No cell -> boolean; anything else null */
export function yesNoFromText(raw: string | null | undefined): boolean | null {
  const t = textKey(raw);
  if (['y', 'yes', 'true', '1'].includes(t)) return true;
  if (['n', 'no', 'false', '0'].includes(t)) return false;
  return null;
}
