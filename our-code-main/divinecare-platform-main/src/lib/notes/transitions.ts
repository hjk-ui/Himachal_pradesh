export type StoredNoteStatus = 'DRAFT' | 'SIGNED' | 'LOCKED';

/** Finalized content is immutable. A repeated request is safe; regression is never allowed. */
export function noteTransition(current: StoredNoteStatus, requested: 'SIGNED' | 'LOCKED') {
  if (current === requested) return { allowed: true, changed: false };
  // Sign & Lock may jump DRAFT → LOCKED in one step (sets signedAt + lockedAt).
  if (
    (current === 'DRAFT' && requested === 'SIGNED') ||
    (current === 'DRAFT' && requested === 'LOCKED') ||
    (current === 'SIGNED' && requested === 'LOCKED')
  ) {
    return { allowed: true, changed: true };
  }
  return { allowed: false, changed: false };
}
