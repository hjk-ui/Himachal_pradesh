import { createHash } from 'node:crypto';
import {
  SOURCE_DRFIRST,
  SYSTEMS,
  fhirDate,
  fhirDateTime,
  fhirId,
  normalizeIcd10,
  ref,
  text,
  type FhirResource,
} from './common';
import { finalize, type MapContext } from './meta';
import type { ClientRow, MedicalProblemRow } from './types';

export type ClientDiagnosis = {
  /** Normalized ICD-10-CM code, or null when the entry is free text */
  code: string | null;
  display: string;
  rank: 'primary' | 'secondary';
};

/**
 * Client.primaryDiagnosisCode / primaryDiagnosis, plus Client.secondaryDiagnoses — a comma /
 * semicolon / newline list of "F41.1 - Generalized anxiety disorder" items. Duplicate codes once.
 */
export function clientDiagnoses(client: Pick<ClientRow, 'primaryDiagnosis' | 'primaryDiagnosisCode' | 'secondaryDiagnoses'>): ClientDiagnosis[] {
  const out: ClientDiagnosis[] = [];
  const seen = new Set<string>();
  const add = (rawCode: string, description: string, rank: ClientDiagnosis['rank'], original: string) => {
    const code = normalizeIcd10(rawCode);
    const key = code ?? `text:${original.trim().toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ code, display: (description.trim() || (code ? code : original.trim())).slice(0, 200), rank });
  };
  const primaryCode = client.primaryDiagnosisCode?.trim();
  if (primaryCode) add(primaryCode, client.primaryDiagnosis?.trim() || '', 'primary', primaryCode);
  else if (client.primaryDiagnosis?.trim()) add('', client.primaryDiagnosis, 'primary', client.primaryDiagnosis);

  // ";" / newline always separate items; "," only when an ICD-10 code follows it
  // (descriptions such as "Major depressive disorder, recurrent, moderate" contain commas).
  const items = (client.secondaryDiagnoses || '')
    .split(/[;\n]/)
    .flatMap((seg) => seg.split(/,(?=\s*[A-Za-z][0-9][0-9A-Za-z](?:\.?[0-9A-Za-z]{1,4})?\b)/));
  for (const item of items) {
    const t = item.trim();
    if (!t) continue;
    const m = t.match(/^([A-Za-z0-9.]+)\s*(?:[-–:]\s*)?(.*)$/);
    if (m && normalizeIcd10(m[1])) add(m[1], m[2] || '', 'secondary', t);
    else add('', t, 'secondary', t);
  }
  return out;
}

function shortHash(v: string): string {
  return createHash('sha256').update(v).digest('hex').slice(0, 12);
}

export function clientDiagnosisId(clientId: string, dx: ClientDiagnosis): string {
  return dx.code ? fhirId('dx', clientId, dx.code) : fhirId('dx', clientId, 't', shortHash(dx.display.toLowerCase()));
}

function icdConcept(code: string | null, display: string) {
  return code
    ? { coding: [{ system: SYSTEMS.icd10cm, code, display: display !== code ? display : undefined }], text: display }
    : { text: display };
}

const CATEGORY_PROBLEM_LIST = {
  coding: [{ system: SYSTEMS.conditionCategory, code: 'problem-list-item', display: 'Problem List Item' }],
};

/** Client-level diagnosis (intake / chart header) -> Condition. */
export function mapClientDiagnosis(client: Pick<ClientRow, 'id'>, dx: ClientDiagnosis, ctx: MapContext): FhirResource {
  return finalize(
    {
      resourceType: 'Condition',
      id: clientDiagnosisId(client.id, dx),
      clinicalStatus: { coding: [{ system: SYSTEMS.conditionClinical, code: 'active' }] },
      verificationStatus: { coding: [{ system: SYSTEMS.conditionVerification, code: 'confirmed' }] },
      category: [CATEGORY_PROBLEM_LIST],
      code: icdConcept(dx.code, dx.display),
      subject: ref('Patient', client.id),
      note: dx.rank === 'primary' ? [{ text: 'Primary diagnosis' }] : undefined,
    },
    ctx,
    undefined
  );
}

export function problemClinicalStatus(status: string | null | undefined): 'active' | 'inactive' | 'resolved' | 'remission' {
  const s = (status || '').trim().toLowerCase();
  if (s === 'resolved') return 'resolved';
  if (s === 'inactive' || s === 'historical') return 'inactive';
  if (s.includes('remission')) return 'remission';
  return 'active';
}

/** MedicalProblem (local or DrFirst-downloaded) -> Condition. */
export function mapMedicalProblem(p: MedicalProblemRow, ctx: MapContext): FhirResource {
  const code = normalizeIcd10(p.icd10Code);
  const clinical = problemClinicalStatus(p.status);
  const fromDrFirst = (p.source || '').toLowerCase() === 'drfirst';
  return finalize(
    {
      resourceType: 'Condition',
      id: fhirId('mp', p.id),
      identifier: fromDrFirst && p.rcopiaProblemId ? [{ system: SYSTEMS.rcopiaProblem, value: p.rcopiaProblemId }] : undefined,
      clinicalStatus: { coding: [{ system: SYSTEMS.conditionClinical, code: clinical }] },
      verificationStatus: { coding: [{ system: SYSTEMS.conditionVerification, code: 'confirmed' }] },
      category: [CATEGORY_PROBLEM_LIST],
      code: icdConcept(code, text(p.name) || text(p.description) || p.icd10Code),
      subject: ref('Patient', p.clientId),
      onsetDateTime: fhirDate(p.onsetDate),
      abatementDateTime: clinical === 'resolved' ? fhirDate(p.resolvedDate) : undefined,
      recordedDate: fhirDateTime(p.createdAt),
    },
    ctx,
    fromDrFirst ? SOURCE_DRFIRST : undefined
  );
}
