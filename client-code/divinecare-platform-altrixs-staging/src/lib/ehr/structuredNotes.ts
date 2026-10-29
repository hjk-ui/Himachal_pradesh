/**
 * Structured (template-driven) progress notes: Psychiatric Med Management,
 * Child Psychiatry Intake, Child Psychiatry Re-Eval, Adult Psychiatry Intake,
 * Adult Psychiatry Re-Eval, and the therapist templates (MD Therapy Adult & Child
 * Intake, Substance Abuse Intake, Therapy Progress Adult & Child). Shared config,
 * carry-forward markers and sign-blocking rules used by the editor, the note view
 * and the server.
 */
import { findUnfilledBlanks } from '@/lib/ehr/smartPhrases';
import { countAiDraftMarkers } from '@/lib/ai/noteDraftFormats';
import { NOTE_SECTIONS, normalizeNoteType, structuredNoteSections, type NoteType } from '@/lib/ehr/noteTemplates';
import { PMM, PMM_ADDON_OPTIONS, PMM_EM_OPTIONS, PSYCH_MED_MGMT, pmmRiskBlockers } from '@/lib/ehr/psychMedMgmt';
import {
  CHILD_PSYCH_INITIAL_INTAKE,
  CHILD_PSYCH_INTAKE,
  CPI,
  CPI_CARRY_FORWARD,
  CPI_CODE_OPTIONS,
  cpiRiskBlockers,
} from '@/lib/ehr/childPsychIntake';
import { ADULT_PSYCH_INTAKE, API, API_CARRY_FORWARD, API_CODE_OPTIONS, apiRiskBlockers } from '@/lib/ehr/adultPsychIntake';
import {
  ADULT_PSYCH_REEVAL,
  APR,
  APR_BRING_FORWARD_ALL,
  APR_CARRY_FORWARD,
  APR_CODE_OPTIONS,
  INTERVAL_DOMAINS,
  REEVAL_SOURCE_TYPES,
  aprRiskBlockers,
  type IntervalDomain,
} from '@/lib/ehr/adultPsychReEval';
import { CHILD_INTERVAL_DOMAINS, CHILD_REEVAL_SOURCE_TYPES, CPR_BRING_FORWARD_ALL } from '@/lib/ehr/childPsychReEval';
import { CPT_CODES } from '@/lib/constants/cpt';
import { SUD_INTAKE, THERAPY_INTAKE, THERAPY_NOTE_TYPES, THERAPY_PROGRESS, type TherapyNoteType } from '@/lib/ehr/therapy/sections';
import { THERAPY_TEMPLATES } from '@/lib/ehr/therapy/templates';
import { therapySignBlockers } from '@/lib/ehr/therapy/blockers';

export const STRUCTURED_NOTE_TYPES = [
  PSYCH_MED_MGMT,
  CHILD_PSYCH_INITIAL_INTAKE,
  CHILD_PSYCH_INTAKE,
  ADULT_PSYCH_INTAKE,
  ADULT_PSYCH_REEVAL,
  THERAPY_INTAKE,
  SUD_INTAKE,
  THERAPY_PROGRESS,
] as const;
export type StructuredNoteType = (typeof STRUCTURED_NOTE_TYPES)[number];

export function asStructuredNoteType(noteType: string | null | undefined): StructuredNoteType | null {
  if (!noteType) return null;
  const n = normalizeNoteType(noteType);
  return (STRUCTURED_NOTE_TYPES as readonly string[]).includes(n) ? (n as StructuredNoteType) : null;
}

/** Therapist templates (declarative engine + TherapyNoteEditor) vs the psychiatry templates (StructuredNoteEditor). */
export function isTherapyTemplate(type: string | null | undefined): type is TherapyNoteType {
  return (THERAPY_NOTE_TYPES as readonly string[]).includes(String(type ?? ''));
}

const codeOptions = (codes: readonly string[]) =>
  CPT_CODES.filter((c) => codes.includes(c.code)).map((c) => ({ code: c.code, label: `${c.code} — ${c.desc}` }));

function therapyConfig(type: TherapyNoteType): TemplateConfig {
  const tpl = THERAPY_TEMPLATES[type];
  return {
    type,
    sections: NOTE_SECTIONS[type as NoteType],
    codeLabel: 'Service code',
    codeOptions: codeOptions(tpl.codes),
    addOnOptions: [],
    carryForward: tpl.carryForward,
    carrySource: 'sameType',
    aiSections: tpl.aiSections,
    priorEvalSourceTypes: null,
    reEval: null,
    reEvalAlternative: null,
  };
}

export type TemplateConfig = {
  type: StructuredNoteType;
  sections: readonly string[];
  codeLabel: string;
  codeOptions: { code: string; label: string }[];
  addOnOptions: { code: string; label: string }[];
  /** Sections that offer "Bring forward from <date>" from the prior note (see carrySource) */
  carryForward: readonly string[];
  /**
   * Where "Bring forward" text comes from: the most recent note of the same type, or
   * (re-evaluation) the most recent signed prior evaluation.
   */
  carrySource: 'sameType' | 'priorEvaluation';
  /** Sections where AI may draft from dictation / bullet points */
  aiSections: readonly string[];
  /**
   * Note types whose most recent SIGNED note is loaded as the prior evaluation
   * (note-context `reEvalSource`); null = not looked up.
   */
  priorEvalSourceTypes: readonly string[] | null;
  /** Re-evaluation behaviour (default evaluation type, interval prompts, "Bring forward all"); null otherwise */
  reEval: {
    population: 'adult' | 'child';
    /** Stable-history sections for "Bring forward all history from <date>" */
    bringForwardAll: readonly string[];
    /** "What changed since <date>" chips in History of Present Illness/Interval History */
    intervalDomains: readonly IntervalDomain[];
  } | null;
  /** Initial evaluation: the re-eval template suggested when a signed prior evaluation exists */
  reEvalAlternative: StructuredNoteType | null;
};

export const TEMPLATE_CONFIG: Record<StructuredNoteType, TemplateConfig> = {
  [PSYCH_MED_MGMT]: {
    type: PSYCH_MED_MGMT,
    sections: NOTE_SECTIONS[PSYCH_MED_MGMT as NoteType],
    codeLabel: 'E/M code',
    codeOptions: PMM_EM_OPTIONS,
    addOnOptions: PMM_ADDON_OPTIONS,
    carryForward: [PMM.freeForm, PMM.plan],
    carrySource: 'sameType',
    aiSections: [PMM.hpi],
    priorEvalSourceTypes: null,
    reEval: null,
    reEvalAlternative: null,
  },
  [CHILD_PSYCH_INITIAL_INTAKE]: {
    type: CHILD_PSYCH_INITIAL_INTAKE,
    sections: NOTE_SECTIONS[CHILD_PSYCH_INITIAL_INTAKE as NoteType],
    codeLabel: 'Service code',
    codeOptions: CPI_CODE_OPTIONS,
    addOnOptions: PMM_ADDON_OPTIONS,
    carryForward: CPI_CARRY_FORWARD,
    carrySource: 'sameType',
    aiSections: [CPI.hpi],
    // Looked up only for the "consider Child Psychiatry Re-Eval" hint
    priorEvalSourceTypes: CHILD_REEVAL_SOURCE_TYPES,
    reEval: null,
    reEvalAlternative: CHILD_PSYCH_INTAKE,
  },
  [CHILD_PSYCH_INTAKE]: {
    type: CHILD_PSYCH_INTAKE,
    sections: NOTE_SECTIONS[CHILD_PSYCH_INTAKE as NoteType],
    codeLabel: 'Service code',
    codeOptions: CPI_CODE_OPTIONS,
    addOnOptions: PMM_ADDON_OPTIONS,
    carryForward: CPI_CARRY_FORWARD,
    carrySource: 'priorEvaluation',
    aiSections: [CPI.hpi, CPI.interval],
    priorEvalSourceTypes: CHILD_REEVAL_SOURCE_TYPES,
    reEval: { population: 'child', bringForwardAll: CPR_BRING_FORWARD_ALL, intervalDomains: CHILD_INTERVAL_DOMAINS },
    reEvalAlternative: null,
  },
  [ADULT_PSYCH_INTAKE]: {
    type: ADULT_PSYCH_INTAKE,
    sections: NOTE_SECTIONS[ADULT_PSYCH_INTAKE as NoteType],
    codeLabel: 'Service code',
    codeOptions: API_CODE_OPTIONS,
    addOnOptions: PMM_ADDON_OPTIONS,
    carryForward: API_CARRY_FORWARD,
    carrySource: 'sameType',
    aiSections: [API.hpi],
    priorEvalSourceTypes: null,
    reEval: null,
    reEvalAlternative: null,
  },
  [ADULT_PSYCH_REEVAL]: {
    type: ADULT_PSYCH_REEVAL,
    sections: NOTE_SECTIONS[ADULT_PSYCH_REEVAL as NoteType],
    codeLabel: 'Service code',
    codeOptions: APR_CODE_OPTIONS,
    addOnOptions: PMM_ADDON_OPTIONS,
    carryForward: APR_CARRY_FORWARD,
    carrySource: 'priorEvaluation',
    aiSections: [APR.hpi, APR.interval],
    priorEvalSourceTypes: REEVAL_SOURCE_TYPES,
    reEval: { population: 'adult', bringForwardAll: APR_BRING_FORWARD_ALL, intervalDomains: INTERVAL_DOMAINS },
    reEvalAlternative: null,
  },
  [THERAPY_INTAKE]: therapyConfig(THERAPY_INTAKE),
  [SUD_INTAKE]: therapyConfig(SUD_INTAKE),
  [THERAPY_PROGRESS]: therapyConfig(THERAPY_PROGRESS),
};

/** Prior-evaluation note types for a requested note type (null when it has none). */
export function priorEvalSourceTypesFor(noteType: string | null | undefined): readonly string[] | null {
  const type = asStructuredNoteType(noteType);
  return type ? TEMPLATE_CONFIG[type].priorEvalSourceTypes : null;
}

// ─── Carry-forward ("Bring forward from <date>") ────────────────────────────

const PENDING_RE = /\(from (\d{4}-\d{2}-\d{2}) — review\)/g;
const ANY_MARKER_LINE_RE = /^\(from \d{4}-\d{2}-\d{2} — (?:review|reviewed, no changes)\)\s*$/;

export function carryMarker(date: string): string {
  return `(from ${date} — review)`;
}
export function reviewedMarker(date: string): string {
  return `(from ${date} — reviewed, no changes)`;
}

/** Prior section text without earlier carry-forward marker lines (avoids chains of markers). */
export function stripCarryMarkers(text: string): string {
  return text
    .split('\n')
    .filter((l) => !ANY_MARKER_LINE_RE.test(l.trim()))
    .join('\n')
    .trim();
}

/** Block inserted by "Bring forward": marker line + the prior text. */
export function broughtForwardBlock(date: string, priorText: string): string {
  return `${carryMarker(date)}\n${stripCarryMarkers(priorText)}`;
}

/**
 * "Reviewed, no changes": if the prior text was already brought forward, mark it
 * reviewed; otherwise insert it with the reviewed marker.
 */
export function markReviewedNoChanges(current: string, date: string, priorText: string): string {
  if (current.includes(carryMarker(date))) return current.split(carryMarker(date)).join(reviewedMarker(date));
  const block = `${reviewedMarker(date)}\n${stripCarryMarkers(priorText)}`;
  return current.trim() ? `${current.trim()}\n\n${block}` : block;
}

/**
 * "Bring forward all history from <date>": adds every listed section's prior text
 * with the pending "(from <date> — review)" marker, so each still needs
 * "Reviewed, no changes" (or an edit) before signing. Sections that already hold
 * text from that date, or that have no prior text, are left as they are.
 */
export function bringForwardAll(
  current: Record<string, string>,
  date: string,
  priorSections: Record<string, string>,
  headings: readonly string[]
): { texts: Record<string, string>; brought: string[]; alreadyPresent: string[]; noPriorText: string[] } {
  const texts = { ...current };
  const brought: string[] = [];
  const alreadyPresent: string[] = [];
  const noPriorText: string[] = [];
  for (const h of headings) {
    const priorText = stripCarryMarkers(priorSections[h] || '');
    if (!priorText) {
      noPriorText.push(h);
      continue;
    }
    const cur = (texts[h] || '').trim();
    if (cur.includes(`(from ${date} — `)) {
      alreadyPresent.push(h);
      continue;
    }
    const block = broughtForwardBlock(date, priorText);
    texts[h] = cur ? `${cur}\n\n${block}` : block;
    brought.push(h);
  }
  return { texts, brought, alreadyPresent, noPriorText };
}

/** Brought-forward blocks the clinician has not yet reviewed. */
export function countPendingCarryForward(text: string): number {
  return (text.match(PENDING_RE) || []).length;
}

// ─── Sign blocking ──────────────────────────────────────────────────────────

export type SignBlocker = { message: string; heading: string | null };

/**
 * Why a structured note cannot be signed (empty = can sign). Text-based so the
 * editor, the note view and the server apply the same rules.
 */
export function structuredSignBlockers(input: {
  noteType: string;
  body: string;
  cptCode: string | null | undefined;
  /** Therapist progress notes: the time rule compares the code with the session time */
  durationMinutes?: number | null;
}): SignBlocker[] {
  const type = asStructuredNoteType(input.noteType);
  if (!type) return [];
  const blockers: SignBlocker[] = [];
  const first = TEMPLATE_CONFIG[type].sections[0];
  if (!(input.cptCode || '').trim()) {
    blockers.push({ message: `Choose the ${TEMPLATE_CONFIG[type].codeLabel} (CPT) in the ${first}.`, heading: first });
  }
  const sections = structuredNoteSections(type, input.body);
  const text = (title: string) =>
    sections
      .filter((s) => s.title === title)
      .map((s) => s.text)
      .join('\n');
  blockers.push(
    ...(isTherapyTemplate(type)
      ? therapySignBlockers({ type, body: input.body, cptCode: input.cptCode, durationMinutes: input.durationMinutes })
      : type === PSYCH_MED_MGMT
      ? pmmRiskBlockers(text)
      : type === ADULT_PSYCH_INTAKE
        ? apiRiskBlockers(text)
        : type === ADULT_PSYCH_REEVAL
          ? aprRiskBlockers(text)
          : cpiRiskBlockers(text)) // both child templates
  );
  for (const s of sections) {
    const pending = countPendingCarryForward(s.text);
    if (pending) {
      blockers.push({
        message: `${s.title}: brought-forward text is marked "review". Review it, then click "Reviewed, no changes" or edit it and remove the marker.`,
        heading: s.title,
      });
    }
  }
  const blanks = findUnfilledBlanks(input.body);
  if (blanks > 0) {
    const where = sections.find((s) => findUnfilledBlanks(s.text) > 0)?.title ?? null;
    blockers.push({ message: `${blanks} unfilled [___] blank${blanks === 1 ? '' : 's'} remain.`, heading: where });
  }
  const markers = countAiDraftMarkers(input.body);
  if (markers > 0) {
    const where = sections.find((s) => countAiDraftMarkers(s.text) > 0)?.title ?? null;
    blockers.push({
      message: `${markers} section${markers === 1 ? '' : 's'} still carry the AI DRAFT marker. Review and Accept each one.`,
      heading: where,
    });
  }
  return blockers;
}
