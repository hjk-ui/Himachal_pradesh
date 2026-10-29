/**
 * One-click AI Scribe session start — why capture is blocked.
 * Pure (no I/O) so server routes, the dock, and tests share one definition.
 * Nothing here invents a default: callers must pass real plan / settings / consent state.
 */

export const SCRIBE_BLOCKED_REASONS = {
  plan: 'AI Scribe is not included in this practice’s plan.',
  practice_off: 'AI Scribe is turned off in practice settings.',
  client_declined:
    'This client declined AI use. Nothing is captured; document the session yourself.',
  recording_revoked:
    'This client revoked consent to session recording. Nothing is captured; you can still dictate a recap.',
} as const;

export type ScribeBlockedCode = keyof typeof SCRIBE_BLOCKED_REASONS;

/** Dictated recap cap, minutes. */
export const DICTATE_RECAP_MAX_MINUTES = 10;

export type ScribeGateState = {
  planIncludesScribe: boolean;
  practiceScribeEnabled: boolean;
  /** Client declined AI use (any AI-assisted documentation) */
  clientDeclinedAi?: boolean;
  /** Client revoked consent to session recording */
  clientRevokedRecording?: boolean;
};

export type ScribeBlocked = {
  code: ScribeBlockedCode;
  reason: (typeof SCRIBE_BLOCKED_REASONS)[ScribeBlockedCode];
};

/** First applicable block, in precedence order: plan → practice → AI declined → recording revoked. */
export function resolveScribeBlocked(state: ScribeGateState): ScribeBlocked | null {
  const code: ScribeBlockedCode | null = !state.planIncludesScribe
    ? 'plan'
    : !state.practiceScribeEnabled
      ? 'practice_off'
      : state.clientDeclinedAi
        ? 'client_declined'
        : state.clientRevokedRecording
          ? 'recording_revoked'
          : null;
  return code ? { code, reason: SCRIBE_BLOCKED_REASONS[code] } : null;
}

export type SessionStartAction = 'record' | 'upload' | 'dictate';

/** Which dock actions stay available under a block. A revoked recording still allows a dictated recap. */
export function allowedActions(blocked: ScribeBlocked | null): Record<SessionStartAction, boolean> {
  if (!blocked) return { record: true, upload: true, dictate: true };
  if (blocked.code === 'recording_revoked') return { record: false, upload: false, dictate: true };
  return { record: false, upload: false, dictate: false };
}
