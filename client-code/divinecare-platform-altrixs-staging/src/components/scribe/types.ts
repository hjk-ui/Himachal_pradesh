/** Client-side shapes of the /api/scribe responses (no server imports). */
import type { ScribePreferences, ScribeSettingsValue, ScribeFormat } from '@/lib/scribe/settings';
import type { CheckedSentence } from '@/lib/scribe/grounding';
import type { TranscriptRisk } from '@/lib/scribe/risk';
import type { FollowUpSuggestion, MdmChecklist, PlanLinkSuggestion, ProvenanceItem, ScoreSuggestion, StigmaItem } from '@/lib/scribe/draft';
import type { ChartMedication, MedSuggestion } from '@/lib/scribe/medications';
import type { MinimumNecessaryFlag } from '@/lib/scribe/minimumNecessary';
import type { SessionClock } from '@/lib/scribe/sessionClock';
import type { CptSuggestion, Evidence, IcdSuggestion, PosSuggestion } from '@/lib/scribe/coding';
import type { MeasurePlanItem } from '@/lib/scribe/spokenMeasures';
import type { RecordingGap } from '@/lib/scribe/recordingMonitor';

export type ScribeContextResponse = {
  context: {
    goals: { id: string; text: string; objectives: string[] }[];
    diagnoses: { code: string | null; description: string | null }[];
    lastPlan: string | null;
    lastPlanDate: string | null;
    scores: string[];
    planTitle: string | null;
    measuresDue: { instrument: string; detail: string }[];
    minor: boolean;
    medications?: ChartMedication[];
  };
  settings: ScribeSettingsValue;
  preferences: ScribePreferences;
  consent: { ai: 'signed' | 'missing' | 'declined'; practiceRequiresAiConsent: boolean; recordingRevoked?: boolean };
  part2: boolean;
  /** Preselected capture language (client prefers Spanish → es-US) */
  language?: 'en-US' | 'es-US';
  configured: { streaming: boolean; chimeTranscription: boolean; bedrock: boolean; entitled: boolean; upload?: boolean };
};

export type CaptureView = {
  id: string;
  clientId: string;
  mode: 'in_person' | 'telehealth' | 'dictation';
  engine: string;
  status: string;
  noteFormat: ScribeFormat | null;
  part2: boolean;
  aiConsentStatus: string;
  liveCues: boolean;
  consent: { attestedAt: string; attestedBy: string | null; method: string | null };
  progressNoteId: string | null;
  telehealthSessionId: string | null;
  appointmentId: string | null;
  captureSeconds: number;
  /** en-US | es-US */
  language?: string;
  /** live | upload | recap */
  source?: string;
  audioDeleted?: boolean;
  /** Live stream dropped and reconnected: what was not recorded (capture clock) */
  recordingGaps?: RecordingGap[];
};

export type DraftContent = {
  label: string;
  part2Notice: string | null;
  noteType: string | null;
  texts: Record<string, string>;
  body: string;
  provenance: ProvenanceItem[];
  withheld: ProvenanceItem[];
  planLinks: PlanLinkSuggestion[];
  followUps: FollowUpSuggestion[];
  homework: CheckedSentence[];
  summarySentences: CheckedSentence[];
  risk: TranscriptRisk;
  /** Drafts made before 2026-10-24 lack the fields below */
  promptVersion?: string;
  medSuggestions?: ProvenanceItem[];
  misheardMeds?: MedSuggestion[];
  medications?: ChartMedication[];
  scores?: ScoreSuggestion[];
  mdm?: MdmChecklist | null;
  minimumNecessary?: MinimumNecessaryFlag[];
  stigma?: StigmaItem[];
  /** Measures the clinician said are to be completed (drafts from 2026-10-25); assigned only by a click in review */
  measurePlan?: MeasurePlanItem[];
  /** The client's next scheduled visit (practice time zone), the due date for those measures */
  nextAppointmentDate?: string | null;
  qualityWarning?: string | null;
  counts?: { sentences: number; withheld: number; weak: number; flagged: number };
  entailment?: { calls: number; checked: number; skipped: number; failed: boolean };
  coding: {
    minutes: number | null;
    minutesSource: string;
    sessionClock?: SessionClock | null;
    prescriber?: boolean;
    crisisRule?: string | null;
    cpt: CptSuggestion;
    interactiveComplexity: { suggested: boolean; evidence: Evidence[]; rule: string };
    pos: PosSuggestion;
    icd10: IcdSuggestion[];
    disclaimer: string;
  };
};

export type DraftView = { id: string; format: ScribeFormat; createdAt: string; content: DraftContent };
