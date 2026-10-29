import {
  SYSTEMS,
  fhirDate,
  mrnSystem,
  ref,
  safeId,
  text,
  type FhirResource,
} from './common';
import { finalize, type MapContext } from './meta';
import type { ClientRow } from './types';
import {
  DECLINED,
  ETHNICITY,
  GENDER_IDENTITY,
  LANGUAGES,
  MARITAL_STATUS,
  NULL_FLAVOR_SYSTEM,
  NULL_FLAVORS,
  OTHER,
  PRONOUNS,
  RACE,
  RELATIONSHIPS,
  SEX_AT_BIRTH,
  UNKNOWN,
  administrativeSexCode,
  codeLabel,
  fhirAdministrativeGender,
  normalizeStateCode,
  normalizeUsZip,
} from '@/lib/clients/demographics';

const ROLE_CODE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-RoleCode';

/** Administrative gender: only clear values map to male/female; declined/unknown -> unknown; else other. */
export function mapAdministrativeGender(raw: string | null | undefined): string | undefined {
  const g = (raw || '').trim().toLowerCase();
  if (!g) return undefined;
  if (g === 'm' || g === 'male' || g === 'man') return 'male';
  if (g === 'f' || g === 'female' || g === 'woman') return 'female';
  if (/unknown|declin|prefer not|not (specified|reported)|^u$/.test(g)) return 'unknown';
  return 'other';
}

function isValant(platform: string | null | undefined): boolean {
  return /valant/i.test(platform || '');
}

const US_CORE = 'http://hl7.org/fhir/us/core/StructureDefinition';
const CDC_RACE_SYSTEM = 'urn:oid:2.16.840.1.113883.6.238';

function nullFlavor(code: string): { system: string; code: string; display: string } {
  return { system: NULL_FLAVOR_SYSTEM, code, display: code === DECLINED ? 'asked but declined' : code === UNKNOWN ? 'unknown' : 'other' };
}

/** US Core race / ethnicity extension: ombCategory codings plus the required text */
function ombExtension(kind: 'race' | 'ethnicity', codes: string[]): unknown | undefined {
  const list = kind === 'race' ? RACE : ETHNICITY;
  const clean = codes.filter((c) => list.some((o) => o.code === c));
  if (!clean.length) return undefined;
  const ext = clean.map((c) => ({
    url: 'ombCategory',
    valueCoding: NULL_FLAVORS.has(c) ? nullFlavor(c) : { system: CDC_RACE_SYSTEM, code: c, display: codeLabel(list, c) },
  }));
  const textValue = clean.map((c) => codeLabel(list, c)).join(', ');
  return { url: `${US_CORE}/us-core-${kind}`, extension: [...ext, { url: 'text', valueString: textValue }] };
}

function codedConcept(list: { code: string; label: string }[], code: string, system: string) {
  return {
    coding: [NULL_FLAVORS.has(code) ? nullFlavor(code) : { system, code, display: codeLabel(list, code) }],
    text: codeLabel(list, code),
  };
}

/** Client -> Patient (US Core). Patient id = client id (same id the SMART/CRISP endpoints use). */
export function mapPatient(client: ClientRow, ctx: MapContext): FhirResource {
  const identifier: unknown[] = [
    { use: 'usual', system: SYSTEMS.client, value: client.id },
  ];
  if (client.mrn) {
    identifier.push({
      use: 'official',
      type: { coding: [{ system: SYSTEMS.v2IdentifierType, code: 'MR', display: 'Medical record number' }], text: 'MRN' },
      system: mrnSystem(ctx.organizationId),
      value: client.mrn,
    });
  }
  if (client.medicaidId?.trim()) {
    identifier.push({
      use: 'secondary',
      type: { coding: [{ system: SYSTEMS.v2IdentifierType, code: 'MA', display: 'Patient Medicaid number' }], text: 'Maryland Medicaid (MA) number' },
      system: SYSTEMS.marylandMedicaid,
      value: client.medicaidId.trim(),
    });
  }
  if (isValant(client.sourcePlatform) && client.sourceId) {
    identifier.push({ use: 'secondary', system: SYSTEMS.valant, value: client.sourceId, type: { text: 'Valant patient id' } });
  }

  // official = the structured legal name; usual = the preferred name. The display name is only
  // ever sent as text (never split into given / family).
  const names: unknown[] = [];
  const middle = text(client.legalMiddleName) || text(client.middleInitial);
  const legalGiven = [text(client.legalFirstName), middle].filter(Boolean) as string[];
  const legalFamily = text(client.legalLastName);
  const suffix = text(client.nameSuffix);
  const legalText = [...legalGiven, legalFamily, suffix].filter(Boolean).join(' ');
  if (legalFamily || legalGiven.length) {
    names.push({
      use: 'official',
      family: legalFamily,
      given: legalGiven,
      ...(suffix ? { suffix: [suffix] } : {}),
      text: legalText,
    });
  }
  const preferred = text(client.preferredName);
  if (preferred && preferred.toLowerCase() !== (text(client.legalFirstName) || '').toLowerCase()) {
    names.push({ use: 'usual', given: [preferred], ...(legalFamily ? { family: legalFamily } : {}), text: [preferred, legalFamily].filter(Boolean).join(' ') });
  } else {
    const display = text(client.name);
    if (display && display !== legalText) names.push({ use: names.length ? 'usual' : 'official', text: display });
  }

  const phoneUse = (t: string | null | undefined) => (t === 'mobile' || t === 'home' || t === 'work' ? t : undefined);
  const telecom = [
    client.phone ? { system: 'phone', value: client.phone.trim(), use: phoneUse(client.phoneType), rank: 1 } : null,
    client.phoneSecondary ? { system: 'phone', value: client.phoneSecondary.trim(), use: phoneUse(client.phoneSecondaryType), rank: 2 } : null,
    client.email ? { system: 'email', value: client.email.trim() } : null,
  ].filter(Boolean);

  const line = [text(client.addressLine1), text(client.addressLine2)].filter(Boolean) as string[];
  const hasAddress = line.length || client.city || client.state || client.postalCode;
  const address = hasAddress
    ? [{
        use: 'home',
        line,
        city: text(client.city),
        district: text(client.county),
        state: normalizeStateCode(client.state) ?? text(client.state),
        postalCode: normalizeUsZip(client.postalCode) ?? text(client.postalCode),
      }]
    : undefined;

  const relationship = (code: string | null | undefined) =>
    code && code !== OTHER ? { coding: [{ system: ROLE_CODE_SYSTEM, code, display: codeLabel(RELATIONSHIPS, code) }] } : null;
  const contact: unknown[] = [];
  if (client.emergencyContactName || client.emergencyContactPhone) {
    contact.push({
      relationship: [
        { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0131', code: 'C', display: 'Emergency Contact' }] },
        relationship(client.emergencyContactRelationship),
      ].filter(Boolean),
      name: client.emergencyContactName ? { text: client.emergencyContactName.trim() } : undefined,
      telecom: client.emergencyContactPhone ? [{ system: 'phone', value: client.emergencyContactPhone.trim() }] : undefined,
    });
  }
  if (client.guardianName || client.guardianPhone) {
    contact.push({
      relationship: [
        { coding: [{ system: ROLE_CODE_SYSTEM, code: 'GUARD', display: 'Legal guardian' }] },
        client.guardianRelationship !== 'GUARD' ? relationship(client.guardianRelationship) : null,
      ].filter(Boolean),
      name: client.guardianName ? { text: client.guardianName.trim() } : undefined,
      telecom: client.guardianPhone ? [{ system: 'phone', value: client.guardianPhone.trim() }] : undefined,
    });
  }

  const extension: unknown[] = [];
  const race = ombExtension('race', client.race ?? []);
  if (race) extension.push(race);
  const ethnicity = client.ethnicity ? ombExtension('ethnicity', [client.ethnicity]) : undefined;
  if (ethnicity) extension.push(ethnicity);
  if (client.sexAtBirth && SEX_AT_BIRTH.some((o) => o.code === client.sexAtBirth)) {
    extension.push({ url: `${US_CORE}/us-core-birthsex`, valueCode: client.sexAtBirth });
  }
  if (client.genderIdentity && GENDER_IDENTITY.some((o) => o.code === client.genderIdentity)) {
    extension.push({ url: `${US_CORE}/us-core-genderIdentity`, valueCodeableConcept: codedConcept(GENDER_IDENTITY, client.genderIdentity, SYSTEMS.snomed) });
  }
  if (client.pronouns && PRONOUNS.some((o) => o.code === client.pronouns)) {
    extension.push({
      url: 'http://hl7.org/fhir/StructureDefinition/individual-pronouns',
      extension: [{ url: 'value', valueCodeableConcept: codedConcept(PRONOUNS, client.pronouns, SYSTEMS.loinc) }],
    });
  }
  if (client.interpreterNeeded != null) {
    extension.push({ url: 'http://hl7.org/fhir/StructureDefinition/patient-interpreterRequired', valueBoolean: client.interpreterNeeded });
  }

  const lang = text(client.preferredLanguage);
  const langLabel = lang ? codeLabel(LANGUAGES, lang) : null;
  const communication = lang
    ? [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: lang, ...(langLabel ? { display: langLabel } : {}) }], text: langLabel ?? lang }, preferred: true }]
    : undefined;

  const ms = client.maritalStatus;
  const maritalStatus = ms && MARITAL_STATUS.some((o) => o.code === ms)
    ? codedConcept(MARITAL_STATUS, ms, 'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus')
    : undefined;

  // Structured administrative sex wins; the legacy free-text gender keeps its earlier mapping
  const gender = client.administrativeSex
    ? fhirAdministrativeGender(administrativeSexCode({ administrativeSex: client.administrativeSex }))
    : mapAdministrativeGender(client.gender);

  return finalize(
    {
      resourceType: 'Patient',
      id: safeId(client.id),
      ...(extension.length ? { extension } : {}),
      identifier,
      active: client.status === 'ACTIVE',
      name: names,
      telecom,
      gender,
      birthDate: fhirDate(client.dateOfBirth),
      ...(client.deceasedAt ? { deceasedDateTime: client.deceasedAt.toISOString() } : {}),
      address,
      maritalStatus,
      contact: contact.length ? contact : undefined,
      communication,
      generalPractitioner: client.assignedToId ? [ref('Practitioner', client.assignedToId)] : undefined,
      managingOrganization: ref('Organization', ctx.organizationId),
    },
    ctx
  );
}
