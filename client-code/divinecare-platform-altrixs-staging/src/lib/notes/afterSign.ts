/**
 * What happens right after a note is signed (pure, no I/O; tested in tests/bh-workflow.test.ts).
 *
 * Signing from either sign path (PATCH /api/notes/[id] or PATCH /api/ehr/notes/[id]/workflow)
 * drafts the claim from the note (CPT, diagnoses, DOS, POS, rendering provider come from the note;
 * nothing is re-entered). The result is summarized for the clinician, and the editor shows the
 * next actions: book the follow-up, open the claim, go back to the schedule / worklist.
 */

export type ClaimGenerationResult =
  | { ok: true; claim: { id: string; status: string }; alreadyExisted?: boolean }
  | { ok: false; error: string; status?: number }
  | null
  | undefined;

export type ClaimSummary = {
  claimId: string | null;
  claimStatus: string | null;
  /** One line for the clinician: created, already there, or why no claim was drafted */
  message: string;
};

/** Non-billable signed notes (no CPT, e.g. a no-show) say so plainly instead of an error. */
export function summarizeClaimResult(r: ClaimGenerationResult): ClaimSummary {
  if (!r) return { claimId: null, claimStatus: null, message: 'No claim was drafted (billing could not be reached). Billing can create it from the signed note.' };
  if (r.ok) {
    return {
      claimId: r.claim.id,
      claimStatus: r.claim.status,
      message: r.alreadyExisted ? `Claim already on file (${r.claim.status.toLowerCase()}).` : 'Claim drafted for billing from this note.',
    };
  }
  const error = String((r as { error?: string }).error || 'billing could not draft it');
  if (/No CPT on the signed note/i.test(error)) {
    return { claimId: null, claimStatus: null, message: 'No service code on this note, so no claim was drafted (not billable).' };
  }
  if (/co-?sign/i.test(error)) {
    return { claimId: null, claimStatus: null, message: 'The claim is drafted after your supervisor co-signs.' };
  }
  return { claimId: null, claimStatus: null, message: `No claim drafted: ${error}` };
}

export type AfterSignAction = { id: 'book_follow_up' | 'open_claim' | 'treatment_plan' | 'review_diagnoses' | 'worklist' | 'schedule'; label: string; href: string };

/**
 * Intakes / evaluations establish the diagnosis: after signing, prompt to confirm the chart's
 * diagnosis list (rank, status, "Reviewed — no change"). Appended by the sign UI after the
 * treatment-plan action; null for other note types.
 */
export function intakeDiagnosisReviewAction(input: { clientId: string; noteType: string | null }): AfterSignAction | null {
  const type = String(input.noteType || '').trim();
  if (!/intake|eval/i.test(type)) return null;
  return { id: 'review_diagnoses', label: 'Review the diagnosis list', href: `/dashboard/clients/${encodeURIComponent(input.clientId)}?tab=diagnoses` };
}

/**
 * Next actions after signing. Intakes lead to the treatment plan; visits with a suggested
 * interval offer the follow-up (opens the New Appointment form for the client on that date).
 */
export function afterSignActions(input: {
  clientId: string;
  noteType: string | null;
  claimId: string | null;
  /** Follow-up booking link (bookFollowUpHref) when a follow-up applies; null otherwise */
  followUpHref: string | null;
  followUpLabel?: string | null;
  /** A future visit is already booked: no booking prompt */
  nextBooked?: boolean;
  /** The viewer's role can open billing claims (clinicians cannot: they see the summary line only) */
  canOpenClaims?: boolean;
}): AfterSignAction[] {
  const out: AfterSignAction[] = [];
  const c = encodeURIComponent(input.clientId);
  const type = String(input.noteType || '').trim();
  if (/intake/i.test(type) && !/psych/i.test(type)) {
    out.push({ id: 'treatment_plan', label: 'Write the treatment plan', href: `/dashboard/ehr/treatment-plans?clientId=${c}` });
  }
  if (input.followUpHref && !input.nextBooked) {
    out.push({ id: 'book_follow_up', label: input.followUpLabel || 'Book follow-up', href: input.followUpHref });
  }
  if (input.claimId && input.canOpenClaims) {
    out.push({ id: 'open_claim', label: 'View claim', href: `/dashboard/billing/claims?claimId=${encodeURIComponent(input.claimId)}` });
  }
  out.push({ id: 'worklist', label: 'Next note to sign', href: '/dashboard/ehr/notes?tab=ready' });
  out.push({ id: 'schedule', label: "Back to today's schedule", href: '/dashboard' });
  return out;
}
