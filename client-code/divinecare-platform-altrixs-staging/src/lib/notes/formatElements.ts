/**
 * Required elements per section note format (SOAP, DAP, BIRP, GIRP, PIRP, PIE, CBT, DBT, MFT, EMDR,
 * Crisis, SUD, Intake, Psych Eval, Med Mgmt, PRP, Peer Support, Discharge). Pure, browser-safe.
 *
 * Same idea as the therapist templates' required fields (therapy/engine missingFields): what a
 * payer / COMAR 10.63 audit expects in every progress note of that format is flagged when it is
 * missing (a warning until the Notes policy date formatElementsEnforceFrom, then it blocks signing) — the sections that carry the session content, interventions, response and plan, an
 * SI / HI screen, and the client's functional status. Read from the saved body, so the editor, the
 * sign path (notes/standard.ts noteTypeIssues) and the quality check agree.
 */
import { normalizeNoteType, structuredNoteSections } from '@/lib/ehr/noteTemplates';
import { IDENTIFYING_INFO } from '@/lib/ehr/therapy/sections';
import { DEFAULT_PRACTICE_TIME_ZONE, practiceToday } from '@/lib/time/practiceTime';

/** Template chief-complaint sections: the quoted chief complaint in Identifying Information also documents them */
const CHIEF_COMPLAINT_SECTIONS = new Set(['Chief Complaint', 'Chief Complaint / Reason for Referral']);
const CC_LINE = /^Chief complaint \(patient's own words\): \S/m;

// ─── Enforcement date (Notes policy: warn until the date, then block) ────────

/**
 * Missing format elements are warnings until this practice date, then block signing
 * (NotePolicySettings.formatElementsEnforceFrom; null = this default). Decided 2026-10-24:
 * two weeks after go-live so clinicians learn the formats before they block.
 */
export const DEFAULT_FORMAT_ELEMENTS_ENFORCE_FROM = '2026-11-16';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isEnforceFromDate(v: unknown): v is string {
  if (typeof v !== 'string' || !YMD.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function resolveFormatElementsEnforceFrom(v: string | null | undefined): string {
  return isEnforceFromDate(v) ? v : DEFAULT_FORMAT_ELEMENTS_ENFORCE_FROM;
}

export type FormatElementsGate = {
  /** true = missing elements block signing; false = warning only */
  enforced: boolean;
  /** YYYY-MM-DD (practice date) from which they block */
  enforceFrom: string;
};

/** Enforced on / after the practice-clock date (the practice's own time zone, not UTC). */
export function formatElementsGate(input: { formatElementsEnforceFrom?: string | null; timeZone?: string | null }, now: Date = new Date()): FormatElementsGate {
  const enforceFrom = resolveFormatElementsEnforceFrom(input.formatElementsEnforceFrom);
  const today = practiceToday(input.timeZone || DEFAULT_PRACTICE_TIME_ZONE, now);
  return { enforced: today >= enforceFrom, enforceFrom };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-16" -> "Nov 16" ("Nov 16, 2027" when the year differs from `currentYear`). */
export function enforceFromLabel(ymd: string, currentYear?: number): string {
  if (!isEnforceFromDate(ymd)) return ymd;
  const [y, m, d] = ymd.split('-').map(Number);
  const base = `${MONTHS[m - 1]} ${d}`;
  return currentYear !== undefined && currentYear !== y ? `${base}, ${y}` : base;
}

/** Suffix on a not-yet-enforced format-element warning: "Will be required from Nov 16." */
export function willBeRequiredText(gate: FormatElementsGate, now: Date = new Date()): string {
  return `Will be required from ${enforceFromLabel(gate.enforceFrom, now.getUTCFullYear())}.`;
}

export type FormatRequirement = {
  /** Sections that must have content */
  sections: readonly string[];
  /** SI / HI screen documented somewhere in the note */
  riskScreen: boolean;
  /** Functional status (home / work / school / relationships / daily functioning) */
  functional: boolean;
};

export const FORMAT_REQUIREMENTS: Readonly<Record<string, FormatRequirement>> = {
  SOAP: { sections: ['Subjective', 'Assessment', 'Plan'], riskScreen: true, functional: true },
  DAP: { sections: ['Data', 'Assessment', 'Plan'], riskScreen: true, functional: true },
  BIRP: { sections: ['Behavior', 'Intervention', 'Response', 'Plan'], riskScreen: true, functional: true },
  GIRP: { sections: ['Goals', 'Intervention', 'Response', 'Plan'], riskScreen: true, functional: true },
  PIRP: { sections: ['Problem', 'Intervention', 'Response', 'Plan'], riskScreen: true, functional: true },
  PIE: { sections: ['Problem', 'Intervention', 'Evaluation'], riskScreen: true, functional: true },
  CBT: { sections: ['Session Focus', 'Cognitive Interventions', 'Plan'], riskScreen: true, functional: true },
  DBT: { sections: ['Target Behaviors', 'Skills Used', 'Plan'], riskScreen: true, functional: false },
  MFT: { sections: ['Participants', 'Intervention', 'Response', 'Plan'], riskScreen: true, functional: true },
  EMDR: { sections: ['Target Memory / Image', 'Processing Notes', 'Closure', 'Plan'], riskScreen: true, functional: false },
  // Risk Assessment and Disposition / Safety Plan are checked by noteTypeIssues (crisis.risk / crisis.disposition)
  Crisis: { sections: ['Presenting Crisis', 'Interventions', 'Follow-up'], riskScreen: true, functional: false },
  SUD: { sections: ['Current Use / Amount', 'Interventions', 'Plan'], riskScreen: true, functional: true },
  Intake: {
    sections: ['Chief Complaint / Reason for Referral', 'History of Present Illness', 'Mental Status Exam', 'Risk Assessment', 'Diagnostic Impression', 'Treatment Recommendations'],
    riskScreen: true,
    functional: true,
  },
  'Psych Eval': { sections: ['Chief Complaint', 'History of Present Illness', 'Mental Status Exam', 'Risk Assessment', 'Diagnosis', 'Plan'], riskScreen: true, functional: true },
  'Med Mgmt': { sections: ['Interval History', 'Current Medications', 'Mental Status', 'Assessment', 'Plan'], riskScreen: true, functional: false },
  PRP: { sections: ['IRP Goal Addressed', 'Intervention', 'Participant Response', 'Plan'], riskScreen: false, functional: false },
  'Peer Support': { sections: ['Recovery Goal Addressed', 'Peer Support Provided', 'Participant Response', 'Plan'], riskScreen: false, functional: false },
  Discharge: { sections: ['Reason for Discharge', 'Treatment Summary', 'Aftercare Plan'], riskScreen: false, functional: false },
};

const RISK_SCREEN = /\b(SI|HI|SIB|suicid\w*|homicid\w*|self[- ]harm\w*|C-?SSRS|Columbia|thoughts? of (hurting|harming|killing)|safety (plan|concerns?)|risk (assessment|level|screen))\b/i;
const FUNCTIONAL =
  /\b(function(ing|al)?|work(ing|place)?|job|employ\w*|school|class(es)?|grades?|home|household|famil(y|ies)|relationships?|partner|friends?|social(ly)?|sleep(ing)?|ADLs?|daily (living|activities|routine)|self-care|hygiene|attendance|occupational|parenting|caregiving)\b/i;

export type FormatElementIssue = { id: string; message: string; heading: string | null };

/** Missing required elements (empty = none missing, or not a section format). */
export function formatElementIssues(noteType: string | null | undefined, body: string): FormatElementIssue[] {
  const type = noteType ? normalizeNoteType(noteType) : '';
  const req = FORMAT_REQUIREMENTS[type];
  if (!req) return [];
  const sections = structuredNoteSections(type, body);
  const text = (h: string) =>
    sections
      .filter((s) => s.title === h)
      .map((s) => s.text)
      .join('\n')
      .replace(/\[AI DRAFT[^\]]*\]\s*/gi, '')
      .trim();
  const out: FormatElementIssue[] = [];
  const ccInIdentifying = CC_LINE.test(text(IDENTIFYING_INFO));
  const empty = req.sections.filter((h) => !text(h) && !(ccInIdentifying && CHIEF_COMPLAINT_SECTIONS.has(h)));
  if (empty.length) out.push({ id: 'format.sections', message: `${type} note: document ${empty.join(', ')}.`, heading: empty[0] });
  const all = sections.map((s) => s.text).join('\n');
  if (req.riskScreen && !RISK_SCREEN.test(all)) {
    out.push({ id: 'format.risk_screen', message: `${type} note: document the SI / HI screen (e.g. "Denies SI / HI" or the C-SSRS result).`, heading: null });
  }
  if (req.functional && !FUNCTIONAL.test(all)) {
    out.push({ id: 'format.functional', message: `${type} note: document the client's functional status (home, work, school, relationships or daily functioning).`, heading: null });
  }
  return out;
}
