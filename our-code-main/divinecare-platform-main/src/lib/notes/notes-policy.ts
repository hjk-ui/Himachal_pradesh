/**
 * Progress notes industry-standard policy (owner-delegated, Oct 21 staging).
 * Defaults: 72h sign deadline; late-entry reason; 85% clone warn; diagnosis to sign.
 */

export const NOTE_SIGN_DEADLINE_HOURS = 72;
export const NOTE_CLONE_WARN_SIMILARITY = 0.85;
export const NOTE_FORMAT_ELEMENTS_ENFORCE_FROM = '2026-11-16';
export const NOTE_AMENDMENT_DAYS = 60;
export const NOTE_AMENDMENT_EXTENSION_DAYS = 30;

export function isPastSignDeadline(createdAt: Date, now = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > NOTE_SIGN_DEADLINE_HOURS * 60 * 60 * 1000;
}

export function requiresLateEntryReason(createdAt: Date, lateEntryReason?: string | null): {
  required: boolean;
  ok: boolean;
  error?: string;
} {
  if (!isPastSignDeadline(createdAt)) return { required: false, ok: true };
  const reason = (lateEntryReason || '').trim();
  if (reason.length < 5) {
    return {
      required: true,
      ok: false,
      error: 'Late-entry reason required when signing after the 72-hour deadline',
    };
  }
  return { required: true, ok: true };
}

/** Dice coefficient on word sets — warn at ≥85% similarity (does not block). */
export function noteCloneSimilarity(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}

export function shouldWarnCloneSimilarity(current: string, prior: string): boolean {
  return noteCloneSimilarity(current, prior) >= NOTE_CLONE_WARN_SIMILARITY;
}

// ─── Oct 24 documentation policy (diagnosis to sign, diagnosis review, note-section enforcement) ───

export const NOTES_POLICY_MODULE = 'practice:notes-policy';

export const DIAGNOSIS_REVIEW_DAYS_DEFAULT = 90;
export const DIAGNOSIS_REVIEW_DAYS_MIN = 30;
export const DIAGNOSIS_REVIEW_DAYS_MAX = 365;

export type NotesPolicy = {
  /** A note cannot be signed until the client has a current diagnosis on the list. */
  requireDiagnosisToSign: boolean;
  /** The diagnosis list is due for review this many days after the last review. */
  diagnosisReviewDays: number;
};

export const DEFAULT_NOTES_POLICY: NotesPolicy = {
  requireDiagnosisToSign: true,
  diagnosisReviewDays: DIAGNOSIS_REVIEW_DAYS_DEFAULT,
};

/** Coerce stored/posted values into a valid policy. Out-of-range days are clamped to 30–365. */
export function normalizeNotesPolicy(input: unknown): NotesPolicy {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof NotesPolicy, unknown>>;
  const days = Number(raw.diagnosisReviewDays);
  return {
    requireDiagnosisToSign:
      typeof raw.requireDiagnosisToSign === 'boolean'
        ? raw.requireDiagnosisToSign
        : DEFAULT_NOTES_POLICY.requireDiagnosisToSign,
    diagnosisReviewDays: Number.isFinite(days)
      ? Math.min(DIAGNOSIS_REVIEW_DAYS_MAX, Math.max(DIAGNOSIS_REVIEW_DAYS_MIN, Math.round(days)))
      : DIAGNOSIS_REVIEW_DAYS_DEFAULT,
  };
}

/** Loaded lazily so client components can import the constants above without pulling in Prisma. */
export async function getNotesPolicy(organizationId: string): Promise<NotesPolicy> {
  const { getModuleData } = await import('@/lib/modules/manage');
  return normalizeNotesPolicy(await getModuleData<Partial<NotesPolicy>>(organizationId, NOTES_POLICY_MODULE));
}

export async function saveNotesPolicy(organizationId: string, input: unknown): Promise<NotesPolicy> {
  const { saveModuleData } = await import('@/lib/modules/manage');
  const policy = normalizeNotesPolicy(input);
  await saveModuleData(organizationId, NOTES_POLICY_MODULE, policy);
  return policy;
}

/** Roles that may see and change the Documentation policy. */
export function canEditNotesPolicy(role: string | null | undefined): boolean {
  return ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'].includes((role || '').toUpperCase());
}

export function diagnosisReviewDue(lastReviewedAt: Date | null | undefined, days: number, now = new Date()): boolean {
  if (!lastReviewedAt) return true;
  return now.getTime() - lastReviewedAt.getTime() > days * 24 * 60 * 60 * 1000;
}

export const DIAGNOSIS_REQUIRED_TO_SIGN_MESSAGE =
  'Add a current diagnosis to the diagnosis list before signing this note.';

/** Required note sections: warn until NOTE_FORMAT_ELEMENTS_ENFORCE_FROM, then block. */
export function requiredNoteSectionsNotice(): string {
  return `Required note sections: warn until ${NOTE_FORMAT_ELEMENTS_ENFORCE_FROM}, then block`;
}

/**
 * Severity of a missing required note element on a clinic date (YYYY-MM-DD):
 * `warn` before NOTE_FORMAT_ELEMENTS_ENFORCE_FROM, `block` from that date on.
 */
export function formatElementsGate(today: string): 'warn' | 'block' {
  return today >= NOTE_FORMAT_ELEMENTS_ENFORCE_FROM ? 'block' : 'warn';
}

export function noteSectionsEnforcement(today: string): 'warn' | 'block' {
  return formatElementsGate(today);
}
