/**
 * Consent decisions made to the industry standard (owner delegated, Oct 2026). Pure and
 * browser-safe: the check-in soft stop, the automatic reminder schedule, and the validity periods
 * the library page documents. Server code: checkIn.ts (soft stop) and reminders.ts (nightly job).
 *
 * 1. Check-in soft stop (athenaOne / Epic Cadence / SimplePractice pattern: warn, sign now, or
 *    override with a reason; never a hard block that turns a client away):
 *    - Blocks check-in (dialog) only for the consent to treatment (informed-consent-treatment) and,
 *      for a virtual visit, the telehealth consent (telehealth-consent).
 *    - "Have the client sign now" opens in-office kiosk signing for exactly those consents;
 *      "Check in anyway" needs an override reason (at least 10 characters), stored in
 *      ConsentCheckInOverride and audited as CONSENT_CHECKIN_OVERRIDE (ids / counts only).
 *    - A required consent whose template has no Active, sendable version ("required but not
 *      approved") never blocks: it is a flag, because nobody can sign it yet.
 *    - A valid signed consent satisfies the stop even when a newer copy was sent and is unsigned,
 *      or a new template version asks for re-signing (those are flags).
 *    - Every other missing / expiring consent is a flag only.
 *
 * 2. Reminders (nightly, scripts/consent-reminders.ts): unsigned portal packet 3 and 7 days after it
 *    was sent; renewal 30 and 7 days before a required consent expires; at most 3 reminders per
 *    packet / consent; one notification per client per night. Portal + email (when the client has
 *    an email and did not opt out) + SMS only through the patient SMS gate with consent. Messages
 *    never name the forms (no PHI). Practice toggle "Automatic consent reminders", default ON.
 *
 * 3. Validity: see VALIDITY_POLICY (no behavior change; documented on the library page).
 */
import type { ConsentTemplateVersion } from './types';
import { EXPIRING_WITHIN_DAYS } from './requirements';
import { keyOf, stateOf, type ConsentRowLite, type ConsentState } from './status';

// ─── 1. Check-in soft stop ───────────────────────────────────────────────────

export const CHECKIN_TREATMENT_KEY = 'informed-consent-treatment';
export const CHECKIN_TELEHEALTH_KEY = 'telehealth-consent';
export const OVERRIDE_REASON_MIN = 10;
export const OVERRIDE_REASON_MAX = 500;
/** 409 code from PATCH /api/appointments/[id] when a check-in needs the consent or a reason */
export const CONSENT_REQUIRED_CODE = 'CONSENT_REQUIRED' as const;
export const CONSENT_CHECKIN_OVERRIDE_ACTION = 'CONSENT_CHECKIN_OVERRIDE';

/** The consents that stop a check-in for this visit. */
export function checkInBlockingKeys(isVirtual: boolean): string[] {
  return isVirtual ? [CHECKIN_TREATMENT_KEY, CHECKIN_TELEHEALTH_KEY] : [CHECKIN_TREATMENT_KEY];
}

/** What is on file for one template, looking at every row (not just the latest). */
export type OnFileStatus = 'valid' | 'expiring' | 'needs_resign' | 'pending' | 'declined' | 'expired' | 'revoked' | 'missing';

const DAY = 86_400_000;

/**
 * A valid signed row wins over a newer unsigned / declined copy (e.g. a renewal packet that is out
 * but not signed yet): the client did consent and the consent has not ended.
 */
export function onFileStatus(rows: ConsentRowLite[], key: string, active: ConsentTemplateVersion | null, now: Date): OnFileStatus {
  const mine = rows.filter((r) => keyOf(r) === key && r.formStatus !== 'VOIDED' && r.formStatus !== 'SUPERSEDED').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (!mine.length) return 'missing';
  const states = mine.map((r) => ({ r, s: stateOf(r, active, now).state as ConsentState }));
  const signed = states.find((x) => x.s === 'signed');
  if (signed) {
    const days = signed.r.expiresAt ? Math.floor((signed.r.expiresAt.getTime() - now.getTime()) / DAY) : null;
    return days !== null && days <= EXPIRING_WITHIN_DAYS ? 'expiring' : 'valid';
  }
  if (states.some((x) => x.s === 'needs_resign')) return 'needs_resign';
  return states[0].s as Exclude<ConsentState, 'signed' | 'needs_resign'>;
}

export type CheckInConsentFact = {
  key: string;
  title: string;
  /** An Active, sendable template version exists (someone can sign it today) */
  templateAvailable: boolean;
  status: OnFileStatus;
};

export type CheckInConsentItem = { key: string; title: string; detail: string };

export type CheckInConsentDecision = {
  /** Sign now or override with a reason */
  blocking: CheckInConsentItem[];
  /** Shown, never block */
  flags: CheckInConsentItem[];
  overrideRequired: boolean;
};

const STATUS_DETAIL: Record<OnFileStatus, string> = {
  valid: 'On file',
  expiring: `Expires within ${EXPIRING_WITHIN_DAYS} days`,
  needs_resign: 'New version: client should re-sign',
  pending: 'Sent, not signed yet',
  declined: 'Client declined',
  expired: 'Expired',
  revoked: 'Revoked',
  missing: 'Not on file',
};

/**
 * @param facts      the blocking consents for this visit (checkInBlockingKeys) and any other required consents
 * @param isVirtual  virtual visit: the telehealth consent blocks too
 */
export function decideCheckInConsents(input: { isVirtual: boolean; facts: CheckInConsentFact[] }): CheckInConsentDecision {
  const blockingKeys = new Set(checkInBlockingKeys(input.isVirtual));
  const blocking: CheckInConsentItem[] = [];
  const flags: CheckInConsentItem[] = [];
  const seen = new Set<string>();
  for (const f of input.facts) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    if (f.status === 'valid') continue;
    const satisfied = f.status === 'expiring' || f.status === 'needs_resign';
    if (blockingKeys.has(f.key) && !satisfied) {
      if (f.templateAvailable) blocking.push({ key: f.key, title: f.title, detail: STATUS_DETAIL[f.status] });
      else flags.push({ key: f.key, title: f.title, detail: `${STATUS_DETAIL[f.status]}; required but the template is not approved yet` });
      continue;
    }
    flags.push({ key: f.key, title: f.title, detail: f.templateAvailable || satisfied ? STATUS_DETAIL[f.status] : `${STATUS_DETAIL[f.status]}; template not approved yet` });
  }
  return { blocking, flags, overrideRequired: blocking.length > 0 };
}

/** updateAppointment failure for the soft stop (route answers 409 with code CONSENT_REQUIRED). */
export function consentRequiredFailure(error: string, decision: CheckInConsentDecision, isVirtual: boolean) {
  return { ok: false as const, status: 409, code: CONSENT_REQUIRED_CODE, error, missing: decision.blocking, flags: decision.flags, isVirtual };
}

/** Check-in allowed? Without blocking consents always; with them only with a reason of 10+ characters. */
export function checkInAllowed(decision: Pick<CheckInConsentDecision, 'overrideRequired'>, reason: string | null | undefined): { ok: true; override: string | null } | { ok: false; error: string } {
  if (!decision.overrideRequired) return { ok: true, override: null };
  const r = (reason ?? '').trim();
  if (!r) return { ok: false, error: 'Consent needed before this visit. Have the client sign now, or check in anyway with a reason.' };
  if (r.length < OVERRIDE_REASON_MIN) return { ok: false, error: `The override reason must be at least ${OVERRIDE_REASON_MIN} characters.` };
  return { ok: true, override: r.slice(0, OVERRIDE_REASON_MAX) };
}

// ─── 2. Reminder schedule ────────────────────────────────────────────────────

/** Days after the packet was sent */
export const PACKET_REMINDER_DAYS = [3, 7] as const;
/** Days before the consent expires */
export const RENEWAL_REMINDER_DAYS = [30, 7] as const;
export const MAX_REMINDERS = 3;

export type ReminderStage = 'd3' | 'd7' | 'pre30' | 'pre7';
export type ReminderTracker = { count: number; stages: string[] };
const NO_TRACKER: ReminderTracker = { count: 0, stages: [] };

/**
 * The highest stage reached and not done yet (an earlier stage that was missed is skipped, never
 * sent late), or null. Capped at MAX_REMINDERS counting staff resends of the packet too.
 */
function pickStage(reached: ReminderStage[], order: ReminderStage[], tracker: ReminderTracker, priorReminders: number): ReminderStage | null {
  if (Math.max(tracker.count, priorReminders) >= MAX_REMINDERS) return null;
  const top = reached[reached.length - 1];
  if (!top) return null;
  const doneIdx = Math.max(-1, ...tracker.stages.map((s) => order.indexOf(s as ReminderStage)));
  return order.indexOf(top) > doneIdx ? top : null;
}

/**
 * Unsigned packet reminder due now. priorReminders = staff resends (packet sendCount - 1), so a
 * packet staff already re-sent twice gets one automatic reminder at most.
 */
export function packetReminderStage(sentAt: Date, now: Date, tracker: ReminderTracker | null = null, priorReminders = 0): ReminderStage | null {
  const days = Math.floor((now.getTime() - sentAt.getTime()) / DAY);
  const reached: ReminderStage[] = [];
  if (days >= PACKET_REMINDER_DAYS[0]) reached.push('d3');
  if (days >= PACKET_REMINDER_DAYS[1]) reached.push('d7');
  return pickStage(reached, ['d3', 'd7'], tracker ?? NO_TRACKER, Math.max(0, priorReminders));
}

/** Renewal reminder due now for a signed consent expiring at expiresAt (null once expired). */
export function renewalReminderStage(expiresAt: Date, now: Date, tracker: ReminderTracker | null = null): ReminderStage | null {
  if (expiresAt.getTime() <= now.getTime()) return null;
  const daysLeft = Math.floor((expiresAt.getTime() - now.getTime()) / DAY);
  const reached: ReminderStage[] = [];
  if (daysLeft <= RENEWAL_REMINDER_DAYS[0]) reached.push('pre30');
  if (daysLeft <= RENEWAL_REMINDER_DAYS[1]) reached.push('pre7');
  return pickStage(reached, ['pre30', 'pre7'], tracker ?? NO_TRACKER, 0);
}

/** Tracker after a reminder run for this subject: the stage is done either way; count only when something was delivered. */
export function nextTracker(tracker: ReminderTracker | null, stage: ReminderStage, delivered: boolean): ReminderTracker {
  const t = tracker ?? NO_TRACKER;
  return { count: t.count + (delivered ? 1 : 0), stages: [...new Set([...t.stages, stage])] };
}

export type ReminderChannel = 'portal' | 'email' | 'sms';

/** Portal always; email when on file and not opted out; SMS only with consent and no STOP (the SMS gate re-checks). */
export function reminderChannels(c: { email?: string | null; emailOptOutAt?: Date | null; smsConsent?: boolean | null; smsOptOutAt?: Date | null }): ReminderChannel[] {
  const out: ReminderChannel[] = ['portal'];
  if (c.email?.trim() && !c.emailOptOutAt) out.push('email');
  if (c.smsConsent && !c.smsOptOutAt) out.push('sms');
  return out;
}

export const REMINDER_POLICY: readonly string[] = [
  `Unsigned packet: reminders ${PACKET_REMINDER_DAYS[0]} and ${PACKET_REMINDER_DAYS[1]} days after it was sent.`,
  `Renewal: reminders ${RENEWAL_REMINDER_DAYS[0]} and ${RENEWAL_REMINDER_DAYS[1]} days before a required consent expires (the renewal forms go to the portal).`,
  `At most ${MAX_REMINDERS} reminders per packet or consent (staff resends count), one message per client per night.`,
  'Portal, plus email when the client has an email address and plus text only when the client consented to texts. Messages never name the forms.',
];

// ─── 3. Validity (documentation; behavior lives in the templates and signing.ts) ─

export const VALIDITY_POLICY: readonly { label: string; rule: string }[] = [
  { label: 'Consent to treatment', rule: '12 months, then re-sign' },
  { label: 'Financial responsibility', rule: '12 months' },
  { label: 'Telehealth consent', rule: '12 months' },
  { label: 'Program rules and participant responsibilities', rule: '12 months' },
  { label: 'Consent for treatment of a minor', rule: '12 months' },
  { label: 'Primary care consent', rule: '12 months' },
  { label: 'Release of information (ROI)', rule: '1 year from signing unless the ROI states its own expiration date or event' },
  { label: 'Expiring soon', rule: `Flagged ${EXPIRING_WITHIN_DAYS} days before the end date` },
  { label: 'Other consents', rule: 'No end date; valid until revoked or a new version requires re-signing' },
];
