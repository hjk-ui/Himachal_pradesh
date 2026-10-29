/**
 * AI Scribe capture gate: Maryland all-party recording consent + patient AI consent. Pure and
 * browser-safe (the scribe page shows the same reasons the API enforces).
 *
 * Maryland is an all-party consent state for recording a private conversation
 * (Md. Code, Cts. & Jud. Proc. §10-402). Ambient capture streams the conversation to a
 * transcription service, so it is treated as an interception: before capture starts the clinician
 * attests, per participant, that each person present (the client, a guardian, family, an
 * interpreter, anyone else who can be heard) agreed, verbally or in writing. The attestation is
 * stored on the scribe session with who attested and when. It cannot be turned off by a practice
 * setting (RECORDING_CONSENT_REQUIRED is a constant, not a column).
 *
 * Dictation (the clinician alone, after the session) records only the clinician's own voice, so
 * the attestation is "no one else can be heard" rather than client consent. The patient's AI
 * consent still applies: a declined AI consent blocks capture of any kind for that client.
 */

export const MD_RECORDING_STATUTE = 'Md. Code, Cts. & Jud. Proc. §10-402';
/** Always on (all-party consent state). Not a practice setting. */
export const RECORDING_CONSENT_REQUIRED = true as const;
export const CONSENT_SCRIPT_VERSION = '2026-10-19';

export const RECORDING_CONSENT_SCRIPT =
  'Before we start: I would like to use our AI documentation assistant during today\'s session. It listens to our conversation and turns it into text so I can write my note. ' +
  'The audio is transcribed by Amazon Web Services under our HIPAA business associate agreement and is not saved. The written transcript is stored securely and deleted on a schedule after I finish your note. ' +
  'I review and sign everything myself. You can say no, and you can ask me to pause or stop at any time; your care will not change. ' +
  'Do I have your permission, and the permission of everyone here with us?';

export const DICTATION_ATTESTATION =
  'Only my voice will be captured: the client and other people are not present or cannot be heard.';

export const CAPTURE_MODES = ['in_person', 'telehealth', 'dictation'] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];

export const CONSENT_METHODS = ['verbal', 'written'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const PARTICIPANT_ROLES = ['CLIENT', 'GUARDIAN', 'FAMILY', 'INTERPRETER', 'OTHER'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const PARTICIPANT_LABELS: Record<ParticipantRole, string> = {
  CLIENT: 'Client',
  GUARDIAN: 'Parent / guardian',
  FAMILY: 'Family member',
  INTERPRETER: 'Interpreter',
  OTHER: 'Other participant',
};

export type ConsentParticipant = {
  role: ParticipantRole;
  /** Optional relationship / description ("Mother", "Spanish interpreter"); never required */
  label?: string;
  consented: boolean;
};

export type RecordingConsentInput = {
  method: ConsentMethod;
  participants: ConsentParticipant[];
  /** Clinician confirms everyone who can be heard is listed and agreed */
  allPartiesConfirmed: boolean;
  /** Clinician read or summarized the consent script */
  scriptRead: boolean;
  /** Dictation only: the clinician confirms only their own voice is captured */
  clinicianOnly?: boolean;
};

export type ConsentCheck = { ok: true } | { ok: false; code: string; message: string };

export function validateRecordingConsent(mode: CaptureMode, input: RecordingConsentInput | null | undefined): ConsentCheck {
  if (!input) {
    return { ok: false, code: 'recording_consent_missing', message: `Recording consent is required before capture (${MD_RECORDING_STATUTE}: all parties must agree).` };
  }
  if (mode === 'dictation') {
    return input.clinicianOnly === true
      ? { ok: true }
      : { ok: false, code: 'dictation_attestation_missing', message: 'Confirm that only your own voice will be captured during dictation.' };
  }
  if (!(CONSENT_METHODS as readonly string[]).includes(input.method)) {
    return { ok: false, code: 'consent_method_invalid', message: 'Choose how consent was given (verbal or written).' };
  }
  const people = Array.isArray(input.participants) ? input.participants : [];
  if (!people.some((p) => p.role === 'CLIENT' || p.role === 'GUARDIAN')) {
    return { ok: false, code: 'client_not_listed', message: 'List the client (or the parent / guardian for a minor) among the participants.' };
  }
  if (people.some((p) => !(PARTICIPANT_ROLES as readonly string[]).includes(p.role))) {
    return { ok: false, code: 'participant_invalid', message: 'A participant has an unknown role.' };
  }
  const refused = people.filter((p) => p.consented !== true);
  if (refused.length) {
    return {
      ok: false,
      code: 'participant_declined',
      message: `Every participant must agree before capture (${MD_RECORDING_STATUTE}). ${refused.length} participant${refused.length === 1 ? ' has' : 's have'} not agreed: do not record; document the session yourself.`,
    };
  }
  if (input.allPartiesConfirmed !== true) {
    return { ok: false, code: 'all_parties_unconfirmed', message: 'Confirm that everyone who can be heard is listed and agreed.' };
  }
  if (input.scriptRead !== true) {
    return { ok: false, code: 'script_not_read', message: 'Confirm that you read or explained the recording consent to the participants.' };
  }
  return { ok: true };
}

export type AiConsentStatus = 'signed' | 'missing' | 'declined';

export type CaptureGateInput = {
  mode: CaptureMode;
  /** Practice scribe setting */
  scribeEnabled: boolean;
  /** ai_scribe add-on / plan entitlement */
  entitled: boolean;
  aiConsent: AiConsentStatus;
  /** PracticeSettings.aiNoteConsentRequired */
  practiceRequiresAiConsent: boolean;
  recordingConsent: RecordingConsentInput | null | undefined;
  /** A streaming transcription path is configured on this server (Transcribe / Chime) */
  transcriptionConfigured: boolean;
  /** The client revoked the signed session recording / transcription consent (consent library) */
  recordingConsentRevoked?: boolean;
};

/** Every reason capture may not start, in the order the clinician should fix them. */
export function captureGate(input: CaptureGateInput): ConsentCheck {
  if (!input.entitled) return { ok: false, code: 'not_entitled', message: 'AI Scribe is not included in this practice\'s plan.' };
  if (!input.scribeEnabled) return { ok: false, code: 'scribe_disabled', message: 'AI Scribe is turned off in practice settings.' };
  if (input.aiConsent === 'declined') {
    return { ok: false, code: 'ai_consent_declined', message: 'This client declined AI use. Nothing is captured or sent to AI; document the session yourself.' };
  }
  if (input.aiConsent === 'missing' && input.practiceRequiresAiConsent) {
    return { ok: false, code: 'ai_consent_missing', message: 'No AI consent is on file for this client and the practice requires it. Record the client\'s AI Note Drafting consent in Consents first.' };
  }
  if (input.recordingConsentRevoked && input.mode !== 'dictation') {
    return { ok: false, code: 'recording_consent_revoked', message: 'This client revoked consent to session recording and transcription. Nothing is captured; document the session yourself.' };
  }
  const rc = validateRecordingConsent(input.mode, input.recordingConsent);
  if (!rc.ok) return rc;
  if (!input.transcriptionConfigured) {
    return {
      ok: false,
      code: 'transcription_not_configured',
      message: 'AWS transcription is not configured on this server, so live capture is unavailable. Nothing was captured; type the session content instead.',
    };
  }
  return { ok: true };
}

/** Participant list for storage: role, consented, trimmed label (max 60 chars). */
export function normalizeParticipants(list: unknown): ConsentParticipant[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
    .slice(0, 12)
    .map((p) => ({
      role: (PARTICIPANT_ROLES as readonly string[]).includes(String(p.role)) ? (p.role as ParticipantRole) : 'OTHER',
      label: typeof p.label === 'string' && p.label.trim() ? p.label.trim().slice(0, 60) : undefined,
      consented: p.consented === true,
    }));
}
