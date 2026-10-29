/**
 * DESIGN ONLY — Valant patient measurement RESULTS import (scores and vitals over time).
 * Not built: we have no sample of the export yet, and its columns must not be guessed.
 * When the owner provides a de-identified sample (or the column list), implement
 * `parseValantMeasurementResults` against it and add POST /api/migration/measurement-results
 * following the measurement-types route (dry run, leadership gate, audit counts only).
 *
 * Target: MeasurementResult rows (prisma/schema.prisma), one per patient per measure per time.
 *   - measurementTypeId: resolved by (name, documentation code, data type, units) against the
 *     org's MeasurementType catalog (import the catalog first). A result whose type is not in the
 *     catalog is reported, never auto-created.
 *   - clientId: resolved through Client.sourcePlatform='valant' + sourceId (valantClientsById in
 *     referenceImport.ts). Unmatched patients are reported, not created.
 *   - Value: validated with validateMeasureValue (src/lib/clinical/measures.ts) using the type's
 *     data type; BP "120/80" -> valueNumeric 120 + valueSecondary 80; smoking status -> SNOMED code.
 *   - measuredAt: the Valant result date (time if present; date-only kept at 12:00 local to avoid
 *     day shifts).
 *   - source 'valant', sourceRef = Valant result id when the export has one, otherwise a hash of
 *     (patient id, type identity, measuredAt, raw value) — unique (organizationId, source, sourceRef)
 *     makes re-import idempotent.
 *   - Instrument totals (type.instrumentKey set and not a subscore) could also be mirrored into
 *     ClinicalAssessmentRecord so they appear in the instrument trend charts; decide with the owner.
 *   - Vitals with a MedicalVital column (type.vitalField) stay in MeasurementResult; MedicalVital
 *     rows require a full vitals panel and are not synthesized from single readings.
 */

export type ValantMeasurementResultRow = {
  /** 1-based spreadsheet line */
  line: number;
  /** Valant patient id (matches Client.sourceId) */
  valantPatientId: string;
  /** Measurement type identity as Valant shows it */
  measurementName: string;
  documentationCode: string | null;
  /** Raw value text as exported ("120/80", "14", "Never smoker") */
  rawValue: string;
  units: string | null;
  measuredAt: Date;
  /** Valant's own result id, when the export includes one */
  sourceResultId: string | null;
  /** Staff name who recorded it in Valant (kept as text; not matched to users) */
  recordedByName: string | null;
};

export type ValantMeasurementResultsParse = {
  headerOk: boolean;
  rows: number;
  results: ValantMeasurementResultRow[];
  errors: { line: number; error: string }[];
};

export type MeasurementResultsImportReport = {
  dryRun: boolean;
  rows: number;
  /** Would be (or were) created */
  newCount: number;
  /** Same sourceRef already imported */
  alreadyImported: number;
  unmatchedPatients: number;
  /** Measurement names not in the org's catalog: import the catalog first */
  unknownTypes: { name: string; rows: number }[];
  invalidValues: { line: number; error: string }[];
  byType: Record<string, number>;
  jobId: string | null;
};

/** Implemented when a sample export is available. */
export type ParseValantMeasurementResults = (records: string[][]) => ValantMeasurementResultsParse;
