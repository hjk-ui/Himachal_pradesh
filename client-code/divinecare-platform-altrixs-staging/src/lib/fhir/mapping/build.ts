/**
 * Build every FHIR resource one organization should have in HealthLake (pure).
 * Applies the 42 CFR Part 2 / SensitiveRecord rule from ./privacy for each resource.
 */
import { hashResource, normalizeIcd10, safeId, type FhirResource } from './common';
import { mapAllergyIntolerance } from './allergy';
import { clientDiagnoses, mapClientDiagnosis, mapMedicalProblem } from './condition';
import { isPart2Note, mapProgressNoteDocument } from './documentReference';
import { mapAppointmentEncounter, mapMedicalVisitEncounter } from './encounter';
import { mapMedicationStatement } from './medication';
import { mapAssessmentObservation } from './observation';
import { mapLocation, mapOrganization, mapPractitioner } from './organization';
import { mapPatient } from './patient';
import {
  classifyClient,
  isSudIcd10,
  isSudMedication,
  privacyDecision,
  type ClientPrivacy,
  type SyncSettings,
} from './privacy';
import type { OrgSnapshot } from './types';

export const FHIR_SYNC_TYPES = [
  'Organization',
  'Location',
  'Practitioner',
  'Patient',
  'Condition',
  'MedicationStatement',
  'AllergyIntolerance',
  'Encounter',
  'DocumentReference',
  'Observation',
] as const;
export type FhirSyncType = (typeof FHIR_SYNC_TYPES)[number];

/** Upserts run in this order (referenced resources first); deletes in reverse. */
export function typeRank(type: string): number {
  const i = (FHIR_SYNC_TYPES as readonly string[]).indexOf(type);
  return i < 0 ? FHIR_SYNC_TYPES.length : i;
}

export type BuiltResource = {
  resourceType: FhirSyncType;
  resourceId: string;
  sourceTable: string;
  sourceId: string;
  clientId: string | null;
  resource: FhirResource;
  hash: string;
};

export type BuildResult = {
  resources: BuiltResource[];
  /** reason -> count of items left out (never ids or content) */
  excluded: Record<string, number>;
};

const CLINICIAN_ROLES = new Set([
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
  'PRP_SPECIALIST',
  'CASE_MANAGER',
  'PEER_SUPPORT',
  'CLINICIAN',
  'PHYSICIAN',
  'MEDICAL_NP',
  'CRISIS_RESPONDER',
]);

export function buildOrgResources(snap: OrgSnapshot, settings: SyncSettings): BuildResult {
  const orgId = snap.organization.id;
  const resources: BuiltResource[] = [];
  const excluded: Record<string, number> = {};
  const exclude = (reason: string) => {
    excluded[reason] = (excluded[reason] ?? 0) + 1;
  };
  const userIds = new Set(snap.users.map((u) => u.id));
  const knownUser = (id: string | null | undefined) => (id && userIds.has(id) ? id : null);
  const referencedUsers = new Set<string>();

  const push = (
    resource: FhirResource | null,
    sourceTable: string,
    sourceId: string,
    clientId: string | null
  ) => {
    if (!resource) return;
    resources.push({
      resourceType: resource.resourceType as FhirSyncType,
      resourceId: resource.id,
      sourceTable,
      sourceId,
      clientId,
      resource,
      hash: hashResource(resource),
    });
    collectPractitionerRefs(resource, referencedUsers);
  };

  push(mapOrganization(snap.organization, { organizationId: orgId }), 'Organization', orgId, null);
  for (const loc of snap.locations) push(mapLocation(loc, { organizationId: orgId }), 'Location', loc.id, null);

  // Client privacy classification
  const part2NoteClients = new Set([
    ...(snap.part2NoteClientIds ?? []),
    ...snap.notes.filter((n) => isPart2Note(n)).map((n) => n.clientId),
  ]);
  const privacy = new Map<string, ClientPrivacy>();
  for (const c of snap.clients) {
    privacy.set(c.id, classifyClient({ sensitiveRecord: c.sensitiveRecord, hasPart2Note: part2NoteClients.has(c.id) }));
  }
  const decide = (clientId: string, part2Content: boolean) => {
    const d = privacyDecision(privacy.get(clientId) ?? null, part2Content, settings);
    if (!d.include) exclude(d.reason ?? 'excluded');
    return d;
  };
  const inOrg = (clientId: string | null | undefined): clientId is string => !!clientId && privacy.has(clientId);

  const includedPatients = new Set<string>();
  for (const c of snap.clients) {
    const d = decide(c.id, false);
    if (!d.include) continue;
    includedPatients.add(c.id);
    push(
      mapPatient({ ...c, assignedToId: knownUser(c.assignedToId) }, { organizationId: orgId, security: d.security }),
      'Client',
      c.id,
      c.id
    );
  }
  const patientOk = (clientId: string | null | undefined): clientId is string => inOrg(clientId) && includedPatients.has(clientId);

  // Conditions: MedicalProblem rows, then client-level diagnoses not already on the problem list
  const problemCodes = new Map<string, Set<string>>();
  for (const p of snap.problems) {
    if (!patientOk(p.clientId)) continue;
    const d = decide(p.clientId, isSudIcd10(p.icd10Code));
    if (!d.include) continue;
    push(mapMedicalProblem(p, { organizationId: orgId, security: d.security }), 'MedicalProblem', p.id, p.clientId);
    const set = problemCodes.get(p.clientId) ?? new Set<string>();
    // Uncoded problems ("needs coding") never suppress a client-level diagnosis
    const code = normalizeIcd10(p.icd10Code) ?? (p.icd10Code ?? '').trim().toUpperCase();
    if (code) set.add(code);
    problemCodes.set(p.clientId, set);
  }
  for (const c of snap.clients) {
    if (!patientOk(c.id)) continue;
    for (const dx of clientDiagnoses(c)) {
      if (dx.code && problemCodes.get(c.id)?.has(dx.code)) continue;
      const d = decide(c.id, isSudIcd10(dx.code));
      if (!d.include) continue;
      push(mapClientDiagnosis(c, dx, { organizationId: orgId, security: d.security }), 'Client.diagnosis', c.id, c.id);
    }
  }

  for (const m of snap.medications) {
    if (!patientOk(m.clientId)) continue;
    const d = decide(m.clientId, isSudMedication([m.medicationName, m.drugName, m.genericName, m.brandName]));
    if (!d.include) continue;
    push(
      mapMedicationStatement({ ...m, prescribedById: knownUser(m.prescribedById) }, { organizationId: orgId, security: d.security }),
      'ClientMedication',
      m.id,
      m.clientId
    );
  }

  for (const a of snap.allergies) {
    if (!patientOk(a.clientId)) continue;
    const d = decide(a.clientId, false);
    if (!d.include) continue;
    push(mapAllergyIntolerance(a, { organizationId: orgId, security: d.security }), 'MedicalAllergy', a.id, a.clientId);
  }

  for (const a of snap.appointments) {
    if (!patientOk(a.clientId)) continue;
    const d = decide(a.clientId, false);
    if (!d.include) continue;
    push(
      mapAppointmentEncounter({ ...a, clinicianId: knownUser(a.clinicianId) }, { organizationId: orgId, security: d.security }),
      'Appointment',
      a.id,
      a.clientId
    );
  }

  for (const v of snap.medicalVisits) {
    if (!patientOk(v.clientId)) continue;
    const hasSud = v.icd10Codes.some(isSudIcd10);
    // A visit is not itself Part 2 content; its SUD reason codes are, so they are dropped when not allowed.
    const d = decide(v.clientId, hasSud && settings.allowPart2Sync);
    if (!d.include) continue;
    const codes = settings.allowPart2Sync ? v.icd10Codes : v.icd10Codes.filter((c) => !isSudIcd10(c));
    if (hasSud && !settings.allowPart2Sync) exclude('part2_reason_codes_dropped');
    push(
      mapMedicalVisitEncounter({ ...v, providerId: knownUser(v.providerId) }, codes, { organizationId: orgId, security: d.security }),
      'MedicalVisit',
      v.id,
      v.clientId
    );
  }

  for (const n of snap.notes) {
    if (!patientOk(n.clientId)) continue;
    if (n.workflow?.status !== 'SIGNED' && n.workflow?.status !== 'LOCKED') {
      exclude('note_not_signed');
      continue;
    }
    const d = decide(n.clientId, isPart2Note(n));
    if (!d.include) continue;
    const wf = n.workflow ? { ...n.workflow, signedById: knownUser(n.workflow.signedById) } : null;
    push(
      mapProgressNoteDocument({ ...n, clinicianId: knownUser(n.clinicianId), workflow: wf }, { organizationId: orgId, security: d.security }),
      'ProgressNote',
      n.id,
      n.clientId
    );
  }

  for (const a of snap.assessments) {
    if (!patientOk(a.clientId)) continue;
    const d = decide(a.clientId, false);
    if (!d.include) continue;
    const obs = mapAssessmentObservation({ ...a, administeredById: knownUser(a.administeredById) }, { organizationId: orgId, security: d.security });
    if (!obs) {
      exclude('assessment_not_mapped');
      continue;
    }
    push(obs, 'ClinicalAssessmentRecord', a.id, a.clientId);
  }

  // Practitioners: clinicians plus any staff user a synced resource references
  for (const u of snap.users) {
    if (!CLINICIAN_ROLES.has(u.role) && !referencedUsers.has(safeId(u.id))) continue;
    push(mapPractitioner(u, { organizationId: orgId }), 'User', u.id, null);
  }

  resources.sort((a, b) => typeRank(a.resourceType) - typeRank(b.resourceType));
  return { resources, excluded };
}

function collectPractitionerRefs(value: unknown, out: Set<string>) {
  if (Array.isArray(value)) {
    for (const v of value) collectPractitionerRefs(v, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'reference' && typeof v === 'string' && v.startsWith('Practitioner/')) out.add(v.slice('Practitioner/'.length));
      else collectPractitionerRefs(v, out);
    }
  }
}

/** NDJSON for HealthLake $import: one line per resource, grouped by type. */
export function toNdjsonByType(resources: BuiltResource[]): Map<string, string> {
  const out = new Map<string, string[]>();
  for (const r of resources) {
    const lines = out.get(r.resourceType) ?? [];
    lines.push(JSON.stringify(r.resource));
    out.set(r.resourceType, lines);
  }
  return new Map([...out].map(([k, v]) => [k, `${v.join('\n')}\n`]));
}
