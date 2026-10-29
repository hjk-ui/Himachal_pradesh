import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { getOrCreateSchedulingSettings } from '@/lib/scheduling/manage';
import { smsEligibility, type SmsSkipReason } from '@/lib/sms/consent';
import { normalizeToE164 } from '@/lib/sms/phone';
import { isSnsSmsConfigured, sendSms, smsWasSent } from '@/lib/sms/send';
import {
  PATIENT_SMS_PURPOSES,
  lintPatientSms,
  smsSender,
  type PatientSmsPurpose,
  type SmsLintIssue,
} from '@/lib/sms/contentRules';
import { withOptOutFooter } from '@/lib/sms/templates';

/**
 * THE gate for every text to a PATIENT (TCPA + HIPAA minimum necessary). Nothing patient-facing calls
 * sendSms directly; tests/sms-patient-gate.test.ts fails the build if a new file does.
 *
 * Consent policy (practice choice, stricter than the law):
 *   The TCPA healthcare exemption (47 CFR 64.1200(a)(9)(iv)) would let a HIPAA covered entity send
 *   some treatment-related texts (appointment reminders, lab-ready notices) to the number the patient
 *   gave without separate written consent. This practice chose EXPLICIT consent for everything
 *   patient-facing: Client.smsConsent must be true, no STOP / revoked consent (smsOptOutAt), and a
 *   valid number on the chart. The texts go only to that charted number (a typed-in "other" number is
 *   refused: consent is per number).
 *   One exception: a one-time security code the patient requested themselves (purpose
 *   security_code) needs no smsConsent, only a number the caller has verified (phoneVerified) and no
 *   STOP on file.
 *   Not routed here: STOP / HELP / START / C keyword replies (src/lib/sms/inbound.ts; CTIA requires
 *   the STOP confirmation even though the number just opted out) and staff texts (src/lib/sms/staff.ts).
 *
 * Never throws and never reports a fake success: the result says sent, or not sent with a typed
 * reason and a sentence staff can read. Every send and skip is written to NotificationLog (type =
 * purpose, channel sms, status, reason; the message text is NOT stored) and to the HIPAA audit log.
 */

export type PatientSmsReason =
  | SmsSkipReason
  | 'invalid_phone'
  | 'client_not_found'
  | 'number_not_on_file'
  | 'number_not_verified'
  | 'setting_off'
  | 'content_blocked'
  | 'sms_not_configured'
  | 'send_error';

export type PatientSmsResult =
  | { sent: true; status: 'sent'; mode: 'sms' | 'sns'; messageId?: string; body: string; message: string }
  | { sent: false; status: 'skipped' | 'failed'; reason: PatientSmsReason; message: string; issues?: SmsLintIssue[] };

const REASON_TEXT: Record<PatientSmsReason, string> = {
  no_sms_consent: 'Not sent: client has not consented to text messages.',
  sms_opted_out: 'Not sent: client opted out of text messages (replied STOP or revoked consent).',
  no_phone: 'Not sent: no mobile number on file.',
  invalid_phone: 'Not sent: the phone number on file is not a valid mobile number.',
  client_not_found: 'Not sent: client not found.',
  number_not_on_file: "Not sent: texts go only to the number on the client's chart that they consented on. Update the chart first.",
  number_not_verified: 'Not sent: the phone number has not been verified.',
  setting_off: 'Not sent: this text is turned off in practice settings.',
  content_blocked: 'Not sent: the text includes clinical, billing or identifying detail. Use a secure portal message instead.',
  sms_not_configured: 'Not sent: text messaging is not configured on this server.',
  send_error: 'Not sent: the text message service returned an error.',
};

export function smsReasonText(reason: PatientSmsReason): string {
  return REASON_TEXT[reason];
}

/** Consent / opt-out / revoked reasons are DENIED in the audit trail; service problems are FAILURE */
const DENIED: ReadonlySet<PatientSmsReason> = new Set(['no_sms_consent', 'sms_opted_out', 'number_not_on_file', 'number_not_verified', 'setting_off', 'content_blocked']);

export type GateClient = {
  id: string;
  organizationId?: string | null;
  name?: string | null;
  phone?: string | null;
  smsConsent?: boolean | null;
  smsOptOutAt?: Date | string | null;
};

export type CanTextResult = { ok: true; to: string } | { ok: false; reason: PatientSmsReason };

/**
 * Pure consent decision. `to` (optional) must be the charted number; `phoneVerified` only matters
 * for security_code.
 */
export function canTextFor(
  client: GateClient | null,
  purpose: PatientSmsPurpose,
  opts: { to?: string | null; phoneVerified?: boolean } = {}
): CanTextResult {
  if (!client) return { ok: false, reason: 'client_not_found' };
  const rule = PATIENT_SMS_PURPOSES[purpose];
  if (rule.consent === 'requested_code') {
    // Patient asked for the code: no marketing-style consent needed, but STOP is still honored
    if (client.smsOptOutAt) return { ok: false, reason: 'sms_opted_out' };
    if (!opts.phoneVerified) return { ok: false, reason: 'number_not_verified' };
  } else {
    const e = smsEligibility(client);
    if (e.ok === false) return { ok: false, reason: e.reason };
  }
  const charted = normalizeToE164(client.phone);
  if (!charted) return { ok: false, reason: client.phone?.trim() ? 'invalid_phone' : 'no_phone' };
  if (opts.to?.trim()) {
    const requested = normalizeToE164(opts.to);
    if (!requested) return { ok: false, reason: 'invalid_phone' };
    if (requested !== charted) return { ok: false, reason: 'number_not_on_file' };
  }
  return { ok: true, to: charted };
}

export type PracticeSmsSettings = { practiceName: string | null; showPracticeName: boolean; smsConfirm: boolean };

export type PatientSmsDeps = {
  db: any;
  send: typeof sendSms;
  configured: () => boolean;
  audit: typeof writeAuditLog;
  practice: (organizationId: string) => Promise<PracticeSmsSettings>;
};

export const defaultPatientSmsDeps = (): PatientSmsDeps => ({
  db: prisma,
  send: sendSms,
  configured: isSnsSmsConfigured,
  audit: writeAuditLog,
  practice: async (organizationId) => {
    const s = await getOrCreateSchedulingSettings(organizationId);
    return {
      practiceName: s.practiceName,
      showPracticeName: s.reminders.smsShowPracticeName !== false,
      smsConfirm: Boolean(s.reminders.smsConfirm),
    };
  },
});

const CLIENT_SELECT = { id: true, organizationId: true, name: true, phone: true, smsConsent: true, smsOptOutAt: true } as const;

/** assertCanText(clientId, purpose): loads the client and returns the typed decision (never throws). */
export async function assertCanText(
  clientId: string,
  purpose: PatientSmsPurpose,
  opts: { to?: string | null; phoneVerified?: boolean; organizationId?: string | null } = {},
  deps: Pick<PatientSmsDeps, 'db'> = defaultPatientSmsDeps()
): Promise<CanTextResult> {
  const client: GateClient | null = await deps.db.client
    .findUnique({ where: { id: clientId }, select: CLIENT_SELECT })
    .catch(() => null);
  if (client && opts.organizationId && client.organizationId && client.organizationId !== opts.organizationId) {
    return { ok: false, reason: 'client_not_found' };
  }
  return canTextFor(client, purpose, opts);
}

export type SendPatientSmsInput = {
  clientId: string;
  purpose: PatientSmsPurpose;
  /** Builds the text from the resolved sender (practice name or "Your care team") */
  build: (ctx: { sender: string }) => string;
  organizationId?: string | null;
  /** Destination override (must equal the charted number) */
  to?: string | null;
  phoneVerified?: boolean;
  appointmentId?: string | null;
  actor?: { userId?: string | null; role?: string | null };
};

export async function sendPatientSms(input: SendPatientSmsInput, deps: PatientSmsDeps = defaultPatientSmsDeps()): Promise<PatientSmsResult> {
  const rule = PATIENT_SMS_PURPOSES[input.purpose];
  const client: GateClient | null = await deps.db.client
    .findUnique({ where: { id: input.clientId }, select: CLIENT_SELECT })
    .catch(() => null);
  const orgMismatch = Boolean(client && input.organizationId && client.organizationId && client.organizationId !== input.organizationId);
  const organizationId = input.organizationId ?? client?.organizationId ?? null;

  const finish = async (result: PatientSmsResult): Promise<PatientSmsResult> => {
    const reason = 'reason' in result ? result.reason : null;
    if (client && !orgMismatch) {
      await deps.db.notificationLog
        .create({
          data: {
            clientId: client.id,
            appointmentId: input.appointmentId ?? null,
            type: input.purpose,
            channel: 'sms',
            dedupeKey: `sms:${input.purpose}:${client.id}:${randomUUID()}`,
            title: rule.label,
            body: '(message text not stored)',
            status: result.status,
            reason,
            successCount: result.sent ? 1 : 0,
            failureCount: result.status === 'failed' ? 1 : 0,
          },
        })
        .catch(() => {});
    }
    await deps
      .audit({
        action: result.sent ? 'PATIENT_SMS_SENT' : 'PATIENT_SMS_NOT_SENT',
        actorUserId: input.actor?.userId ?? null,
        actorRole: input.actor?.role ?? null,
        organizationId,
        resourceType: 'client',
        resourceId: input.clientId,
        patientId: client && !orgMismatch ? client.id : null,
        outcome: result.sent ? 'SUCCESS' : reason && DENIED.has(reason) ? 'DENIED' : 'FAILURE',
        metadata: { purpose: input.purpose, status: result.status, reason, ...('issues' in result ? { issues: result.issues } : {}) },
      })
      .catch(() => {});
    return result;
  };
  const notSent = (reason: PatientSmsReason, status: 'skipped' | 'failed' = 'skipped', issues?: SmsLintIssue[]) =>
    finish({ sent: false, status, reason, message: REASON_TEXT[reason], ...(issues ? { issues } : {}) });

  if (orgMismatch) return notSent('client_not_found');
  const decision = canTextFor(client, input.purpose, { to: input.to, phoneVerified: input.phoneVerified });
  if (decision.ok === false) return notSent(decision.reason);

  let practice: PracticeSmsSettings = { practiceName: null, showPracticeName: false, smsConfirm: false };
  if (organizationId) {
    practice = await deps.practice(organizationId).catch(() => practice);
  }
  if (input.purpose === 'appointment_confirmation' && !practice.smsConfirm) return notSent('setting_off');

  const sender = smsSender(practice.practiceName, practice.showPracticeName);
  let body: string;
  try {
    body = input.build({ sender });
  } catch {
    return notSent('content_blocked');
  }
  if (rule.freeText) body = withOptOutFooter(body);
  const issues = lintPatientSms(body, { purpose: input.purpose, sender, clientName: client?.name });
  if (issues.length) return notSent('content_blocked', 'skipped', issues);

  if (!deps.configured() && process.env.NODE_ENV === 'production') return notSent('sms_not_configured', 'failed');
  try {
    const r = await deps.send({ to: decision.to, body, context: `patient-${input.purpose}` });
    if (smsWasSent(r)) {
      return finish({ sent: true, status: 'sent', mode: r.mode as 'sms' | 'sns', messageId: r.messageId, body, message: 'Text message sent.' });
    }
    // console (dev, SMS unset) or skipped: nothing reached the patient
    return notSent(r.mode === 'console' ? 'sms_not_configured' : 'invalid_phone', 'failed');
  } catch {
    return notSent('send_error', 'failed');
  }
}
