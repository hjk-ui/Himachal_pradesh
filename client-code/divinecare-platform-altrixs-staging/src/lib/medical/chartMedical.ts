/**
 * Client chart, Medical tab group: shapes for the per-client sections (pure, testable).
 * Only what is stored is returned; nothing is estimated or filled in.
 */

type VitalRow = {
  id: string;
  recordedAt: Date;
  systolic: number | null;
  bpSystolic: number | null;
  diastolic: number | null;
  bpDiastolic: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  respRate: number | null;
  temperature: number | null;
  spO2: number | null;
  o2Sat: number | null;
  weightLbs: number | null;
  heightInches: number | null;
  bmi: number | null;
  recordedBy: { name: string | null } | null;
};

/** MedicalVital has duplicate legacy columns (systolic / bpSystolic …); first stored value wins */
export function vitalRowView(v: VitalRow) {
  return {
    id: v.id,
    recordedAt: v.recordedAt.toISOString(),
    recordedBy: v.recordedBy?.name ?? null,
    systolic: v.systolic ?? v.bpSystolic,
    diastolic: v.diastolic ?? v.bpDiastolic,
    heartRate: v.heartRate,
    respRate: v.respRate ?? v.respiratoryRate,
    temperatureF: v.temperature,
    spO2: v.spO2 ?? v.o2Sat,
    weightLbs: v.weightLbs,
    heightInches: v.heightInches,
    bmi: v.bmi,
  };
}

type AllergyRow = {
  id: string;
  allergen: string;
  reaction: string | null;
  severity: string;
  status: string;
  source: string | null;
  createdAt: Date;
  /** drug / food / environmental (null = not classified); RxNorm code for drug allergies */
  allergenType?: string | null;
  rxnormId?: string | null;
  rxnormName?: string | null;
};

/**
 * A problem with no ICD-10 code on file needs coding by a provider: intake history entered as text
 * (stored uncoded, never guessed), or a DrFirst problem sent as ICD-9 / SNOMED only ('').
 */
export function problemNeedsCoding(icd10Code: string | null | undefined): boolean {
  return !(icd10Code ?? '').trim();
}

type ProblemRow = {
  id: string;
  icd10Code: string | null;
  name: string;
  status: string;
  isChronic: boolean;
  onsetDate: Date | null;
  resolvedDate: Date | null;
  source: string | null;
};

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Medical history tab: every allergy on file (active and inactive) and past medical history
 * (resolved problems). Active problems are NOT repeated here; they are in "Diagnoses & problems".
 */
export function medicalHistoryView(input: { allergies: AllergyRow[]; problems: ProblemRow[] }) {
  const resolved = input.problems.filter((p) => p.status === 'Resolved' || Boolean(p.resolvedDate));
  return {
    allergies: input.allergies.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    pastProblems: resolved.map((p) => ({
      ...p,
      onsetDate: day(p.onsetDate),
      resolvedDate: day(p.resolvedDate),
      needsCoding: problemNeedsCoding(p.icd10Code),
    })),
    activeProblemCount: input.problems.length - resolved.length,
  };
}
