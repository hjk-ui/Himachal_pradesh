/**
 * HIPAA guard for public review responses (pure).
 *
 * A reply must never confirm that the reviewer is or was a patient, and never include PHI, even
 * when the reviewer disclosed it themselves (HHS OCR enforcement: Elite Dental 2019, Manasa Health
 * 2023, among others). So a reply cannot mention visits, sessions, treatment, staff who saw them,
 * diagnoses, medications, dates, or address the reviewer by name. AI drafts and staff edits both
 * pass through checkReviewResponse; a failing AI draft is replaced by the safe template.
 */

export type ReviewIssue = { code: 'patient_relationship' | 'clinical_detail' | 'reviewer_name' | 'specific_date' | 'contact_detail' | 'too_long'; match: string };

const RELATIONSHIP = [
  /\byour (visit|visits|appointment|appointments|session|sessions|treatment|care|therapy|therapist|counselor|counsellor|provider|doctor|psychiatrist|clinician|nurse|prescriber|medication|meds|diagnosis|records?|chart|intake|stay|plan|program|experience with (dr|our)\b)/i,
  /\b(as|being) (a|our) (patient|client)\b/i,
  /\bour (patient|client)s? like you\b/i,
  /\bwhen you (came in|were (here|seen|in)|visited|saw)\b/i,
  /\b(we|i) (treated|saw|see|evaluated|prescribed|discharged|admitted)\b/i,
  /\b(our|my) records? (show|indicate)\b/i,
  /\bduring your\b/i,
  /\byou (were|are) (seen|treated|enrolled|admitted|discharged)\b/i,
  /\bthank(s| you) for (choosing|trusting) us (with|for) your\b/i,
  /\b(glad|happy|sorry) (that )?(you|your) (felt|feel|had|were|are) .*\b(better|improv\w*|progress|recover\w*|session|visit|treatment)\b/i,
];

const CLINICAL = [
  /\b(diagnos\w*|depress\w*|anxiety|bipolar|ptsd|adhd|ocd|schizo\w*|psychos\w*|eating disorder|addiction|substance|alcohol|opioid|suicid\w*|self[- ]harm)\b/i,
  /\b(medication|prescription|refill|dosage|mg\b|lab results?|test results?|insurance claim|billing statement|copay)\b/i,
  /\b(prp|iop|php|detox|rehab|inpatient|outpatient program)\b/i,
];

const DATE = /\b(on|last) (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i;
const CONTACT = /[^\s@]+@[^\s@]+\.[a-z]{2,}|\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/i;

export const REVIEW_REPLY_MAX = 600;

/**
 * Issues in a proposed reply. The practice phone / email may appear (pass them as allowed) so the
 * reply can invite the reviewer to call the office.
 */
export function checkReviewResponse(
  text: string,
  opts: { reviewerName?: string | null; allowedContacts?: (string | null | undefined)[] } = {},
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const t = text ?? '';
  for (const re of RELATIONSHIP) {
    const m = re.exec(t);
    if (m) issues.push({ code: 'patient_relationship', match: m[0] });
  }
  for (const re of CLINICAL) {
    const m = re.exec(t);
    if (m) issues.push({ code: 'clinical_detail', match: m[0] });
  }
  const name = (opts.reviewerName ?? '').trim();
  if (name) {
    for (const part of name.split(/\s+/).filter((p) => p.length >= 3)) {
      const re = new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(t)) {
        issues.push({ code: 'reviewer_name', match: part });
        break;
      }
    }
  }
  const d = DATE.exec(t);
  if (d) issues.push({ code: 'specific_date', match: d[0] });
  const allowed = (opts.allowedContacts ?? []).filter(Boolean).map((c) => String(c).replace(/\D/g, '') || String(c).toLowerCase());
  let scan = t;
  for (;;) {
    const c = CONTACT.exec(scan);
    if (!c) break;
    const norm = c[0].includes('@') ? c[0].toLowerCase() : c[0].replace(/\D/g, '');
    if (!allowed.includes(norm)) {
      issues.push({ code: 'contact_detail', match: c[0] });
      break;
    }
    scan = scan.slice((c.index ?? 0) + c[0].length);
  }
  if (t.length > REVIEW_REPLY_MAX) issues.push({ code: 'too_long', match: `${t.length} characters` });
  return issues;
}

export const REVIEW_ISSUE_TEXT: Record<ReviewIssue['code'], string> = {
  patient_relationship: 'Implies the reviewer is a patient (visit, session, treatment, provider). Remove it.',
  clinical_detail: 'Mentions a condition, service or medication. Remove it, even if the reviewer mentioned it.',
  reviewer_name: "Uses the reviewer's name. Replies stay anonymous.",
  specific_date: 'Mentions a specific date or day. Remove it.',
  contact_detail: 'Contains a phone number or email that is not the practice’s.',
  too_long: 'Keep replies short (under 600 characters).',
};

/**
 * Safe reply template: thanks the person for feedback about the practice, never acknowledges a
 * relationship, and (for 1-3 stars) invites an offline conversation with the office.
 */
export function safeReviewResponse(rating: number, opts: { practiceName: string; officePhone?: string | null }): string {
  const name = opts.practiceName.trim() || 'our practice';
  const phone = opts.officePhone?.trim();
  if (rating >= 4) {
    return `Thank you for taking the time to share your feedback about ${name}. We are committed to offering a welcoming, respectful place for everyone in our community, and we appreciate you helping others learn about us.`;
  }
  const call = phone ? ` Please call our office at ${phone} and ask for the practice manager` : ' Please contact our office and ask for the practice manager';
  return `Thank you for your feedback. We take every comment seriously and use it to improve. To protect everyone's privacy, we never discuss details in a public forum.${call} so we can listen and help.`;
}

/** Final check used by the API: the draft if it passes, else the safe template. */
export function enforceSafeReply(
  draft: string | null | undefined,
  review: { rating: number; authorName?: string | null },
  opts: { practiceName: string; officePhone?: string | null; officeEmail?: string | null },
): { text: string; replaced: boolean; issues: ReviewIssue[] } {
  const text = (draft ?? '').trim();
  const issues = text ? checkReviewResponse(text, { reviewerName: review.authorName, allowedContacts: [opts.officePhone, opts.officeEmail] }) : [];
  if (text && issues.length === 0) return { text, replaced: false, issues };
  return { text: safeReviewResponse(review.rating, opts), replaced: true, issues };
}
