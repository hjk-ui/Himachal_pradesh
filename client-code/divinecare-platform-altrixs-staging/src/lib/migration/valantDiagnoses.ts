/**
 * Valant "Diagnoses - Patient" report (CSV export).
 *
 * One row per diagnosis: filter echo cells, then "Name (VALANTID)", ICD-10 code, description.
 * Like the appointments report, its columns reuse names (textBox1), so rows are read as raw
 * cells and fields are located by content.
 */

// ICD-10-CM shape: letter, digit, alphanumeric, optional dot + up to 4 alphanumerics
const ICD10_RE = /^[A-Z]\d[0-9A-Z](?:\.[0-9A-Z]{1,4})?$/;
const PATIENT_RE = /^(.*)\(([^()]+)\)\s*$/;

export type ValantDiagnosisRow =
  | { ok: true; sourcePatientId: string; code: string; description: string }
  | { ok: false; error: string };

export type PatientDiagnoses = {
  sourcePatientId: string;
  primary: { code: string; description: string };
  /** Codes only, in report order, without the primary or repeats */
  secondaryCodes: string[];
  /** Valant's description for each code (the client record keeps codes only; the list keeps both) */
  descriptions?: Record<string, string>;
};

export function parseValantDiagnosisRow(cells: string[]): ValantDiagnosisRow {
  const c = cells.map((v) => (v ?? '').trim());
  const patientIdx = c.findIndex((v) => PATIENT_RE.test(v) && !/:\s/.test(v));
  if (patientIdx < 0) return { ok: false, error: 'No patient with a Valant ID in parentheses' };
  const code = (c[patientIdx + 1] || '').toUpperCase();
  if (!ICD10_RE.test(code)) return { ok: false, error: `Not an ICD-10 code: ${code || '(blank)'}` };
  return {
    ok: true,
    sourcePatientId: c[patientIdx].match(PATIENT_RE)![2].trim().toUpperCase(),
    code,
    description: c[patientIdx + 2] || '',
  };
}

/** Valant ID of a raw row, for keeping one patient's rows together when uploading in chunks */
export function valantDiagnosisPatientId(cells: string[]): string | null {
  const cell = cells.find((v) => PATIENT_RE.test(v.trim()) && !/:\s/.test(v));
  return cell ? cell.trim().match(PATIENT_RE)![2].trim().toUpperCase() : null;
}

/**
 * Behavioral health practice: the first psychiatric (F) code in Valant's order is primary;
 * patients without one keep Valant's first-listed code.
 */
export function groupPatientDiagnoses(
  rows: { sourcePatientId: string; code: string; description: string }[]
): PatientDiagnoses[] {
  const byPatient = new Map<string, { code: string; description: string }[]>();
  for (const r of rows) {
    const list = byPatient.get(r.sourcePatientId) ?? [];
    if (!list.some((d) => d.code === r.code)) list.push({ code: r.code, description: r.description });
    byPatient.set(r.sourcePatientId, list);
  }
  return [...byPatient.entries()].map(([sourcePatientId, dx]) => {
    const primary = dx.find((d) => d.code.startsWith('F')) ?? dx[0];
    return {
      sourcePatientId,
      primary,
      secondaryCodes: dx.filter((d) => d !== primary).map((d) => d.code),
      descriptions: Object.fromEntries(dx.map((d) => [d.code, d.description])),
    };
  });
}
