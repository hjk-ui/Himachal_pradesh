/**
 * Required-consent rules engine (pure, browser-safe).
 *
 * The intake packet (composer.ts) decides what a NEW client is asked to sign from the practice's
 * packet selection. "Required" is broader and does not depend on that selection: these rules say
 * which consents every client must have on file for the programs and services they actually
 * receive, so the Consents worklist, chart banner, inbox and report flag a gap even when a
 * template was left out of the packet or the service started later (a first prescription, autopay,
 * texting, the AI scribe).
 *
 *   Rule                                   Consent (template key)               Basis
 *   every client in care                   informed-consent-treatment           consent to treatment
 *   every client in care                   npp-acknowledgment                   HIPAA §164.520(c)(2)(ii)
 *   telehealth visits                      telehealth-consent                   telehealth informed consent (practice policy)
 *   under 18                               minor-consent-treatment              Md. Health-General §20-102 / §20-104
 *   PRP                                    rehabilitation-assessment-irp        practice PRP packet section
 *   primary care                           primary-care-consent                 consent to treatment (medical)
 *   group therapy                          group-therapy-confidentiality        practice policy
 *   medication management (any Rx)         psychiatric-medication-consent       informed consent for psychotropic medication
 *   texts (smsConsent on)                  communication-consent                TCPA: written record of the consent to texts
 *   autopay / card on file                 card-on-file-authorization           signed authorization to charge a stored card
 *   AI scribe used for the client          ai-note-drafting-consent             practice AI policy
 *   AI scribe records audio (not dictation) recording-transcription-consent     Maryland all-party recording consent (Cts. & Jud. Proc. §10-402), confirm with compliance
 *
 * Not required (voluntary): the 42 CFR Part 2 consent and every ROI are offered and may be
 * declined without affecting care (§164.508(b)(4), §2.31); they block disclosures, not visits.
 * AOT: adds NO required consent (decided to the industry standard, Oct 2026). AOT treatment and
 * the disclosures to the court / AOT program are made under the court order (HIPAA §164.512(e),
 * Md. Health-General Title 10, Subtitle 6A), not under a client authorization; the client still signs the same
 * consents as every client in care (treatment, NPP, and any service rule above).
 *
 * The AI scribe signal (contextsFor in store.ts) counts ambient / telehealth capture in the last
 * year; dictation records only the clinician's voice and does not trigger the recording consent.
 * The capture itself is also gated per session (src/lib/scribe/consent.ts captureGate). The texts
 * rule follows Client.smsConsent (and no STOP); every patient text also goes through the SMS gate
 * (src/lib/sms/patientSms.ts), which refuses a text without consent.
 *
 * A rule only creates a requirement the practice can act on when the template has an Active
 * version; otherwise it is listed in ComposeResult.requiredUnavailable ("approve the template").
 */
import type { ConsentTemplateVersion, ServiceFlag } from './types';
import type { ComposeResult, PacketClientContext, PacketItem } from './composer';
import { latestTitle } from './catalog';

export type RequirementRule = {
  id: string;
  key: string;
  /** Plain-language reason when the rule applies to this client, else null */
  when: (ctx: PacketClientContext) => string | null;
  basis: string;
  /** Any valid row of the template satisfies the rule (one form per medication / card) */
  anyRow?: boolean;
  /** Staff fill the form before the client signs (prescriber, card details): never bulk-sent */
  staffPrepares?: boolean;
};

const has = (ctx: PacketClientContext, f: ServiceFlag) => ctx.services.includes(f);
const inCare = (ctx: PacketClientContext) => ctx.services.some((s) => s !== 'telehealth');

export const REQUIREMENT_RULES: readonly RequirementRule[] = [
  { id: 'treatment', key: 'informed-consent-treatment', basis: 'Consent to treatment before services', when: (c) => (inCare(c) ? 'Receives services' : null) },
  { id: 'npp', key: 'npp-acknowledgment', basis: 'HIPAA 45 CFR §164.520(c)(2)(ii) acknowledgment of the privacy notice', when: (c) => (inCare(c) ? 'Receives services' : null) },
  { id: 'telehealth', key: 'telehealth-consent', basis: 'Telehealth informed consent (practice policy)', when: (c) => (has(c, 'telehealth') ? 'Has telehealth visits' : null) },
  { id: 'minor', key: 'minor-consent-treatment', basis: 'Maryland Health-General §20-102 / §20-104 (minors)', when: (c) => (c.ageYears !== null && c.ageYears < 18 ? `Under 18 (age ${c.ageYears})` : null) },
  { id: 'prp', key: 'rehabilitation-assessment-irp', basis: 'PRP section of the practice packet', when: (c) => (has(c, 'prp') ? 'Enrolled in PRP' : null) },
  { id: 'primary_care', key: 'primary-care-consent', basis: 'Consent to medical treatment', when: (c) => (has(c, 'primary_care') ? 'Primary care patient' : null) },
  { id: 'group', key: 'group-therapy-confidentiality', basis: 'Group confidentiality agreement', when: (c) => (has(c, 'group') ? 'Group therapy' : null) },
  { id: 'medication', key: 'psychiatric-medication-consent', basis: 'Informed consent for psychotropic medication', when: (c) => (has(c, 'medication') ? 'Medication management' : null), anyRow: true, staffPrepares: true },
  { id: 'sms', key: 'communication-consent', basis: 'TCPA: written record of the client’s consent to texts (and email choices)', when: (c) => (c.signals?.smsConsent ? 'Receives text messages' : null) },
  { id: 'autopay', key: 'card-on-file-authorization', basis: 'Signed authorization to charge a stored card', when: (c) => (c.signals?.autopay ? 'Autopay / card on file' : null), anyRow: true, staffPrepares: true },
  { id: 'ai_drafting', key: 'ai-note-drafting-consent', basis: 'Practice AI documentation policy', when: (c) => (c.signals?.aiScribe ? 'AI scribe used in sessions' : null) },
  { id: 'recording', key: 'recording-transcription-consent', basis: 'Maryland all-party recording consent, confirm with compliance (Cts. & Jud. Proc. §10-402)', when: (c) => (c.signals?.aiScribe ? 'AI scribe records session audio' : null) },
];

/** Templates staff prepare per client (never in a bulk "send packet"). */
export const STAFF_PREPARED_KEYS: ReadonlySet<string> = new Set(REQUIREMENT_RULES.filter((r) => r.staffPrepares).map((r) => r.key));

export type RequiredConsent = { key: string; reason: string; basis: string; anyRow: boolean };

/** Which consents this client must have on file, and why. */
export function requiredConsents(ctx: PacketClientContext): RequiredConsent[] {
  const out: RequiredConsent[] = [];
  const seen = new Set<string>();
  for (const r of REQUIREMENT_RULES) {
    const why = r.when(ctx);
    if (!why || seen.has(r.key)) continue;
    seen.add(r.key);
    out.push({ key: r.key, reason: why, basis: r.basis, anyRow: Boolean(r.anyRow) });
  }
  return out;
}

/**
 * Add the rule-required consents to a packet composition (status only; sending still uses the
 * composer's packet). Items already composed keep their packet reason; a required consent whose
 * template cannot be sent is reported in requiredUnavailable instead of silently skipped.
 */
export function mergeRequirements(composed: ComposeResult, ctx: PacketClientContext, resolve: (key: string) => { template: ConsentTemplateVersion } | { reason: string }): ComposeResult {
  const items: PacketItem[] = composed.items.map((i) => ({ ...i }));
  const requiredUnavailable: NonNullable<ComposeResult['requiredUnavailable']> = [...(composed.requiredUnavailable ?? [])];
  for (const req of requiredConsents(ctx)) {
    const existing = items.find((i) => i.key === req.key && !i.purposeTag);
    if (existing) {
      if (req.anyRow) existing.anyRow = true;
      existing.optional = false;
      continue;
    }
    const res = resolve(req.key);
    if (!('template' in res)) {
      requiredUnavailable.push({ key: req.key, title: latestTitle(req.key), reason: `${req.reason}; ${res.reason}` });
      continue;
    }
    const t = res.template;
    items.push({ key: req.key, version: t.version, title: t.title, signing: t.signing, optional: false, reason: req.reason, anyRow: req.anyRow || t.signing === 'standalone' });
  }
  return { ...composed, items, skipped: composed.skipped.filter((s) => !items.some((i) => i.key === s.key)), requiredUnavailable };
}

// ─── Standard status (worklist) ──────────────────────────────────────────────

/** Front-desk status of one required consent. */
export type StandardStatus = 'complete' | 'missing' | 'expiring' | 'expired' | 'revoked';

export const STANDARD_STATUS_LABEL: Record<StandardStatus, string> = {
  complete: 'Complete',
  missing: 'Missing',
  expiring: 'Expiring soon',
  expired: 'Expired',
  revoked: 'Revoked',
};

/** A signed consent is "expiring" when it ends within this many days. */
export const EXPIRING_WITHIN_DAYS = 30;
