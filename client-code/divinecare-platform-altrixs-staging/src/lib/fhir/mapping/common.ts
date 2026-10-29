/**
 * Shared FHIR R4 mapping helpers (pure: no database, no network).
 * Resource ids are derived from our row ids so a PUT of the same row is idempotent.
 */
import { createHash } from 'node:crypto';

export const SYSTEMS = {
  client: 'urn:altrixs:client',
  organizationTag: 'urn:altrixs:organization',
  organization: 'urn:altrixs:organization-id',
  user: 'urn:altrixs:user',
  valant: 'urn:altrixs:valant',
  /** Maryland Medical Assistance recipient number (no public OID published; CRISP / MDH may assign one) */
  marylandMedicaid: 'urn:altrixs:maryland-medicaid',
  rcopiaProblem: 'urn:altrixs:rcopia:problem',
  rcopiaAllergy: 'urn:altrixs:rcopia:allergy',
  rcopiaMedication: 'urn:altrixs:rcopia:medication',
  npi: 'http://hl7.org/fhir/sid/us-npi',
  icd10cm: 'http://hl7.org/fhir/sid/icd-10-cm',
  rxnorm: 'http://www.nlm.nih.gov/research/umls/rxnorm',
  ndc: 'http://hl7.org/fhir/sid/ndc',
  loinc: 'http://loinc.org',
  snomed: 'http://snomed.info/sct',
  ucum: 'http://unitsofmeasure.org',
  v2IdentifierType: 'http://terminology.hl7.org/CodeSystem/v2-0203',
  actCode: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
  confidentiality: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
  conditionClinical: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
  conditionVerification: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
  conditionCategory: 'http://terminology.hl7.org/CodeSystem/condition-category',
  allergyClinical: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
  allergyVerification: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
  observationCategory: 'http://terminology.hl7.org/CodeSystem/observation-category',
  usCoreDocCategory: 'http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category',
  locationPhysicalType: 'http://terminology.hl7.org/CodeSystem/location-physical-type',
} as const;

/** meta.source for rows downloaded from DrFirst Rcopia */
export const SOURCE_DRFIRST = 'urn:altrixs:source:drfirst';
export const SOURCE_ALTRIXS = 'urn:altrixs:source:altrixs';

/** MRN identifier system: MRNs are unique per organization, so the system names the org. */
export function mrnSystem(organizationId: string): string {
  return `urn:altrixs:organization:${organizationId}:mrn`;
}

export type FhirResource = {
  resourceType: string;
  id: string;
  meta?: {
    source?: string;
    tag?: Coding[];
    security?: Coding[];
  };
  [key: string]: unknown;
};

export type Coding = { system?: string; code?: string; display?: string };
export type CodeableConcept = { coding?: Coding[]; text?: string };
export type Reference = { reference: string; display?: string };

const FHIR_ID_RE = /^[A-Za-z0-9\-.]{1,64}$/;

/**
 * Stable FHIR logical id from our ids: parts joined with "-", characters outside
 * [A-Za-z0-9-.] replaced by "-". Ids longer than 64 chars become prefix + sha256 slice.
 */
export function fhirId(...parts: Array<string | number>): string {
  const raw = parts
    .map((p) => String(p).trim())
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-z0-9\-.]/g, '-');
  if (raw && FHIR_ID_RE.test(raw)) return raw;
  const digest = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40);
  const prefix = String(parts[0] ?? 'r').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'r';
  return `${prefix}-${digest}`;
}

export function isValidFhirId(id: string): boolean {
  return FHIR_ID_RE.test(id);
}

/**
 * Our row id as a FHIR id: unchanged when already valid (cuids are), otherwise sanitized with a
 * hash suffix so distinct ids never collide. Idempotent, so references and resource ids agree.
 */
export function safeId(raw: string): string {
  if (FHIR_ID_RE.test(raw)) return raw;
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 10);
  const base = raw.replace(/[^A-Za-z0-9\-.]/g, '-').slice(0, 52) || 'id';
  return `${base}-${digest}`;
}

export function ref(resourceType: string, id: string, display?: string | null): Reference {
  const reference = `${resourceType}/${safeId(id)}`;
  return display ? { reference, display } : { reference };
}

export function orgTag(organizationId: string): Coding {
  return { system: SYSTEMS.organizationTag, code: organizationId };
}

/** YYYY-MM-DD (UTC) */
export function fhirDate(d: Date | null | undefined): string | undefined {
  if (!d || Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

export function fhirDateTime(d: Date | null | undefined): string | undefined {
  if (!d || Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export function text(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/** Drop undefined / null / empty arrays / empty objects recursively (FHIR forbids empty elements). */
export function clean<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => clean(v)).filter((v) => !isEmpty(v)) as unknown as T;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const c = clean(v);
      if (!isEmpty(c)) out[k] = c;
    }
    return out as T;
  }
  return value;
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/** Canonical JSON (sorted keys) — the basis of the outbox hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** sha256 of the canonical resource (meta.versionId / meta.lastUpdated excluded: server-assigned). */
export function hashResource(resource: FhirResource): string {
  const meta = resource.meta ? { ...resource.meta } : undefined;
  if (meta) {
    delete (meta as Record<string, unknown>).versionId;
    delete (meta as Record<string, unknown>).lastUpdated;
  }
  return createHash('sha256').update(canonicalJson({ ...resource, meta })).digest('hex');
}

/** NPI: 10 digits with a valid Luhn check digit over the 80840 prefix. */
export function isValidNpi(raw: string | null | undefined): boolean {
  const npi = (raw || '').trim();
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = `80840${npi}`.split('').map(Number);
  let sum = 0;
  for (let i = digits.length - 1, alt = false; i >= 0; i--, alt = !alt) {
    let d = digits[i]!;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const ICD10_CM_RE = /^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;

/** "f41.1" / "F411" -> "F41.1"; anything that is not shaped like an ICD-10-CM code -> null. */
export function normalizeIcd10(raw: string | null | undefined): string | null {
  let code = (raw || '').trim().toUpperCase();
  if (!code) return null;
  if (/^[A-Z][0-9][0-9A-Z][0-9A-Z]{1,4}$/.test(code)) code = `${code.slice(0, 3)}.${code.slice(3)}`;
  return ICD10_CM_RE.test(code) ? code : null;
}

/** Split a person's display name into family / given (last token is family). */
export function splitName(full: string | null | undefined): { family?: string; given?: string[]; text?: string } {
  const t = (full || '').trim().replace(/\s+/g, ' ');
  if (!t) return {};
  const parts = t.split(' ');
  if (parts.length === 1) return { family: parts[0], text: t };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1), text: t };
}
