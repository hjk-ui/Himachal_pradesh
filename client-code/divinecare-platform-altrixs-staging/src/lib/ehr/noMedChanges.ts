/**
 * "No medication changes" checkbox on the Plan - Med Changes section (Psych Med Mgmt, Adult / Child
 * Psychiatry Intake and Re-Eval). Pure, browser-safe.
 *
 * The prescriber ticks it: the section then reads NO_MED_CHANGES_TEXT, the medication rows and the
 * free-text box are cleared and disabled, and the section counts as documented for the required
 * checks (visit protocol "Prescribing decision" / "Medication plan"). The AI never ticks it: Plan -
 * Med Changes stays a clinician-only section (NEVER_AI_HEADINGS), and text carrying the AI DRAFT
 * marker never restores the checkbox.
 */
import { AI_DRAFT_MARKER } from '@/lib/ai/noteDraftFormats';

export const NO_MED_CHANGES_LABEL = 'No medication changes';
export const NO_MED_CHANGES_TEXT = 'No medication changes this visit; continue current medications as prescribed.';

/** Saved section text → was the box ticked (only text the clinician's checkbox wrote, never an AI draft). */
export function hasNoMedChanges(sectionText: string | null | undefined): boolean {
  const t = sectionText || '';
  return !t.includes(AI_DRAFT_MARKER) && t.includes(NO_MED_CHANGES_TEXT);
}

/** The free text left after the checkbox's sentence is taken out (restoring a saved draft). */
export function stripNoMedChanges(sectionText: string | null | undefined): string {
  return (sectionText || '').split(NO_MED_CHANGES_TEXT).join('').replace(/\n{3,}/g, '\n\n').trim();
}

export type MedChangesState = { noMedChanges: boolean; generated: string; comment: string };

/** Section text: the checkbox sentence alone when ticked (rows and free text are cleared), else rows + free text. */
export function medChangesSectionText(s: MedChangesState): string {
  if (s.noMedChanges) return NO_MED_CHANGES_TEXT;
  return [s.generated.trim(), s.comment.trim()].filter(Boolean).join('\n\n');
}

/** Ticking the box clears what it replaces: new-medication rows go, current rows lose their action. */
export function applyNoMedChanges<R extends { medId: string | null; action: string; newDose: string; sig: string; reason: string }>(rows: R[]): R[] {
  return rows.filter((r) => r.medId).map((r) => ({ ...r, action: '', newDose: '', sig: '', reason: '' }));
}

/** Required-section check: documented when ticked, or when rows / free text say something. */
export function medChangesDocumented(sectionText: string | null | undefined): boolean {
  return Boolean((sectionText || '').replace(AI_DRAFT_MARKER, '').trim());
}
