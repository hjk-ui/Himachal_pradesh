/**
 * Identifying Information (Oct 25) — sign issues.
 * Severity follows formatElementsGate: warn until NOTE_FORMAT_ELEMENTS_ENFORCE_FROM (2026-11-16), then block.
 */
import { formatElementsGate } from '@/lib/notes/notes-policy';
import {
  SIGN_ISSUE_CHIEF_COMPLAINT,
  SIGN_ISSUE_GUARDIAN_BLANK,
  SIGN_ISSUE_GUARDIAN_SELF,
  SIGN_ISSUE_VISIT_MODALITY,
} from './copy';
import { hasIdentifyingInformation, isBlank } from './fields';
import type { IdentifyingValues, SignIssue } from './types';

export const MINOR_AGE_YEARS = 18;

export type IdentifyingSignInput = {
  noteType: string | null | undefined;
  values: IdentifyingValues;
  /** Whole years from the chart date of birth; null when unknown (guardian rules then do not apply). */
  ageYears: number | null;
  /** Clinic date, YYYY-MM-DD. */
  today: string;
};

export function identifyingSignIssues(input: IdentifyingSignInput): SignIssue[] {
  if (!hasIdentifyingInformation(input.noteType)) return [];
  const severity = formatElementsGate(input.today);
  const issues: SignIssue[] = [];

  if (isBlank(input.values.chiefComplaint)) {
    issues.push({
      code: 'chief_complaint',
      fieldKey: 'chiefComplaint',
      message: SIGN_ISSUE_CHIEF_COMPLAINT,
      severity,
    });
  }

  if (isBlank(input.values.visitModality)) {
    issues.push({
      code: 'visit_modality',
      fieldKey: 'visitModality',
      message: SIGN_ISSUE_VISIT_MODALITY,
      severity,
    });
  }

  if (input.ageYears !== null && input.ageYears < MINOR_AGE_YEARS) {
    const guardian = (input.values.legalGuardian ?? '').trim();
    if (!guardian) {
      issues.push({
        code: 'guardian_blank',
        fieldKey: 'legalGuardian',
        message: SIGN_ISSUE_GUARDIAN_BLANK,
        severity,
      });
    } else if (/^self$/i.test(guardian)) {
      issues.push({
        code: 'guardian_self',
        fieldKey: 'legalGuardian',
        message: SIGN_ISSUE_GUARDIAN_SELF,
        severity,
      });
    }
  }

  return issues;
}

/** True when any issue would stop the note from being signed today. */
export function hasBlockingIdentifyingIssue(issues: SignIssue[]): boolean {
  return issues.some((i) => i.severity === 'block');
}
