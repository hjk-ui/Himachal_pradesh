/**
 * Child Psychiatry Re-Eval note (Valant template 46444 "MD Health - Child Psychiatry
 * Intake Note for Re-Eval"; stored key 'Child Psych Intake').
 *
 * Same sections, wording and option lists as the child intake (childPsychIntake.ts) plus
 * History of Present Illness/Interval History. Uses the generic prior-evaluation helpers
 * from the adult re-eval (adultPsychReEval.ts); this module holds only the child lists:
 * the prior-evaluation note types, the "what changed since <date>" domains and the
 * stable-history sections brought forward together. Nothing is inserted without a click.
 */
import { CHILD_PSYCH_INITIAL_INTAKE, CHILD_PSYCH_INTAKE, CPI } from '@/lib/ehr/childPsychIntake';
import type { IntervalDomain } from '@/lib/ehr/adultPsychReEval';

/** Readable alias: the 46444 re-eval keeps the stored key 'Child Psych Intake'. */
export const CHILD_PSYCH_REEVAL = CHILD_PSYCH_INTAKE;

/** Note types whose most recent SIGNED note is the reference for a child re-evaluation. */
export const CHILD_REEVAL_SOURCE_TYPES = [CHILD_PSYCH_INITIAL_INTAKE, CHILD_PSYCH_REEVAL, 'Psych Eval', 'Intake'] as const;

/**
 * Stable-history sections brought forward together by "Bring forward all history from
 * <date>". Suicide/Self-Harm Hx and Menstruation and Pregnancy Hx are left out on purpose:
 * they are re-assessed at every evaluation (still available one at a time).
 */
export const CPR_BRING_FORWARD_ALL = [
  CPI.inpatient,
  CPI.outpatient,
  CPI.psychMedHx,
  CPI.abuse,
  CPI.pastMedical,
  CPI.allergies,
  CPI.substanceHx,
  CPI.substanceConsequences,
  CPI.substanceTx,
  CPI.familyHx,
  CPI.familyRelationships,
  CPI.developmental,
  CPI.social,
  CPI.legal,
  CPI.violence,
  CPI.trauma,
  CPI.stressors,
] as const;

/** Child "what changed since <date>" domains (one chip each, optional details). */
export const CHILD_INTERVAL_DOMAINS = [
  { key: 'school', label: 'School', options: ['No change', 'Improved', 'Worsened', 'New IEP / 504', 'Suspension / expulsion', 'Not attending'] },
  { key: 'familyHome', label: 'Family / home', options: ['No change', 'Improved', 'New conflict / stressor', 'Change in custody / placement'] },
  { key: 'symptoms', label: 'Symptoms', options: ['Improved', 'Unchanged', 'Worsened', 'Mixed'] },
  { key: 'meds', label: 'Medications', options: ['No changes', 'Changed', 'Stopped / not taking', 'Side effects'] },
  { key: 'hospitalizations', label: 'Hospitalizations / ER visits', options: ['None', 'Yes'] },
  { key: 'substance', label: 'Substance use', options: ['No change', 'Increased', 'Decreased', 'New use', 'Not assessed'] },
  { key: 'safety', label: 'Safety (self-harm, aggression, abuse)', options: ['No new concerns', 'New concern'] },
] as const satisfies readonly IntervalDomain[];
