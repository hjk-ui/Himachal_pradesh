/**
 * HIPAA psychotherapy notes (45 CFR 164.501): author-only. The caller must be the session note's
 * clinician AND, once a psychotherapy note is stored, its recorded author (authorId). So when a
 * note's clinician is changed, the new clinician never sees the previous author's process notes.
 * A new row's author is always the caller.
 */
export function canUsePsychotherapyNote(input: {
  callerId: string;
  noteClinicianId: string | null | undefined;
  storedAuthorId: string | null | undefined;
}): boolean {
  if (!input.callerId || !input.noteClinicianId || input.noteClinicianId !== input.callerId) return false;
  if (input.storedAuthorId != null && input.storedAuthorId !== input.callerId) return false;
  return true;
}
