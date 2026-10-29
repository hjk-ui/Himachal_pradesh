/**
 * Dismissing an unsigned note (pure, browser-safe). Prescriber feedback: a draft that is not needed
 * any more (created in error, duplicate, the visit didn't happen) can be dismissed while viewing it.
 *
 * Industry standard: clinical drafts are never hard-deleted. The note is marked dismissed (who,
 * when, reason), drops out of every documentation queue and deadline count, and stays readable
 * (read-only) for leadership and audit. The author can undo within DISMISS_UNDO_DAYS. Signed,
 * locked and co-signed notes cannot be dismissed (they are corrected by addendum).
 * Server side: src/lib/notes/dismissStore.ts.
 */

export const DISMISS_REASONS = ['Created in error', 'Duplicate note', "Visit didn't happen", 'Wrong client', 'Other'] as const;
export type DismissReasonChoice = (typeof DISMISS_REASONS)[number];

export const DISMISS_REASON_MIN_CHARS = 5;
export const DISMISS_REASON_MAX_CHARS = 300;
export const DISMISS_UNDO_DAYS = 30;

/** Prisma filter: the note is live (not dismissed). Every documentation queue / count uses it. */
export const NOT_DISMISSED = { dismissedAt: null };

/** Stored reason: the choice, with the details after it ("Other: …" needs the details). */
export function composeDismissReason(choice: string, details: string): string {
  const d = (details || '').trim();
  const c = (choice || '').trim();
  if (!c) return d;
  if (c === 'Other') return d ? `Other: ${d}` : '';
  return d ? `${c}: ${d}` : c;
}

export function dismissReasonError(reason: string | null | undefined): string | null {
  const r = (reason || '').trim();
  if (r.length < DISMISS_REASON_MIN_CHARS) return `Give a reason for dismissing the note (at least ${DISMISS_REASON_MIN_CHARS} characters).`;
  if (r.length > DISMISS_REASON_MAX_CHARS) return `Keep the reason under ${DISMISS_REASON_MAX_CHARS} characters.`;
  return null;
}

/**
 * Why this note cannot be dismissed (null = it can). Status is the workflow status: no workflow row
 * or DRAFT = unsigned.
 */
export function dismissBlocker(input: { status: string | null | undefined; cosignedAt?: Date | string | null; dismissedAt?: Date | string | null }): string | null {
  if (input.dismissedAt) return 'This note is already dismissed.';
  const s = String(input.status || 'DRAFT').toUpperCase();
  if (s !== 'DRAFT' || input.cosignedAt) return 'Only an unsigned note can be dismissed. Signed notes are corrected with an addendum.';
  return null;
}

/** Undo: the author (or leadership that can edit others' drafts) within DISMISS_UNDO_DAYS. */
export function undoDismissBlocker(input: {
  dismissedAt: Date | string | null | undefined;
  now: Date;
  isAuthor: boolean;
  elevated: boolean;
}): string | null {
  if (!input.dismissedAt) return 'This note is not dismissed.';
  if (!input.isAuthor && !input.elevated) return 'Only the note author can undo the dismissal.';
  const at = new Date(input.dismissedAt).getTime();
  if (input.now.getTime() - at > DISMISS_UNDO_DAYS * 86_400_000) {
    return `Dismissed more than ${DISMISS_UNDO_DAYS} days ago: the note stays dismissed (read-only).`;
  }
  return null;
}

export function canUndoDismiss(input: Parameters<typeof undoDismissBlocker>[0]): boolean {
  return undoDismissBlocker(input) === null;
}
