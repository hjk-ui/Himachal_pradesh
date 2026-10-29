import { apiJson } from '@/lib/api-client';
import type { MedicationSource } from '@/lib/clinical/medicationSource';
import type {
  MedicalAllergy,
  MedicalLabResult,
  MedicalMedication,
  MedicalPatient,
  MedicalProblem,
  MedicalVisitSummary,
  MedicalVitalRecord,
  SomaticStatus,
} from './types';

/**
 * Server-backed reads and writes for the Medical module. Everything here goes through
 * /api/medical/** (org-scoped); nothing is written to browser storage.
 */

type Row = Record<string, any>;

const PROBLEM_STATUSES: SomaticStatus[] = ['Active', 'Chronic', 'Acute', 'Resolved', 'Monitoring'];
const PROBLEM_CATEGORIES: MedicalProblem['category'][] = [
  'Cardiovascular',
  'Endocrine',
  'Respiratory',
  'Renal',
  'GI',
  'Musculoskeletal',
  'Neurological',
  'Other',
];

function isoDate(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function numOrNull(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function num(...vals: unknown[]): number {
  return numOrNull(...vals) ?? 0;
}

export function mapProblem(p: Row): MedicalProblem {
  const rawStatus = p.isChronic && p.status !== 'Resolved' ? 'Chronic' : p.status || 'Active';
  return {
    id: p.id,
    icd10: p.icd10Code || p.icd10 || '',
    needsCoding: !(p.icd10Code || p.icd10 || '').trim(),
    description: p.name || p.description || p.icd10Code || '',
    onsetDate: isoDate(p.onsetDate),
    status: (PROBLEM_STATUSES as string[]).includes(rawStatus) ? (rawStatus as SomaticStatus) : 'Active',
    category: (PROBLEM_CATEGORIES as string[]).includes(p.category)
      ? (p.category as MedicalProblem['category'])
      : 'Other',
    notes: p.notes || undefined,
  };
}

export function mapVital(v: Row): MedicalVitalRecord {
  return {
    id: v.id,
    recordedAt: v.recordedAt ? new Date(v.recordedAt).toISOString() : '',
    recordedBy: v.recordedBy?.name || '',
    systolic: numOrNull(v.systolic, v.bpSystolic),
    diastolic: numOrNull(v.diastolic, v.bpDiastolic),
    heartRate: numOrNull(v.heartRate),
    respRate: numOrNull(v.respRate, v.respiratoryRate),
    temperatureF: numOrNull(v.temperature, v.temperatureF),
    heightInches: numOrNull(v.heightInches),
    weightLbs: numOrNull(v.weightLbs),
    bmi: numOrNull(v.bmi),
    oxygenSat: numOrNull(v.spO2, v.o2Sat, v.oxygenSat),
  };
}

export function mapMedication(m: Row): MedicalMedication {
  return {
    id: m.id,
    name: m.drugName || m.medicationName || m.genericName || '',
    dosage: m.dosageText || m.dosage || '',
    route: m.route || '',
    frequency: m.frequency || '',
    refills: num(m.refills),
    indication: m.indication || '',
    startDate: isoDate(m.startDate),
    status: m.active === false ? 'Discontinued' : 'Active',
    prescribedBy: m.prescriberName || '',
    rxNorm: m.rxnormId || undefined,
    instructions: m.instructions || '',
    source: m.source || undefined,
  };
}

export function mapAllergy(a: Row): MedicalAllergy {
  const sev: MedicalAllergy['severity'] = ['Severe/Anaphylaxis', 'Moderate', 'Mild'].includes(a.severity)
    ? a.severity
    : 'Unspecified';
  return {
    id: a.id,
    substance: a.allergen || a.substance || '',
    reaction: a.reaction || '',
    severity: sev,
    onsetDate: isoDate(a.createdAt),
    source: a.source || undefined,
  };
}

export function mapVisit(v: Row): MedicalVisitSummary {
  return {
    id: v.id,
    visitDate: isoDate(v.visitDate),
    visitType: v.visitType || '',
    providerName: v.providerName || '',
    cptCode: v.cptCode || '',
    cptModifiers: Array.isArray(v.cptModifiers) ? v.cptModifiers : [],
    icd10Codes: Array.isArray(v.icd10Codes) ? v.icd10Codes : [],
    subjective: v.subjective || '',
    objective: v.objective || '',
    assessment: v.assessment || '',
    plan: v.plan || '',
    status: v.status || '',
    signedAt: v.signedAt ? new Date(v.signedAt).toISOString() : undefined,
  };
}

function labFlag(flag: string): MedicalLabResult['flag'] {
  if (flag === 'HH' || flag === 'LL') return 'Critical/Panic';
  if (flag === 'H') return 'High';
  if (flag === 'L') return 'Low';
  return 'Normal';
}

/** Flattens LabOrder rows (with results) into the module's lab-result shape. */
export function mapLabOrders(orders: Row[]): MedicalLabResult[] {
  const out: MedicalLabResult[] = [];
  for (const o of orders || []) {
    for (const r of o.results || []) {
      out.push({
        id: r.id,
        testName: r.testName,
        loincCode: '',
        value: String(r.value ?? ''),
        numericValue: num(r.value),
        unit: r.unit || '',
        referenceRange: r.refRange || '',
        flag: labFlag(r.flag),
        collectionDate: isoDate(o.collectedAt),
        resultDate: isoDate(o.resultedAt || r.createdAt),
        orderingClinician: o.orderedByName || '',
        sparklineHistory: [],
      });
    }
  }
  return out;
}

/** Roster from /api/medical/patients (problems included; other sections load per chart). */
export async function fetchMedicalPatients(): Promise<MedicalPatient[]> {
  const data = await apiJson<{ patients: MedicalPatient[] }>('/api/medical/patients');
  return Array.isArray(data.patients) ? data.patients : [];
}

/** Full chart for one patient, merged onto a roster entry when one is supplied. */
export async function fetchMedicalChart(
  patientId: string,
  base?: MedicalPatient
): Promise<MedicalPatient> {
  const data = await apiJson<Row>(`/api/medical/patients/${encodeURIComponent(patientId)}/chart`);
  const raw: Row = data.patient || {};
  const dob = raw.dob || base?.dob || '';
  const birthYear = parseInt(String(dob).slice(0, 4), 10);
  const age = birthYear ? Math.max(0, new Date().getFullYear() - birthYear) : 0;
  const visits = (data.visits || []).map(mapVisit);
  const bh = raw.behavioralHealthCrossReference;

  const fallback: MedicalPatient = {
    id: raw.id || patientId,
    mrn: raw.mrn || '',
    name: raw.name || '',
    dob,
    age,
    gender: raw.gender || 'Unknown',
    pronouns: '',
    pcp: raw.assignedPcp || '',
    phone: raw.phone || '',
    email: raw.email || '',
    hasCareGaps: Boolean(raw.hba1cOverdue || raw.egfrDeclining),
    hasAbnormalLabs: false,
    lastVisit: '—',
    demographics: {
      legalName: raw.name || '',
      preferredName: raw.name || '',
      dateOfBirth: dob,
      sexAtBirth: 'Unknown',
      genderIdentity: raw.gender || 'Unknown',
      sexualOrientation: 'Not specified',
      pronouns: 'Not specified',
      ombRace: 'Not specified',
      ombEthnicity: 'Not specified',
      preferredLanguage: 'Not specified',
      interpreterNeeded: false,
      portalStatus: 'Invited',
      primaryInsurance: {
        payerName: raw.primaryPayer || '',
        payerId: '',
        memberId: '',
        groupNumber: '',
        subscriberName: raw.name || '',
        subscriberDob: dob,
        relationship: 'Self',
      },
      guarantor: { name: raw.name || '', relationship: 'Self', phone: raw.phone || '', address: raw.address || '' },
      emergencyContacts: [],
      codeStatus: 'Not Documented',
      advanceDirectives: { hasLivingWill: false, hasPOLST: false },
      chartFlags: [],
    },
    problems: [],
    medications: [],
    allergies: [],
    vitals: [],
    labs: [],
    preventiveCare: [],
    referrals: [],
    encounters: [],
  };

  const labs = mapLabOrders(data.labs || []);
  return {
    ...(base || fallback),
    legalFirstName: raw.legalFirstName ?? null,
    middleInitial: raw.middleInitial ?? null,
    legalLastName: raw.legalLastName ?? null,
    clientId: data.clientId ?? base?.clientId ?? null,
    problems: (data.problems || []).map(mapProblem),
    medications: (data.medications || []).map(mapMedication),
    allergies: (data.allergies || []).map(mapAllergy),
    vitals: (data.vitals || []).map(mapVital),
    labs,
    hasAbnormalLabs: labs.some((l) => l.flag !== 'Normal'),
    hasCriticalPanicLab: labs.some((l) => l.flag === 'Critical/Panic'),
    visits,
    lastVisit: visits[0]?.visitDate || base?.lastVisit || '—',
    bhCrossReference: bh
      ? { hasBhChart: true, bhClientId: bh.bhClientId, hasPart2Consent: Boolean(bh.part2ConsentOnFile) }
      : { hasBhChart: false, hasPart2Consent: false },
  };
}

const patientPath = (patientId: string) => `/api/medical/patients/${encodeURIComponent(patientId)}`;

function post<T>(url: string, body: unknown, method = 'POST') {
  return apiJson<T>(url, { method, body: JSON.stringify(body) });
}

export function createProblem(
  patientId: string,
  body: { icd10: string; description: string; status: SomaticStatus; category?: string; onsetDate?: string; notes?: string }
) {
  return post<{ problem: Row }>(`${patientPath(patientId)}/problems`, body);
}

/** Set the ICD-10-CM code on an uncoded ("needs coding") problem; the server validates the code */
export function setProblemCode(patientId: string, problemId: string, icd10: string) {
  return post<{ problem: Row }>(
    `${patientPath(patientId)}/problems/${encodeURIComponent(problemId)}`,
    { icd10 },
    'PATCH'
  );
}

export function updateProblemStatus(patientId: string, problemId: string, status: SomaticStatus) {
  return post<{ problem: Row }>(
    `${patientPath(patientId)}/problems/${encodeURIComponent(problemId)}`,
    { status },
    'PATCH'
  );
}

export type VitalsPayload = {
  systolic: number;
  diastolic: number;
  heartRate: number;
  respRate: number;
  temperatureF: number;
  heightInches: number;
  weightLbs: number;
  oxygenSat: number;
};

export function createVitals(patientId: string, body: VitalsPayload) {
  return post<{ vital: Row }>(`${patientPath(patientId)}/vitals`, body);
}

export function createAllergy(
  patientId: string,
  body: { substance: string; reaction?: string; severity: Exclude<MedicalAllergy['severity'], 'Unspecified'> }
) {
  return post<{ allergy: Row }>(`${patientPath(patientId)}/allergies`, body);
}

export function createMedication(
  patientId: string,
  body: {
    medicationName: string;
    dosage: string;
    frequency?: string;
    route?: string;
    indication?: string;
    instructions?: string;
    source: MedicationSource;
  }
) {
  return post<{ medication: Row }>(`${patientPath(patientId)}/medications`, body);
}

export function discontinueMedication(patientId: string, medId: string) {
  return post<{ medication: Row }>(
    `${patientPath(patientId)}/medications/${encodeURIComponent(medId)}`,
    { action: 'discontinue' },
    'PATCH'
  );
}

export function signVisit(
  patientId: string,
  body: {
    visitType: string;
    isTelehealth: boolean;
    chiefComplaint?: string;
    subjective: string;
    objective?: string;
    assessment?: string;
    plan?: string;
    cptCode?: string;
    icd10Codes: string[];
    /** omitted when the MA filed this appointment's vitals at rooming */
    vitals?: VitalsPayload;
    appointmentId?: string | null;
  }
) {
  return post<{ visit: Row; clientId?: string; pcpSuggestion?: { userId: string; displayName: string } | null }>(`${patientPath(patientId)}/visits`, body);
}
