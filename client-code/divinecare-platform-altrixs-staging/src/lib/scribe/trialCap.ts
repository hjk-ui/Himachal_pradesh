/**
 * AI Scribe minutes during the free trial (pure, browser-safe).
 *
 * A trialing organization gets TRIAL_AI_SCRIBE_MINUTES of live session audio in total (in person,
 * telehealth and dictation, as metered on scribe_captures.capture_seconds). Pasted or imported text
 * uses no minutes and stays available. Paid, comped and grandfathered organizations are not capped
 * here (paid plans have the pooled allowance plus overage instead).
 */
import { TRIAL_AI_SCRIBE_MINUTES } from '@/lib/billing/plans';

export const TRIAL_SCRIBE_LIMIT_SECONDS = TRIAL_AI_SCRIBE_MINUTES * 60;
export const TRIAL_SCRIBE_LIMIT_CODE = 'trial_scribe_limit';
export const TRIAL_SCRIBE_LIMIT_MESSAGE = `Your free trial includes ${TRIAL_AI_SCRIBE_MINUTES} minutes of AI Scribe session audio for the whole organization, and they have been used. Nothing more was captured. You can still paste or type a session summary for an AI draft, or choose a plan in Plan & Subscription to keep using live capture.`;

/** Capture engines whose minutes are metered (live audio). */
export function isMeteredCaptureEngine(engine: string | null | undefined): boolean {
  return engine !== 'paste' && engine !== 'import';
}

export type TrialScribeAllowance =
  | { limited: false }
  | { limited: true; usedSeconds: number; limitSeconds: number; remainingSeconds: number; exhausted: boolean };

export function trialScribeAllowance(
  access: { status: string; unlimited: boolean },
  usedSeconds: number,
  limitSeconds = TRIAL_SCRIBE_LIMIT_SECONDS
): TrialScribeAllowance {
  if (access.unlimited || access.status !== 'trialing') return { limited: false };
  const used = Math.max(0, Math.floor(usedSeconds || 0));
  const remainingSeconds = Math.max(0, limitSeconds - used);
  return { limited: true, usedSeconds: used, limitSeconds, remainingSeconds, exhausted: remainingSeconds <= 0 };
}
