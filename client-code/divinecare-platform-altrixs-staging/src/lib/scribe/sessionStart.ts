/**
 * One-click "Start session" for AI Scribe. Pure, browser-safe.
 *
 * From an appointment, "Start session" opens the note for that visit (the notes page reopens an
 * existing draft for the appointment, else starts the Visit Guide's note type) with the Visit Guide
 * beside it and the AI Scribe panel docked in the editor (`scribe=1`). The scribe format follows the
 * open note's type; the pre-session brief is collapsed at the top of the panel.
 *
 * Consent stays inline: when the client's AI Note Drafting consent is on file (or the practice does
 * not require it), the panel shows one checkbox per participant ("agreed to recording after hearing
 * the consent script") and the Record button. Checking a participant's box is the attestation for
 * that person; the server validates the same Maryland all-party rule as before (consent.ts) and
 * records it on the capture. Missing AI consent shows the existing inline AI consent recorder; a
 * declined or revoked consent shows why nothing can be captured.
 */
import type { AiConsentStatus, ConsentParticipant, ParticipantRole, RecordingConsentInput } from './consent';

export type StartSessionTarget = {
  appointmentId: string;
  clientId: string;
  /** Practice wall date (YYYY-MM-DD) of the visit, when known */
  date?: string | null;
  isVirtual?: boolean;
  /** Group occurrence: the group session page carries the group scribe */
  groupSessionId?: string | null;
};

/** URL that opens the visit's note with the Visit Guide and the docked AI Scribe panel. */
export function startSessionHref(t: StartSessionTarget): string {
  if (t.groupSessionId) return `/dashboard/ehr/group-sessions/sessions/${encodeURIComponent(t.groupSessionId)}?scribe=1`;
  const qs = new URLSearchParams({ clientId: t.clientId, appointmentId: t.appointmentId });
  if (t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) qs.set('dos', t.date);
  qs.set('guide', '1');
  if (t.isVirtual) qs.set('telehealth', '1');
  qs.set('scribe', '1');
  return `/dashboard/ehr/notes?${qs.toString()}`;
}

/** Quick participant row in the docked panel (one checkbox each). */
export type QuickParticipant = { role: ParticipantRole; label?: string; agreed: boolean };

/** Default list: the client (or the guardian for a minor). More rows are added with "+ Person". */
export function defaultQuickParticipants(opts: { minor?: boolean } = {}): QuickParticipant[] {
  return opts.minor ? [{ role: 'GUARDIAN', label: 'Parent / guardian', agreed: false }, { role: 'CLIENT', agreed: false }] : [{ role: 'CLIENT', agreed: false }];
}

/**
 * The one-checkbox-per-participant attestation → the same RecordingConsentInput the full consent
 * step produces. Every box checked = every listed person agreed after the script was read; the
 * clinician's own click on Record confirms everyone who can be heard is listed.
 */
export function quickConsentInput(participants: QuickParticipant[], method: 'verbal' | 'written' = 'verbal'): RecordingConsentInput {
  const list: ConsentParticipant[] = participants.map((p) => ({ role: p.role, ...(p.label?.trim() ? { label: p.label.trim().slice(0, 60) } : {}), consented: p.agreed === true }));
  const all = list.length > 0 && list.every((p) => p.consented);
  return { method, participants: list, allPartiesConfirmed: all, scriptRead: all };
}

/** Dictated recap: only the clinician's voice (no participants). */
export function recapConsentInput(): RecordingConsentInput {
  return { method: 'verbal', participants: [], allPartiesConfirmed: true, scriptRead: true, clinicianOnly: true };
}

export type InlineConsentState =
  | { kind: 'ready' }
  | { kind: 'ai_missing' }
  | { kind: 'blocked'; reason: string };

/** What the docked panel shows above the Record button. */
export function inlineConsentState(input: {
  aiConsent: AiConsentStatus;
  practiceRequiresAiConsent: boolean;
  recordingRevoked?: boolean;
  scribeEnabled: boolean;
  entitled: boolean;
}): InlineConsentState {
  if (!input.entitled) return { kind: 'blocked', reason: 'AI Scribe is not included in this practice’s plan.' };
  if (!input.scribeEnabled) return { kind: 'blocked', reason: 'AI Scribe is turned off in practice settings.' };
  if (input.aiConsent === 'declined') return { kind: 'blocked', reason: 'This client declined AI use. Nothing is captured; document the session yourself.' };
  if (input.aiConsent === 'missing' && input.practiceRequiresAiConsent) return { kind: 'ai_missing' };
  if (input.recordingRevoked) return { kind: 'blocked', reason: 'This client revoked consent to session recording. Nothing is captured; you can still dictate a recap.' };
  return { kind: 'ready' };
}

/** Capture sources the docked panel offers. */
export const DOCK_SOURCES = ['live', 'upload', 'recap'] as const;
export type DockSource = (typeof DOCK_SOURCES)[number];
export const DOCK_SOURCE_LABELS: Record<DockSource, string> = {
  live: 'Record session',
  upload: 'Upload audio',
  recap: 'Dictate a recap',
};

/** A recap is short: the clinician's own summary after the session. */
export const RECAP_MAX_SECONDS = 10 * 60;
