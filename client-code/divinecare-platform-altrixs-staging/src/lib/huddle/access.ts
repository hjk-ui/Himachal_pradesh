/**
 * Huddle sheet role rules. Pure and browser-safe (the Today entry imports this, not core.ts).
 * Same roles as the pre-visit brief (canRequestClientBriefing): leadership, licensed BH clinicians and
 * primary-care providers. Leadership may open another provider's huddle; everyone else sees their own.
 */
const LEADERSHIP = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);
const HUDDLE_ROLES = new Set([...LEADERSHIP, 'CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP']);
const up = (r: string | null | undefined) => String(r ?? '').toUpperCase();

export function canViewHuddle(role: string | null | undefined): boolean {
  return HUDDLE_ROLES.has(up(role));
}

/** PRACTICE_DIRECTOR / ADMIN / DIRECTOR may open another provider's huddle */
export function canPickHuddleProvider(role: string | null | undefined): boolean {
  return LEADERSHIP.has(up(role));
}

/** Providers see only their own schedule; a requested provider id is honoured for leadership only */
export function resolveHuddleProvider(viewer: { userId: string; role: string }, requested: string | null | undefined): string {
  const r = String(requested ?? '').trim();
  return r && canPickHuddleProvider(viewer.role) ? r : viewer.userId;
}
