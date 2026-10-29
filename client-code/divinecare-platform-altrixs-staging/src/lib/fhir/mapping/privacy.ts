/**
 * 42 CFR Part 2 and SensitiveRecord handling for the HealthLake sync (pure).
 *
 * Rule (allowPart2Sync defaults to false; it is an explicit per-organization setting):
 *
 *  1. A client is a "Part 2 client" when any progress note is flagged Part 2 (column or the
 *     legacy part2="true" body comment) or their SensitiveRecord.noteClassification names
 *     Part 2 / 42 CFR / SUD.
 *  2. "Part 2 content" is: Part 2 flagged notes; Conditions with a substance use disorder
 *     ICD-10-CM code (F10-F16, F18, F19; tobacco F17 is outside the Part 2 definition in
 *     42 CFR 2.11); medication statements for SUD medications (buprenorphine, methadone,
 *     naltrexone, disulfiram, acamprosate, lofexidine); SUD codes in a medical visit reason.
 *  3. allowPart2Sync = false (default): nothing about a Part 2 client is sent (not even the
 *     Patient); for every other client, Part 2 content items are left out (SUD codes are
 *     dropped from encounter reasons). Anything previously synced that is now excluded is
 *     deleted from HealthLake by the worker.
 *  4. allowPart2Sync = true: everything is sent, and every resource of a Part 2 client plus
 *     every Part 2 content item carries meta.security 42CFRPart2 + NORDSCLCD (v3-ActCode)
 *     and confidentiality R (v3-Confidentiality).
 *  5. SensitiveRecord-protected clients (employee / VIP / legal / other) are synced, and every
 *     one of their resources carries confidentiality R (restricted).
 */
import { SYSTEMS, type Coding } from './common';

export type SyncSettings = {
  /** Org opted in to HealthLake sync */
  enabled: boolean;
  /** Explicit opt-in to send 42 CFR Part 2 content (default false) */
  allowPart2Sync: boolean;
};

export const DEFAULT_SYNC_SETTINGS: SyncSettings = { enabled: false, allowPart2Sync: false };

export const SECURITY_PART2: Coding = {
  system: SYSTEMS.actCode,
  code: '42CFRPart2',
  display: '42 CFR Part2',
};
export const SECURITY_NO_REDISCLOSURE: Coding = {
  system: SYSTEMS.actCode,
  code: 'NORDSCLCD',
  display: 'no redisclosure without consent directive',
};
export const SECURITY_RESTRICTED: Coding = {
  system: SYSTEMS.confidentiality,
  code: 'R',
  display: 'restricted',
};

const SUD_ICD10 = /^F1[0-689](\.|$)/;

/** F10-F16, F18, F19 (F17 nicotine excluded) */
export function isSudIcd10(code: string | null | undefined): boolean {
  return SUD_ICD10.test((code || '').trim().toUpperCase());
}

const SUD_MEDICATION_RE =
  /\b(buprenorphine|suboxone|subutex|zubsolv|sublocade|brixadi|methadone|methadose|naltrexone|vivitrol|disulfiram|antabuse|acamprosate|campral|lofexidine|lucemyra)\b/i;

export function isSudMedication(names: Array<string | null | undefined>): boolean {
  return names.some((n) => !!n && SUD_MEDICATION_RE.test(n));
}

const PART2_CLASSIFICATION_RE = /part\s*-?\s*2|42\s*cfr|\bsud\b|substance/i;

export function isPart2Classification(noteClassification: string | null | undefined): boolean {
  return !!noteClassification && PART2_CLASSIFICATION_RE.test(noteClassification);
}

export type ClientPrivacy = {
  part2Client: boolean;
  sensitive: boolean;
};

export function classifyClient(input: {
  sensitiveRecord?: { noteClassification?: string | null } | null;
  hasPart2Note: boolean;
}): ClientPrivacy {
  return {
    part2Client: input.hasPart2Note || isPart2Classification(input.sensitiveRecord?.noteClassification),
    sensitive: !!input.sensitiveRecord,
  };
}

export type PrivacyDecision = { include: boolean; security: Coding[]; reason?: string };

/**
 * Decide whether one resource is synced and which meta.security labels it carries.
 * `part2Content` = the item itself is Part 2 content (rule 2).
 */
export function privacyDecision(
  client: ClientPrivacy | null,
  part2Content: boolean,
  settings: SyncSettings
): PrivacyDecision {
  const part2 = part2Content || !!client?.part2Client;
  if (part2 && !settings.allowPart2Sync) {
    return {
      include: false,
      security: [],
      reason: client?.part2Client ? 'part2_client' : 'part2_content',
    };
  }
  const security: Coding[] = [];
  if (part2) security.push(SECURITY_PART2, SECURITY_NO_REDISCLOSURE);
  if (part2 || client?.sensitive) security.push(SECURITY_RESTRICTED);
  return { include: true, security };
}
