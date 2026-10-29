/**
 * AOT form deadlines and outreach rules (pure). Used by the caseboard flags and the participant Forms tab.
 *
 *   - Plan for Continued Treatment: due at least 30 days before the order expires (orderEnd − 30 days),
 *     per the MDH treatment plan closing statement.
 *   - AOT Treatment Plan: needed before the hearing (flag while a hearing is scheduled and no signed plan).
 *   - Psychiatrist Affidavit: needed with the petition (flag at the petition / hearing stage while unsigned).
 *   - Non-responsive letter: suggested after 3 or more failed outreach attempts in a row with no signed
 *     letter since (Altrixs practice threshold, not an MDH rule).
 */
import type { FormType } from './engine';

export const CONTINUED_PLAN_LEAD_DAYS = 30;
export const LETTER_SUGGEST_AFTER_FAILED = 3;
const DAY = 86400000;

export const OUTREACH_METHODS = [
  { value: 'phone', label: 'Phone' },
  { value: 'mail', label: 'Mail' },
  { value: 'in_person', label: 'In person' },
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'other', label: 'Other' },
] as const;

export const OUTREACH_STAFF_ROLES = [
  { value: 'cprs', label: 'CPRS' },
  { value: 'case_manager', label: 'Case manager' },
  { value: 'psychiatrist', label: 'Psychiatrist' },
  { value: 'other', label: 'Other' },
] as const;

/** Result choices offered when logging an attempt; the stored result starts with one of these. */
export const OUTREACH_OUTCOMES = [
  'Reached — engaged',
  'No answer',
  'Left message',
  'Wrong / disconnected number',
  'Mail returned',
  'No response',
  'Declined',
  'Other',
] as const;

const FAILED_OUTCOMES = ['No answer', 'Left message', 'Wrong / disconnected number', 'Mail returned', 'No response', 'Declined'];

export type OutreachLite = { attemptedAt: Date | string; result: string; method?: string };

export function isFailedOutreach(result: string): boolean {
  const r = String(result ?? '').trim().toLowerCase();
  return FAILED_OUTCOMES.some((o) => r.startsWith(o.toLowerCase()));
}

export function isSuccessfulOutreach(result: string): boolean {
  return String(result ?? '').trim().toLowerCase().startsWith('reached');
}

/** Failed attempts since the last successful contact (attempts in any order). */
export function failedOutreachStreak(attempts: OutreachLite[]): number {
  const sorted = [...attempts].sort((a, b) => new Date(a.attemptedAt).getTime() - new Date(b.attemptedAt).getTime());
  let streak = 0;
  for (const a of sorted) {
    if (isSuccessfulOutreach(a.result)) streak = 0;
    else if (isFailedOutreach(a.result)) streak += 1;
  }
  return streak;
}

/** ≥3 failed attempts in a row and no letter signed after the last of them. */
export function suggestNonResponsiveLetter(attempts: OutreachLite[], lastLetterSignedAt?: Date | string | null): boolean {
  if (failedOutreachStreak(attempts) < LETTER_SUGGEST_AFTER_FAILED) return false;
  if (!lastLetterSignedAt) return true;
  const lastAttempt = Math.max(...attempts.map((a) => new Date(a.attemptedAt).getTime()));
  return new Date(lastLetterSignedAt).getTime() < lastAttempt;
}

function toYmd(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = typeof v === 'string' ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v) : v;
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Order end − 30 days, as YYYY-MM-DD (date-only arithmetic in UTC). */
export function continuedPlanDueDate(orderEnd: Date | string | null | undefined): string | null {
  const ymd = toYmd(orderEnd);
  if (!ymd) return null;
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - CONTINUED_PLAN_LEAD_DAYS * DAY).toISOString().slice(0, 10);
}

export function daysUntil(ymd: string, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((new Date(`${ymd}T00:00:00Z`).getTime() - today) / DAY);
}

export type ParticipantLite = {
  status: string;
  hearingDate?: Date | string | null;
  petitionDate?: Date | string | null;
  orderStart?: Date | string | null;
  orderEnd?: Date | string | null;
};

export type DocLite = { formType: string; status: string; signedAt?: Date | string | null };

export type FlagStatus = 'overdue' | 'due' | 'upcoming';
export type FormFlag = {
  id: string;
  formType: FormType;
  label: string;
  due: string | null;
  daysLeft: number | null;
  status: FlagStatus;
  basis: string;
};

function flagStatus(daysLeft: number | null): FlagStatus {
  if (daysLeft === null) return 'due';
  if (daysLeft < 0) return 'overdue';
  return daysLeft <= 7 ? 'due' : 'upcoming';
}

const signed = (docs: DocLite[], type: FormType) => docs.filter((d) => d.formType === type && d.status === 'signed');

/** When each form is due for this participant (null when no date applies yet). */
export function formDueDates(p: ParticipantLite): Partial<Record<FormType, { due: string | null; basis: string }>> {
  return {
    psychiatrist_affidavit: { due: toYmd(p.petitionDate), basis: 'Filed with the petition' },
    treatment_plan: { due: toYmd(p.hearingDate), basis: 'Presented at the hearing' },
    continued_treatment_plan: {
      due: continuedPlanDueDate(p.orderEnd),
      basis: `At least ${CONTINUED_PLAN_LEAD_DAYS} days before the order expires`,
    },
  };
}

export function aotFormFlags(p: ParticipantLite, docs: DocLite[], attempts: OutreachLite[], now = new Date()): FormFlag[] {
  const flags: FormFlag[] = [];
  const dues = formDueDates(p);

  // Plan for Continued Treatment: orderEnd − 30d, satisfied by a plan signed in this order period.
  if (p.orderEnd && ['active', 'renewal'].includes(p.status)) {
    const start = p.orderStart ? new Date(p.orderStart).getTime() : null;
    const done = signed(docs, 'continued_treatment_plan').some((d) => !start || (d.signedAt && new Date(d.signedAt).getTime() >= start));
    const due = dues.continued_treatment_plan.due;
    if (!done && due) {
      const left = daysUntil(due, now);
      flags.push({
        id: 'form-continued-plan',
        formType: 'continued_treatment_plan',
        label: 'Plan for Continued Treatment due',
        due,
        daysLeft: left,
        status: flagStatus(left),
        basis: `Order ends ${toYmd(p.orderEnd)}; CCT plan due ${CONTINUED_PLAN_LEAD_DAYS} days before (MDH treatment plan closing statement)`,
      });
    }
  }

  // AOT Treatment Plan unsigned while a hearing is scheduled.
  if (p.hearingDate && ['petition', 'hearing'].includes(p.status) && signed(docs, 'treatment_plan').length === 0) {
    const due = toYmd(p.hearingDate);
    const left = due ? daysUntil(due, now) : null;
    flags.push({
      id: 'form-treatment-plan',
      formType: 'treatment_plan',
      label: 'AOT Treatment Plan (MDH#0001BHA) not signed',
      due,
      daysLeft: left,
      status: flagStatus(left),
      basis: 'Hearing scheduled; the testifying psychiatrist presents the signed plan',
    });
  }

  // Psychiatrist Affidavit unsigned at the petition stage.
  if (['petition', 'hearing'].includes(p.status) && signed(docs, 'psychiatrist_affidavit').length === 0) {
    const due = toYmd(p.petitionDate);
    const left = due ? daysUntil(due, now) : null;
    flags.push({
      id: 'form-affidavit',
      formType: 'psychiatrist_affidavit',
      label: 'Psychiatrist Affidavit (MDH#0004BHA) not signed',
      due,
      daysLeft: left,
      status: flagStatus(left),
      basis: 'Petition stage; the affidavit accompanies the petition',
    });
  }

  // Non-responsive outreach.
  const letters = signed(docs, 'nonresponsive_letter')
    .map((d) => (d.signedAt ? new Date(d.signedAt).getTime() : 0))
    .sort((a, b) => b - a);
  if (suggestNonResponsiveLetter(attempts, letters[0] ? new Date(letters[0]) : null)) {
    flags.push({
      id: 'form-nonresponsive-letter',
      formType: 'nonresponsive_letter',
      label: `${failedOutreachStreak(attempts)} failed outreach attempts — consider the non-responsive letter (MDH#0002BHA)`,
      due: null,
      daysLeft: null,
      status: 'due',
      basis: `Altrixs practice threshold: ${LETTER_SUGGEST_AFTER_FAILED} failed attempts in a row`,
    });
  }

  return flags;
}
