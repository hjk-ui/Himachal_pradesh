/**
 * Adult Psychiatry Re-Eval note (Valant template 22019 "MD Health - Adult
 * Psychiatry Intake Note for Re-Eval" equivalent).
 *
 * Reuses the adult intake (sections, wording, option lists, risk rule) and,
 * from the med-management note, Free Form Content, Measure Review and Plan -
 * Labs Ordered. This module holds only what is specific to the re-evaluation:
 * the prior-evaluation reference, the "what changed since <date>" prompts, the
 * stable-history sections brought forward together, and the measure change
 * since the prior evaluation. Nothing is inserted without the clinician's click.
 *
 * The prior-evaluation helpers here (header line, interval changes, prior-evaluation
 * reference, measures since the evaluation) are generic and also used by the Child
 * Psychiatry Re-Eval (childPsychReEval.ts), which supplies its own domains and lists.
 */
import { NOTE_SECTIONS, noteTypeBadge } from '@/lib/ehr/noteTemplates';
import { API, API_CARRY_FORWARD, API_CODE_OPTIONS, apiRiskBlockers } from '@/lib/ehr/adultPsychIntake';
import { CPI } from '@/lib/ehr/childPsychIntake';
import { PMM, isoDate, type MeasureRecord } from '@/lib/ehr/psychMedMgmt';

export const ADULT_PSYCH_REEVAL = 'Adult Psych Re-Eval' as const;
export const APR_SECTIONS = NOTE_SECTIONS[ADULT_PSYCH_REEVAL];

/** Section headings: the adult intake's plus four sections shared with the other templates. */
export const APR = {
  ...API,
  interval: CPI.interval,
  freeForm: PMM.freeForm,
  measures: PMM.measures,
  labsOrdered: PMM.labsOrdered,
} as const;

/** Same history sections as the adult intake offer "Bring forward" one at a time. */
export const APR_CARRY_FORWARD = API_CARRY_FORWARD;

/**
 * Stable-history sections brought forward together by "Bring forward all history
 * from <date>". Suicide/Self-Harm Hx and Menstruation and Pregnancy Hx are left
 * out on purpose: they are re-assessed at every evaluation (still available one
 * at a time).
 */
export const APR_BRING_FORWARD_ALL = [
  APR.inpatient,
  APR.outpatient,
  APR.psychMedHx,
  APR.abuse,
  APR.pastMedical,
  APR.allergies,
  APR.substanceHx,
  APR.substanceConsequences,
  APR.substanceTx,
  APR.familyHx,
  APR.familyRelationships,
  APR.developmental,
  APR.social,
  APR.legal,
  APR.violence,
  APR.stressors,
] as const;

/** Same service codes as the adult intake (90792; E/M only when in the CPT catalog). */
export const APR_CODE_OPTIONS = API_CODE_OPTIONS;

/** High overall suicide risk needs a safety plan (same heading and rule as the adult intake). */
export const aprRiskBlockers = apiRiskBlockers;

/** Note types whose most recent SIGNED note is the reference for a re-evaluation. */
export const REEVAL_SOURCE_TYPES = ['Adult Psych Intake', ADULT_PSYCH_REEVAL, 'Psych Eval', 'Intake'] as const;

const clean = (v: string | null | undefined) => (v || '').trim();

// ─── Header ─────────────────────────────────────────────────────────────────

export const PRIOR_EVAL_PREFIX = 'Prior evaluation used as reference:';

export function priorEvalHeaderLine(prior: { date: string; noteType: string } | null): string {
  return prior ? `${PRIOR_EVAL_PREFIX} ${prior.date} (${noteTypeBadge(prior.noteType)})` : `${PRIOR_EVAL_PREFIX} None on file`;
}

// ─── Interval history: "what changed since <date>" ──────────────────────────

export type IntervalDomain = { key: string; label: string; options: readonly string[] };

/** Adult re-eval "what changed since <date>" domains. */
export const INTERVAL_DOMAINS = [
  { key: 'symptoms', label: 'Symptoms', options: ['Improved', 'Unchanged', 'Worsened', 'Mixed'] },
  { key: 'meds', label: 'Medications', options: ['No changes', 'Changed', 'Stopped / not taking', 'Side effects'] },
  { key: 'hospitalizations', label: 'Psychiatric hospitalizations', options: ['None', 'Yes'] },
  { key: 'er', label: 'ER visits', options: ['None', 'Yes'] },
  { key: 'substance', label: 'Substance use', options: ['No change', 'Increased', 'Decreased', 'New use', 'Not assessed'] },
  { key: 'lifeEvents', label: 'Life events / stressors', options: ['None reported', 'Yes'] },
] as const satisfies readonly IntervalDomain[];

export type IntervalChanges = Record<string, { choice: string; details: string }>;

/** Only the domains the clinician answered; nothing when none were. */
export function renderIntervalChanges(
  sinceDate: string | null,
  v: IntervalChanges,
  domains: readonly IntervalDomain[] = INTERVAL_DOMAINS
): string {
  const lines = domains.flatMap((d) => {
    const a = v[d.key];
    const choice = clean(a?.choice);
    const details = clean(a?.details);
    if (!choice && !details) return [];
    return [`- ${d.label}: ${[choice, details].filter(Boolean).join(' — ')}`];
  });
  if (!lines.length) return '';
  return [sinceDate ? `Changes since prior evaluation (${sinceDate}):` : 'Interval changes:', ...lines].join('\n');
}

/** Read-only summary of the prior evaluation, inserted as reference on click only. */
export function priorEvalReference(prior: { date: string; noteType: string; diagnoses: string; plan: string; medChanges: string }): string {
  return [
    `Prior evaluation (${prior.date}, ${noteTypeBadge(prior.noteType)}) for reference:`,
    `Diagnoses: ${clean(prior.diagnoses) || 'None documented'}`,
    `Plan: ${clean(prior.plan) || 'None documented'}`,
    `Med changes: ${clean(prior.medChanges) || 'None documented'}`,
  ].join('\n');
}

// ─── Measure Review: change since the prior evaluation ──────────────────────

export type MeasureSinceEval = {
  instrument: string;
  latest: { score: number | null; severity: string | null; date: string; source: string };
  /** Most recent score on or before the prior evaluation date (null when none) */
  atEval: { score: number | null; date: string } | null;
  change: number | null;
};

const normInstrument = (name: string) => name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Latest score per instrument vs the score at (on or before) the prior evaluation date. */
export function summarizeMeasuresSinceEval(records: MeasureRecord[], evalDate: string): MeasureSinceEval[] {
  const groups = new Map<string, MeasureRecord[]>();
  for (const r of records) {
    if (!r.instrument || !isoDate(r.date)) continue;
    const key = normInstrument(r.instrument);
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  const out: MeasureSinceEval[] = [];
  for (const rows of groups.values()) {
    const sorted = [...rows].sort((a, b) => isoDate(b.date).localeCompare(isoDate(a.date)));
    const latest = sorted[0];
    const base = sorted.find((r) => isoDate(r.date) <= evalDate) || null;
    // The latest score is itself the baseline when nothing was recorded after the evaluation
    const atEval = base ? { score: base.score, date: isoDate(base.date) } : null;
    const change =
      base && base !== latest && latest.score != null && base.score != null ? Math.round((latest.score - base.score) * 100) / 100 : null;
    out.push({
      instrument: latest.instrument,
      latest: { score: latest.score, severity: latest.severity, date: isoDate(latest.date), source: latest.source },
      atEval,
      change,
    });
  }
  return out.sort((a, b) => b.latest.date.localeCompare(a.latest.date));
}

export function renderMeasuresSinceEval(rows: MeasureSinceEval[], evalDate: string): string {
  if (!rows.length) return 'Rating scales: None on file';
  const fmt = (n: number | null) => (n == null ? '—' : String(n));
  const lines = rows.map((r) => {
    const base = r.atEval ? `${fmt(r.atEval.score)} (${r.atEval.date})` : 'none on file';
    const change = r.change == null ? 'n/a' : r.change > 0 ? `+${r.change}` : String(r.change);
    return `- ${r.instrument}: ${fmt(r.latest.score)}${r.latest.severity ? ` ${r.latest.severity}` : ''} (${r.latest.date}); at prior evaluation ${base}; change since prior evaluation ${change}`;
  });
  const sources = [...new Set(rows.map((r) => r.latest.source))].join('; ');
  return [`Rating scales (latest vs at prior evaluation ${evalDate}):`, ...lines, `Source: ${sources}.`].join('\n');
}
