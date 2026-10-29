/**
 * Revocation (pure). The client, or staff on the client's behalf, records a revocation (date, how
 * it was received, verbal or written). From then on Altrixs stops relying on the consent:
 *   - SMS consent revoked → no texts (Client.smsOptOutAt, read by smsEligibility)
 *   - email consent revoked → no email reminders (Client.emailOptOutAt)
 *   - AI drafting consent revoked → the AI gates see "declined" (checkAiNoteConsent)
 *   - recording / transcription consent revoked → AI Scribe capture blocked (captureGate)
 *   - ROI / Part 2 consent revoked (or expired) → disclosures under it are blocked
 *   - card-on-file authorization revoked → autopay turned off
 * HIPAA (§164.508(b)(5)) and Part 2 call for written revocation of an authorization; a verbal
 * revocation is still honored immediately (more protective) and flagged for written confirmation.
 */
import type { ConsentEffect, ConsentTemplateVersion } from './types';

export const REVOCATION_METHODS = ['verbal', 'written'] as const;
export type RevocationMethod = (typeof REVOCATION_METHODS)[number];
export const REVOCATION_CHANNELS = ['in_person', 'phone', 'mail', 'fax', 'email', 'portal', 'other'] as const;
export type RevocationChannel = (typeof REVOCATION_CHANNELS)[number];
export const RECEIVED_VIA_LABEL: Record<RevocationChannel, string> = {
  in_person: 'In person',
  phone: 'Phone',
  mail: 'Mail',
  fax: 'Fax',
  email: 'Email',
  portal: 'Patient portal',
  other: 'Other',
};

export type RevocationInput = {
  /** YYYY-MM-DD the revocation was received */
  receivedOn: string;
  method: RevocationMethod;
  receivedVia: RevocationChannel;
  note?: string | null;
  /** Communication consent only: revoke just these channels (default: all) */
  channels?: ('sms' | 'email' | 'voicemail')[];
};

export type RevocableRow = { status: string; revokedAt: Date | null; signedAt: Date | null };

export function validateRevocation(t: ConsentTemplateVersion | null, row: RevocableRow, input: RevocationInput, today: string): string[] {
  const errors: string[] = [];
  if (t && !t.revocable) errors.push(`${t.title} is an acknowledgment, not a consent, and cannot be revoked.`);
  if (row.revokedAt) errors.push('This consent was already revoked.');
  if (row.status !== 'SIGNED' && row.status !== 'EXPIRED') errors.push('Only a signed consent can be revoked.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn || '')) errors.push('Enter the date the revocation was received.');
  else {
    if (input.receivedOn > today) errors.push('The revocation date cannot be in the future.');
    if (row.signedAt && input.receivedOn < row.signedAt.toISOString().slice(0, 10)) errors.push('The revocation date cannot be before the consent was signed.');
  }
  if (!(REVOCATION_METHODS as readonly string[]).includes(input.method)) errors.push('Choose verbal or written.');
  if (!(REVOCATION_CHANNELS as readonly string[]).includes(input.receivedVia)) errors.push('Choose how the revocation was received.');
  if (input.method === 'verbal' && input.receivedVia === 'mail') errors.push('A revocation received by mail is written.');
  return errors;
}

/** Authorizations where HIPAA / Part 2 expect a written revocation. */
export function needsWrittenConfirmation(t: ConsentTemplateVersion | null, method: RevocationMethod): boolean {
  return method === 'verbal' && Boolean(t?.effects?.some((e) => e === 'roi' || e === 'part2'));
}

export type RevocationEffect =
  | { kind: 'sms_opt_out' }
  | { kind: 'email_opt_out' }
  | { kind: 'voicemail_off' }
  | { kind: 'ai_drafting_blocked' }
  | { kind: 'recording_blocked' }
  | { kind: 'disclosures_blocked' }
  | { kind: 'autopay_off' }
  | { kind: 'telehealth_consent_revoked' };

/** What revoking this consent turns off (the store applies them in the same transaction). */
export function revocationEffects(t: ConsentTemplateVersion | null, legacyType: string | null, channels?: RevocationInput['channels']): RevocationEffect[] {
  const effects = new Set<ConsentEffect>(t?.effects ?? []);
  if (!t && legacyType === 'AI Note Drafting') effects.add('ai_drafting');
  if (!t && legacyType === 'Release of Information') effects.add('roi');
  if (!t && legacyType === 'Telehealth Consent') effects.add('telehealth');
  const comm = channels && channels.length ? new Set(channels) : null;
  const out: RevocationEffect[] = [];
  if (effects.has('sms') && (!comm || comm.has('sms'))) out.push({ kind: 'sms_opt_out' });
  if (effects.has('email') && (!comm || comm.has('email'))) out.push({ kind: 'email_opt_out' });
  if (effects.has('voicemail') && (!comm || comm.has('voicemail'))) out.push({ kind: 'voicemail_off' });
  if (effects.has('ai_drafting')) out.push({ kind: 'ai_drafting_blocked' });
  if (effects.has('recording')) out.push({ kind: 'recording_blocked' });
  if (effects.has('roi') || effects.has('part2')) out.push({ kind: 'disclosures_blocked' });
  if (effects.has('card_on_file')) out.push({ kind: 'autopay_off' });
  if (effects.has('telehealth')) out.push({ kind: 'telehealth_consent_revoked' });
  return out;
}

/** A communication consent with only some channels revoked stays in force for the others. */
export function isPartialChannelRevocation(t: ConsentTemplateVersion | null, channels?: RevocationInput['channels']): boolean {
  return Boolean(t?.effects?.includes('sms') && channels && channels.length > 0 && channels.length < 3);
}

// ─── Disclosure check (ROI / Part 2) ─────────────────────────────────────────

export type DisclosureConsentRow = {
  clientId: string;
  formKey: string | null;
  type: string;
  status: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

const DISCLOSURE_KEYS = new Set(['lib:roi-authorization', 'lib:part2-consent']);

/**
 * A disclosure may be recorded under a consent only when it is an authorization (ROI / Part 2),
 * for the same client, signed, not revoked and not expired on the disclosure date.
 */
export function disclosureConsentCheck(row: DisclosureConsentRow | null, clientId: string, disclosedAt: Date): { ok: true } | { ok: false; reason: string } {
  if (!row || row.clientId !== clientId) return { ok: false, reason: 'The consent was not found for this client.' };
  const isAuth = (row.formKey && DISCLOSURE_KEYS.has(row.formKey)) || (!row.formKey && (row.type === 'Release of Information' || /42 cfr|part 2/i.test(row.type)));
  if (!isAuth) return { ok: false, reason: 'That form is not a release of information or Part 2 consent.' };
  if (row.revokedAt && row.revokedAt.getTime() <= disclosedAt.getTime()) return { ok: false, reason: 'The client revoked this consent; it cannot be used for a disclosure.' };
  if (row.status !== 'SIGNED' && !(row.status === 'DECLINED' && row.revokedAt && row.revokedAt.getTime() > disclosedAt.getTime())) {
    return { ok: false, reason: 'The consent is not signed.' };
  }
  if (row.expiresAt && row.expiresAt.getTime() < disclosedAt.getTime()) return { ok: false, reason: 'The consent had expired on the disclosure date.' };
  return { ok: true };
}
