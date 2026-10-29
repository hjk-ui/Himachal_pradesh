export function sanitizeJournal(note: string | null | undefined) {
  if (!note) return null;
  return note.trim().slice(0, 1000) || null;
}
