/**
 * AI Scribe practice settings and clinician preferences. Pure, browser-safe.
 *
 * Practice settings (one row per organization, table ScribeSettings):
 *   enabled                  scribe on / off for the practice
 *   deleteTranscriptOnSign   default ON (matches Valant, the more private default): the transcript
 *                            segments, AI drafts and summary text are deleted as soon as the note
 *                            created from the capture is signed
 *   transcriptRetentionDays  fallback (default 30): with delete-on-sign off, transcripts are deleted
 *                            this many days after the note is signed; sessions that never became a
 *                            signed note are deleted this many days after capture stopped.
 *   defaultFormat            note format preselected for new sessions
 *   clientSummarySharing     clinicians may share an approved plain-language summary to the portal
 *   liveCuesDefault          in-session cues on by default (each clinician can turn them off)
 *   transcriptionEngine      'standard' (default): Amazon Transcribe streaming with the practice's
 *                            behavioral-health custom vocabulary (SCRIBE_TRANSCRIBE_VOCABULARY);
 *                            'medical': Amazon Transcribe Medical streaming (higher cost).
 *                            Both are HIPAA-eligible under the AWS BAA.
 * Recording consent is always required (Maryland all-party consent) and is not a setting.
 *
 * Raw audio is never stored: the browser streams it to AWS Transcribe (or Chime sends the meeting
 * audio to Transcribe inside AWS) and only the text comes back.
 */
import { z } from 'zod';
import { RECORDING_CONSENT_REQUIRED } from './consent';

export const SCRIBE_FORMATS = [
  'THERAPY_PROGRESS',
  'THERAPY_INTAKE',
  'SUD_INTAKE',
  'TREATMENT_PLAN_REVIEW',
  'SOAP',
  'DAP',
  'BIRP',
  'GIRP',
  'PIRP',
  // Prescriber templates (same note types / section headings as the Notes editor; formatCatalog.ts)
  'PSYCH_MED_MGMT',
  'MED_MGMT',
  'PSYCH_EVAL',
  'ADULT_PSYCH_INTAKE',
  'ADULT_PSYCH_REEVAL',
  'CHILD_PSYCH_INTAKE',
  'CHILD_PSYCH_REEVAL',
  // Medical (primary care) visit
  'PRIMARY_CARE_SOAP',
  // Other note templates the EHR uses
  'PIE',
  'CBT',
  'DBT',
  'MFT',
  'EMDR',
  'CLINICAL_INTAKE',
  'SUD_NOTE',
  'CRISIS',
  'COLLATERAL',
  'TELEPHONE',
  'DISCHARGE',
  'PRP',
  'PEER_SUPPORT',
] as const;
export type ScribeFormat = (typeof SCRIBE_FORMATS)[number];

export const SCRIBE_FORMAT_LABELS: Record<ScribeFormat, string> = {
  THERAPY_PROGRESS: 'Therapy Progress (90832 / 90834 / 90837)',
  THERAPY_INTAKE: 'MD Therapy Adult & Child Intake (90791)',
  SUD_INTAKE: 'Substance Abuse Intake (90791)',
  TREATMENT_PLAN_REVIEW: 'Treatment Plan update',
  SOAP: 'SOAP',
  DAP: 'DAP',
  BIRP: 'BIRP',
  GIRP: 'GIRP',
  PIRP: 'PIRP',
  PSYCH_MED_MGMT: 'Psychiatric Med Management / follow-up (E/M ± 90833 / 90836 / 90838)',
  MED_MGMT: 'Medication Management (E/M)',
  PSYCH_EVAL: 'Psychiatric Evaluation (90792)',
  ADULT_PSYCH_INTAKE: 'Adult Psychiatry Intake (90792 / new-patient E/M)',
  ADULT_PSYCH_REEVAL: 'Adult Psychiatry Re-Eval',
  CHILD_PSYCH_INTAKE: 'Child Psychiatry Intake (90792 / new-patient E/M)',
  CHILD_PSYCH_REEVAL: 'Child Psychiatry Re-Eval',
  PRIMARY_CARE_SOAP: 'Primary care SOAP (E/M)',
  PIE: 'PIE',
  CBT: 'CBT Session Note',
  DBT: 'DBT Session Note',
  MFT: 'Marriage & Family Therapy',
  EMDR: 'EMDR Note',
  CLINICAL_INTAKE: 'Clinical Intake Assessment (90791)',
  SUD_NOTE: 'SUD / Substance Use Note',
  CRISIS: 'Crisis Intervention Note',
  COLLATERAL: 'Collateral Contact Note',
  TELEPHONE: 'Telephone Encounter',
  DISCHARGE: 'Discharge Summary',
  PRP: 'PRP Progress Note',
  PEER_SUPPORT: 'Peer Support Contact Note',
};

/** Speech-to-text engine for live capture. Standard is the default (owner decision 2026-10-20: AI Scribe economics). */
export const TRANSCRIPTION_ENGINES = ['standard', 'medical'] as const;
export type TranscriptionEngine = (typeof TRANSCRIPTION_ENGINES)[number];
export const DEFAULT_TRANSCRIPTION_ENGINE: TranscriptionEngine = 'standard';

export const TRANSCRIPTION_ENGINE_LABELS: Record<TranscriptionEngine, string> = {
  standard: 'Amazon Transcribe (standard)',
  medical: 'Amazon Transcribe Medical',
};
/** One-line note shown beside the choice in the settings card. */
export const TRANSCRIPTION_ENGINE_NOTES: Record<TranscriptionEngine, string> = {
  standard: 'Lower cost. General medical vocabulary plus the practice vocabulary of behavioral health terms and psychiatric medications.',
  medical: 'Higher accuracy on clinical terms, at a higher cost per minute.',
};

export function isTranscriptionEngine(v: unknown): v is TranscriptionEngine {
  return typeof v === 'string' && (TRANSCRIPTION_ENGINES as readonly string[]).includes(v);
}

/**
 * Value stored on scribe_captures.engine. Fixed when the capture is created, so a capture resumed
 * after the practice changes the setting keeps the engine it started with.
 */
export type CaptureEngine = 'transcribe_streaming' | 'transcribe_medical_streaming' | 'chime_transcribe' | 'chime_transcribe_medical';

export function captureEngineFor(mode: string, engine: TranscriptionEngine): CaptureEngine {
  if (mode === 'telehealth') return engine === 'medical' ? 'chime_transcribe_medical' : 'chime_transcribe';
  return engine === 'medical' ? 'transcribe_medical_streaming' : 'transcribe_streaming';
}

/** Engine of an existing capture. Captures created before the setting existed were all Transcribe Medical. */
export function transcriptionEngineOfCapture(captureEngine: string | null | undefined): TranscriptionEngine {
  return captureEngine === 'transcribe_streaming' || captureEngine === 'chime_transcribe' ? 'standard' : 'medical';
}

export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 365;
export const DEFAULT_RETENTION_DAYS = 30;

export type ScribeSettingsValue = {
  enabled: boolean;
  /** Delete the transcript and drafts as soon as the note made from the capture is signed (default true) */
  deleteTranscriptOnSign: boolean;
  transcriptRetentionDays: number;
  defaultFormat: ScribeFormat;
  clientSummarySharing: boolean;
  liveCuesDefault: boolean;
  transcriptionEngine: TranscriptionEngine;
  /** Always true (Maryland). Shown read-only. */
  requireRecordingConsent: true;
};

export const DEFAULT_SCRIBE_SETTINGS: ScribeSettingsValue = {
  enabled: true,
  deleteTranscriptOnSign: true,
  transcriptRetentionDays: DEFAULT_RETENTION_DAYS,
  defaultFormat: 'THERAPY_PROGRESS',
  clientSummarySharing: false,
  liveCuesDefault: true,
  transcriptionEngine: DEFAULT_TRANSCRIPTION_ENGINE,
  requireRecordingConsent: RECORDING_CONSENT_REQUIRED,
};

export const scribeSettingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    deleteTranscriptOnSign: z.boolean().optional(),
    transcriptRetentionDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).optional(),
    defaultFormat: z.enum(SCRIBE_FORMATS).optional(),
    clientSummarySharing: z.boolean().optional(),
    liveCuesDefault: z.boolean().optional(),
    transcriptionEngine: z.enum(TRANSCRIPTION_ENGINES).optional(),
    // Accepted only as true so an old client cannot turn it off; anything else is rejected
    requireRecordingConsent: z.literal(true).optional(),
  })
  .strict();

export type ScribeSettingsRow = Partial<Omit<ScribeSettingsValue, 'requireRecordingConsent' | 'defaultFormat' | 'transcriptionEngine'>> & {
  defaultFormat?: string | null;
  transcriptionEngine?: string | null;
};

export function normalizeScribeSettings(row: ScribeSettingsRow | null | undefined): ScribeSettingsValue {
  if (!row) return { ...DEFAULT_SCRIBE_SETTINGS };
  const days = Number(row.transcriptRetentionDays);
  return {
    enabled: row.enabled ?? DEFAULT_SCRIBE_SETTINGS.enabled,
    deleteTranscriptOnSign: row.deleteTranscriptOnSign ?? DEFAULT_SCRIBE_SETTINGS.deleteTranscriptOnSign,
    transcriptRetentionDays:
      Number.isInteger(days) && days >= MIN_RETENTION_DAYS && days <= MAX_RETENTION_DAYS ? days : DEFAULT_RETENTION_DAYS,
    defaultFormat: (SCRIBE_FORMATS as readonly string[]).includes(String(row.defaultFormat))
      ? (row.defaultFormat as ScribeFormat)
      : DEFAULT_SCRIBE_SETTINGS.defaultFormat,
    clientSummarySharing: row.clientSummarySharing ?? DEFAULT_SCRIBE_SETTINGS.clientSummarySharing,
    liveCuesDefault: row.liveCuesDefault ?? DEFAULT_SCRIBE_SETTINGS.liveCuesDefault,
    transcriptionEngine: isTranscriptionEngine(row.transcriptionEngine) ? row.transcriptionEngine : DEFAULT_TRANSCRIPTION_ENGINE,
    requireRecordingConsent: true,
  };
}

// ─── Clinician preferences ──────────────────────────────────────────────────

export const VERBOSITY = ['concise', 'standard', 'detailed'] as const;
export const CLIENT_TERMS = ['client', 'patient'] as const;
export const PRONOUN_STYLES = ['they', 'she', 'he', 'none'] as const;

export type ScribePreferences = {
  defaultFormat: ScribeFormat | null;
  verbosity: (typeof VERBOSITY)[number];
  clientTerm: (typeof CLIENT_TERMS)[number];
  /** 'none' = no pronouns ("the client" every time) */
  pronouns: (typeof PRONOUN_STYLES)[number];
  /** Smart phrase keys (".mse-normal") offered beside the draft; never inserted without a click */
  phraseKeys: string[];
  liveCues: boolean | null;
};

export const DEFAULT_PREFERENCES: ScribePreferences = {
  defaultFormat: null,
  verbosity: 'standard',
  clientTerm: 'client',
  pronouns: 'they',
  phraseKeys: [],
  liveCues: null,
};

export const scribePreferencesSchema = z
  .object({
    defaultFormat: z.enum(SCRIBE_FORMATS).nullable().optional(),
    verbosity: z.enum(VERBOSITY).optional(),
    clientTerm: z.enum(CLIENT_TERMS).optional(),
    pronouns: z.enum(PRONOUN_STYLES).optional(),
    phraseKeys: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    liveCues: z.boolean().nullable().optional(),
  })
  .strict();

export function normalizePreferences(row: Partial<Record<keyof ScribePreferences, unknown>> | null | undefined): ScribePreferences {
  if (!row) return { ...DEFAULT_PREFERENCES };
  const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => ((list as readonly unknown[]).includes(v) ? (v as T) : d);
  return {
    defaultFormat: (SCRIBE_FORMATS as readonly unknown[]).includes(row.defaultFormat) ? (row.defaultFormat as ScribeFormat) : null,
    verbosity: pick(row.verbosity, VERBOSITY, DEFAULT_PREFERENCES.verbosity),
    clientTerm: pick(row.clientTerm, CLIENT_TERMS, DEFAULT_PREFERENCES.clientTerm),
    pronouns: pick(row.pronouns, PRONOUN_STYLES, DEFAULT_PREFERENCES.pronouns),
    phraseKeys: Array.isArray(row.phraseKeys) ? row.phraseKeys.filter((k): k is string => typeof k === 'string').slice(0, 30) : [],
    liveCues: typeof row.liveCues === 'boolean' ? row.liveCues : null,
  };
}

/** Style instructions for the drafting prompt (no PHI). */
export function styleInstructions(p: ScribePreferences): string {
  const length =
    p.verbosity === 'concise'
      ? 'Keep each section to 1-2 short sentences.'
      : p.verbosity === 'detailed'
        ? 'Use up to 5 sentences per section when the transcript supports them.'
        : 'Use 2-3 sentences per section when the transcript supports them.';
  const term = `Refer to the person served as "the ${p.clientTerm}".`;
  const pron =
    p.pronouns === 'none'
      ? `Do not use pronouns for the ${p.clientTerm}; repeat "the ${p.clientTerm}".`
      : `Use "${p.pronouns === 'they' ? 'they/them' : p.pronouns === 'she' ? 'she/her' : 'he/him'}" pronouns for the ${p.clientTerm}.`;
  return [length, term, pron, 'Write in the past tense, third person.'].join(' ');
}
