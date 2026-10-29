import { ASSESSMENT_CATALOG, type AssessmentInstrument } from '@/features/ehr/assessments/catalog';

/**
 * Measures-to-patients instruments come straight from the EHR assessment catalog.
 * Nothing is hardcoded here: if the catalog has no digital item content for an
 * instrument, assignments are marked itemContentPending and nothing is sent.
 */

export type PatientQuestion = {
  id: string;
  text: string;
  note?: string;
  options: { label: string; score: number; flagged?: boolean }[];
};

export type PatientInstrument = {
  key: string;
  name: string;
  fullName: string;
  questions: PatientQuestion[];
};

export type InstrumentOption = {
  key: string;
  name: string;
  fullName: string;
  /** false → item content pending; can be assigned but not sent */
  sendable: boolean;
};

export function getInstrument(key: string): AssessmentInstrument | undefined {
  return ASSESSMENT_CATALOG.find((i) => i.id === key);
}

function isSendable(i: AssessmentInstrument): boolean {
  return i.adminType === 'Self-Report' && i.hasDigitalQuestionnaire && Boolean(i.questions?.length);
}

/** Self-report instruments staff may assign. */
export function listInstrumentOptions(): InstrumentOption[] {
  return ASSESSMENT_CATALOG.filter((i) => i.adminType === 'Self-Report').map((i) => ({
    key: i.id,
    name: i.name,
    fullName: i.fullName,
    sendable: isSendable(i),
  }));
}

export function isKnownSelfReportInstrument(key: string): boolean {
  const i = getInstrument(key);
  return Boolean(i && i.adminType === 'Self-Report');
}

/** True when the patient cannot be shown real item content for this instrument. */
export function itemContentPendingFor(key: string): boolean {
  const i = getInstrument(key);
  return !i || !isSendable(i);
}

export function getPatientInstrument(key: string): PatientInstrument | null {
  const i = getInstrument(key);
  if (!i || !isSendable(i) || !i.questions) return null;
  return {
    key: i.id,
    name: i.name,
    fullName: i.fullName,
    questions: i.questions.map((q) => ({
      id: q.id,
      text: q.text,
      note: q.note,
      options: q.options.map((o) => ({ label: o.label, score: o.score, flagged: o.flagged })),
    })),
  };
}

export type AnswerCheck =
  | { ok: true; answers: Record<string, number> }
  | { ok: false; error: string };

/**
 * Validates patient answers against the instrument. Unknown question ids and scores that
 * are not an offered option are rejected; `complete` additionally requires every item.
 */
export function validateAnswers(
  instrument: PatientInstrument,
  raw: unknown,
  opts: { complete: boolean }
): AnswerCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Answers are invalid.' };
  }
  const byId = new Map(instrument.questions.map((q) => [q.id, q]));
  const clean: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const q = byId.get(id);
    if (!q || typeof value !== 'number' || !q.options.some((o) => o.score === value)) {
      return { ok: false, error: 'Answers are invalid.' };
    }
    clean[id] = value;
  }
  if (opts.complete && instrument.questions.some((q) => !(q.id in clean))) {
    return { ok: false, error: 'Please answer every question.' };
  }
  return { ok: true, answers: clean };
}

export type PatientScore = {
  totalScore: number;
  severity: string;
  /** Safety item answered above zero (PHQ-9 item 9 and catalog-defined safety items) */
  crisis: boolean;
};

export function scorePatientAnswers(key: string, answers: Record<string, number>): PatientScore | null {
  const i = getInstrument(key);
  if (!i) return null;
  const r = i.calculateResult(answers);
  const flaggedOption = Boolean(
    i.questions?.some((q) =>
      q.options.some((o) => o.flagged && answers[q.id] === o.score)
    )
  );
  return { totalScore: r.totalScore, severity: r.severity, crisis: r.safetyFlagged || flaggedOption };
}

/** Live crisis check while the patient answers (no scoring needed). */
export function answersHaveCrisis(instrument: PatientInstrument, answers: Record<string, number>): boolean {
  return instrument.questions.some((q) =>
    q.options.some((o) => o.flagged && answers[q.id] === o.score)
  );
}
