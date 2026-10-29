/**
 * Automatic overnight eligibility checks: pure rules (no database; unit tested in
 * tests/owner-decisions-oct21.test.ts). The job is scripts/eligibility-nightly.ts; the database side
 * is src/lib/eligibility/nightlyRun.ts.
 *
 * Owner decision 2026-10-21:
 *  - Practice setting "Automatic overnight eligibility checks", default OFF ("enable after Waystar
 *    production is live"). Leadership + billing change it on the eligibility page.
 *  - For tomorrow's appointments whose payer coverage was not verified within the front-office
 *    staleness window (src/lib/frontOffice/rules.ts: 30 days; Maryland Medicaid in the visit month),
 *    send a 270 through the existing Waystar submission path (requestWaystarEligibility).
 *  - Never for self-pay. One inquiry per client + payer per night. At most 99 per 270 file (the
 *    existing batch limit) and NIGHTLY_MAX_INQUIRIES per organization per night.
 *  - Refuses to run while the Waystar usage indicator is T (test) unless "Allow on test
 *    clearinghouse" is on (default OFF).
 */
import {
  ELIGIBILITY_WINDOW_DAYS,
  MEDICAID_SAME_MONTH,
  eligibilityVerdict,
  payerMatches,
  type FoEligibilityFact,
} from '@/lib/frontOffice/rules';
import { isSelfPayPayer } from '@/lib/billing/patientLedgerMath';

export const NIGHTLY_SETTING_LABEL = 'Automatic overnight eligibility checks';
export const NIGHTLY_ALLOW_TEST_LABEL = 'Allow on test clearinghouse';
export const NIGHTLY_OFF_NOTE = 'Off — enable after Waystar production is live';
/** Existing Waystar batch limit: one 270 file carries at most 99 inquiries (requestWaystarEligibility). */
export const NIGHTLY_BATCH_SIZE = 99;
/** Ceiling per organization per night (about two weeks of the three clinics' daily volume). */
export const NIGHTLY_MAX_INQUIRIES = 300;
/** A check created within this many hours counts as "already sent tonight" (one per client + payer per night). */
export const NIGHTLY_DEDUPE_HOURS = 20;

/** Roles that may change the nightly setting: leadership + billing. */
const SETTINGS_ROLES = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING']);
export function canManageNightlyEligibility(role: string | null | undefined): boolean {
  return SETTINGS_ROLES.has(String(role ?? '').trim().toUpperCase());
}

export type NightlySettings = { enabled: boolean; allowTest: boolean };

export type NightlyGate =
  | { run: true }
  | { run: false; reason: 'setting_off' | 'waystar_not_active' | 'test_clearinghouse'; message: string };

/** Organization-level gate: setting on, Waystar SFTP eligibility live, production indicator (or test explicitly allowed). */
export function nightlyGate(input: { settings: NightlySettings; waystarActive: boolean; usageIndicator: 'T' | 'P' | string | null | undefined }): NightlyGate {
  if (!input.settings.enabled) return { run: false, reason: 'setting_off', message: `${NIGHTLY_SETTING_LABEL} is off` };
  if (!input.waystarActive) return { run: false, reason: 'waystar_not_active', message: 'Waystar SFTP eligibility is not active on this server' };
  if (input.usageIndicator !== 'P' && !input.settings.allowTest) {
    return { run: false, reason: 'test_clearinghouse', message: `Waystar usage indicator is ${input.usageIndicator || 'not set'} (test); turn on "${NIGHTLY_ALLOW_TEST_LABEL}" to send anyway` };
  }
  return { run: true };
}

/** One of tomorrow's appointments (minimum necessary: ids, time, status, payer, Medicaid flag). */
export type NightlyAppointment = {
  id: string;
  clientId: string;
  startsAt: Date;
  status: string;
  payer: string | null;
  medicaid: boolean;
};

export type NightlyInquiry = { clientId: string; payer: string; appointmentId: string; dos: string };

export type NightlySkipReason =
  | 'not_going_ahead'
  | 'self_pay'
  | 'current'
  | 'awaiting_response'
  | 'inactive_on_file'
  | 'sent_tonight'
  | 'duplicate_client_payer'
  | 'over_nightly_limit';

export type NightlySelection = {
  inquiries: NightlyInquiry[];
  skipped: Record<NightlySkipReason, number>;
  /** why each selected inquiry is needed (counts only) */
  reasons: { never_verified: number; stale: number; payer_changed: number; last_check_failed: number };
};

const DEAD = new Set(['CANCELLED', 'NO_SHOW', 'LATE_CANCEL']);
const lower = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase();

/**
 * Tomorrow's appointments that need a 270 tonight. Uses the front-office verdict (same 30-day /
 * Medicaid visit-month rule the huddle shows), so the job and the front desk never disagree.
 * `dos` is the visit's practice calendar date (YYYY-MM-DD).
 */
export function selectNightlyInquiries(input: {
  appointments: readonly NightlyAppointment[];
  /** eligibility checks per client, any order */
  checks: ReadonlyMap<string, readonly FoEligibilityFact[]>;
  /** practice calendar date of the visit, per appointment id */
  visitDate: (a: NightlyAppointment) => string;
  now: Date;
  max?: number;
  windowDays?: number;
  medicaidSameMonth?: boolean;
}): NightlySelection {
  const skipped: Record<NightlySkipReason, number> = {
    not_going_ahead: 0, self_pay: 0, current: 0, awaiting_response: 0, inactive_on_file: 0, sent_tonight: 0, duplicate_client_payer: 0, over_nightly_limit: 0,
  };
  const reasons = { never_verified: 0, stale: 0, payer_changed: 0, last_check_failed: 0 };
  const inquiries: NightlyInquiry[] = [];
  const seen = new Set<string>();
  const max = input.max ?? NIGHTLY_MAX_INQUIRIES;
  const dedupeFrom = input.now.getTime() - NIGHTLY_DEDUPE_HOURS * 3_600_000;
  const sorted = [...input.appointments].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));

  for (const a of sorted) {
    if (DEAD.has(String(a.status).toUpperCase())) { skipped.not_going_ahead++; continue; }
    const payer = (a.payer ?? '').trim();
    // Self-pay (or no payer on the visit) is never sent, Medicaid flag or not: there is no payer to ask
    if (!payer || isSelfPayPayer(payer)) { skipped.self_pay++; continue; }
    const key = `${a.clientId}|${lower(payer)}`;
    if (seen.has(key)) { skipped.duplicate_client_payer++; continue; }
    const checks = input.checks.get(a.clientId) ?? [];
    if (checks.some((c) => payerMatches(c.payerName, payer) && c.checkedAt.getTime() >= dedupeFrom && c.status !== 'ELIGIBLE')) {
      // A 270 (or failed attempt) for this client + payer already went out in the last night
      seen.add(key);
      skipped.sent_tonight++;
      continue;
    }
    const v = eligibilityVerdict({
      payer,
      medicaid: a.medicaid,
      visitAt: a.startsAt,
      checks,
      windowDays: input.windowDays ?? ELIGIBILITY_WINDOW_DAYS,
      medicaidSameMonth: input.medicaidSameMonth ?? MEDICAID_SAME_MONTH,
    });
    if (v.state === 'self_pay') { skipped.self_pay++; continue; }
    if (v.state === 'current') { seen.add(key); skipped.current++; continue; }
    if (v.state === 'awaiting') { seen.add(key); skipped.awaiting_response++; continue; }
    if (v.state === 'inactive') { seen.add(key); skipped.inactive_on_file++; continue; }
    if (inquiries.length >= max) { skipped.over_nightly_limit++; continue; }
    seen.add(key);
    if (v.state === 'none') reasons.never_verified++;
    else if (v.state === 'stale') reasons.stale++;
    else if (v.state === 'payer_mismatch') reasons.payer_changed++;
    else reasons.last_check_failed++;
    inquiries.push({ clientId: a.clientId, payer, appointmentId: a.id, dos: input.visitDate(a) });
  }
  return { inquiries, skipped, reasons };
}

/** Split into 270 files of at most NIGHTLY_BATCH_SIZE inquiries. */
export function chunkInquiries<T>(list: readonly T[], size = NIGHTLY_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
