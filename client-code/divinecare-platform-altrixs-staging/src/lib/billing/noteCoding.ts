import { parseNoteMeta } from '@/lib/ehr/noteTemplates';

/**
 * The CPT the clinician recorded on an older note in its hidden metadata comment (before the
 * ProgressNote.cptCode column existed). Returns null when none was recorded: codes are never
 * scraped from the note text or guessed from the appointment type.
 */
export function extractNoteCpt(body: string): string | null {
  const selected = parseNoteMeta(body).billingCode?.trim().toUpperCase();
  return selected && /^[A-Z0-9]{5}(-[A-Z0-9]{2}){0,4}$/.test(selected) ? selected : null;
}
