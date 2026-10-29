/**
 * "Dismiss scribe": the clinician stops and discards a capture during the session or after it,
 * before a draft note is created from it. Pure, browser-safe (the control route applies it).
 *
 * Follows the consent-withdrawn deletion rule: recording / transcription stops at once (browser
 * stream closed, Chime live transcription stopped), every transcript segment, AI draft and client
 * summary of the capture is deleted, and the capture is marked discarded. What remains is metadata
 * only: the capture row (ids, mode, engine, times, metered seconds) and the SCRIBE_CAPTURE_DISMISSED
 * audit row (who, when, capture id, counts, optional reason from a fixed list). No transcript text.
 * Once a draft note exists the capture can no longer be dismissed: the note is edited or deleted in
 * Notes, and the transcript follows the normal retention rule.
 */

export const DISMISS_CONFIRM = 'Stop and discard this recording? Nothing from it will be kept.';
export const DISMISS_LABEL = 'Dismiss scribe';
export const DISMISSED_NOTICE = 'AI Scribe dismissed: recording stopped and nothing from it was kept. Write the note yourself.';

/** Optional reasons (stored as the enum in the audit row; never free text). */
export const DISMISS_REASONS = ['not_needed', 'wrong_client_or_visit', 'technical_problem', 'participant_request', 'other'] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];
export const DISMISS_REASON_LABELS: Record<DismissReason, string> = {
  not_needed: 'Not needed for this visit',
  wrong_client_or_visit: 'Wrong client or visit',
  technical_problem: 'Technical problem',
  participant_request: 'A participant asked to stop',
  other: 'Other',
};

export type DismissableCapture = {
  status: string;
  progressNoteId: string | null;
  consentWithdrawnAt?: Date | string | null;
};

/** Why a capture cannot be dismissed (null = it can). Dismissing twice is refused, not repeated. */
export function dismissBlocker(cap: DismissableCapture): string | null {
  if (cap.progressNoteId || cap.status === 'note_created') {
    return 'A draft note was already created from this capture. Edit or delete the draft note in Notes instead.';
  }
  if (cap.consentWithdrawnAt) return 'Consent was withdrawn for this capture; its transcript is already deleted.';
  if (cap.status === 'discarded') return 'This capture was already dismissed.';
  return null;
}

/** Capture states in which the UI offers "Dismiss scribe". */
export function canDismiss(cap: DismissableCapture | null | undefined): boolean {
  return Boolean(cap) && dismissBlocker(cap as DismissableCapture) === null;
}

/** Fields the control route writes on dismiss (transcript text is deleted separately). */
export function DISMISSED_CAPTURE_DATA(now: Date) {
  return {
    status: 'discarded',
    stoppedAt: now,
    transcriptPurgedAt: now,
    clientSummary: null,
    clientSummaryStatus: null,
  } as const;
}
