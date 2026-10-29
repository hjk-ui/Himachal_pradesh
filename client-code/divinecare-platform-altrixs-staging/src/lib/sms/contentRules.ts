/**
 * Content rules for every PATIENT text (minimum necessary, 45 CFR 164.502(b); CTIA opt-out wording).
 * A text can sit on a lock screen or a shared phone, so it carries no clinical, billing or identifying
 * detail: no diagnosis or condition, no provider name or specialty that reveals behavioral health or
 * SUD treatment, no balance or amount, no lab values, no medication. The practice name is the only
 * exception and only when the practice allows it (Admin > Scheduling > "Show practice name in
 * texts"); the gate strips the sender before scanning.
 *
 * Used twice: at send time by sendPatientSms (blocks the text) and by tests/sms-patient-gate.test.ts
 * against every template.
 */

export type PatientSmsPurpose =
  | 'appointment_confirmation'
  | 'appointment_reminder'
  | 'telehealth_scheduled'
  | 'telehealth_join_link'
  | 'portal_notice'
  | 'statement_ready'
  | 'portal_invite'
  | 'documents_to_sign'
  | 'staff_message'
  | 'security_code'
  | 'measure_request';

export type PurposeRule = {
  label: string;
  /** explicit = Client.smsConsent; requested_code = patient-requested one-time code to a verified number */
  consent: 'explicit' | 'requested_code';
  /** CTIA: non-transactional texts end with opt-out wording */
  optOutFooter: boolean;
  allowLink: boolean;
  /** Free text typed by staff (footer appended when missing; name check off) */
  freeText?: boolean;
};

export const PATIENT_SMS_PURPOSES: Record<PatientSmsPurpose, PurposeRule> = {
  appointment_confirmation: { label: 'Appointment confirmation text', consent: 'explicit', optOutFooter: true, allowLink: false },
  appointment_reminder: { label: 'Appointment reminder text', consent: 'explicit', optOutFooter: true, allowLink: false },
  telehealth_scheduled: { label: 'Video visit scheduled text', consent: 'explicit', optOutFooter: true, allowLink: true },
  telehealth_join_link: { label: 'Video visit join link text', consent: 'explicit', optOutFooter: true, allowLink: true },
  portal_notice: { label: 'Portal notice text', consent: 'explicit', optOutFooter: true, allowLink: false },
  statement_ready: { label: 'Statement ready text', consent: 'explicit', optOutFooter: true, allowLink: true },
  portal_invite: { label: 'Portal invitation text', consent: 'explicit', optOutFooter: true, allowLink: true },
  /** Consent forms waiting in the portal: link to the portal sign-in only (no form names, no PHI) */
  documents_to_sign: { label: 'Forms to sign text', consent: 'explicit', optOutFooter: true, allowLink: true },
  staff_message: { label: 'Staff text message', consent: 'explicit', optOutFooter: true, allowLink: true, freeText: true },
  security_code: { label: 'Security code text', consent: 'requested_code', optOutFooter: false, allowLink: false },
  /** Questionnaire before a visit: link to /m/<token> (date of birth asked first); never names the measure */
  measure_request: { label: 'Questionnaire text', consent: 'explicit', optOutFooter: true, allowLink: true },
};

export const OPT_OUT_FOOTER = 'Reply STOP to opt out.';
export const MAX_PATIENT_SMS_LENGTH = 480;

export type SmsLintIssue = 'phi_term' | 'money' | 'missing_opt_out' | 'link_not_allowed' | 'too_long' | 'client_name';

/** Conditions, specialties, treatments, provider titles, medication and result words. */
const PHI_TERMS: RegExp[] = [
  /diagnos/i,
  /\bicd\b/i,
  /\b[A-TV-Z]\d{2}(\.\d{1,4})?\b/, // ICD-10 shaped codes (F32.1, Z63)
  /psych/i,
  /behaviou?ral/i,
  /mental\s+health/i,
  /therap/i,
  /counsel/i,
  /substance/i,
  /addict/i,
  /\bsud\b/i,
  /opioid|suboxone|methadone|buprenorph|naloxone|vivitrol/i,
  /detox|rehab/i,
  /depress|anxiety|bipolar|schizo|\bptsd\b|\badhd\b|autism|eating disorder/i,
  /\bhiv\b|\bstd\b|\bsti\b|pregnan/i,
  /medication|prescri|\brx\b|refill|dosage|\bmg\b/i,
  /lab value|result value|mg\/dl|\ba1c\b|positive|negative/i,
  /\bdr\.?\s|doctor|clinician|psychiatrist|nurse practitioner/i,
  /crisis|suicid|overdose/i,
];

const MONEY_TERMS: RegExp[] = [/\$\s?\d/, /\bbalance\b/i, /amount due|past due|you owe|\bowed?\b|collections/i];

const LINK = /https?:\/\/|www\./i;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Scan the body with the allowed sender (practice name) removed. */
export function lintPatientSms(
  body: string,
  opts: { purpose: PatientSmsPurpose; sender?: string | null; clientName?: string | null }
): SmsLintIssue[] {
  const rule = PATIENT_SMS_PURPOSES[opts.purpose];
  const issues = new Set<SmsLintIssue>();
  let scan = body;
  const sender = opts.sender?.trim();
  if (sender) scan = scan.replace(new RegExp(escapeRe(sender), 'gi'), 'SENDER');
  // Links are opaque tokens: never scan them for words
  const words = scan.replace(/https?:\/\/\S+/gi, 'LINK');
  if (PHI_TERMS.some((re) => re.test(words))) issues.add('phi_term');
  if (MONEY_TERMS.some((re) => re.test(words))) issues.add('money');
  if (rule.optOutFooter && !/\bSTOP\b[^.]*opt.?out/i.test(body)) issues.add('missing_opt_out');
  if (!rule.allowLink && LINK.test(body)) issues.add('link_not_allowed');
  if (body.length > MAX_PATIENT_SMS_LENGTH) issues.add('too_long');
  if (!rule.freeText && opts.clientName) {
    const parts = opts.clientName.split(/[\s,]+/).map((p) => p.trim()).filter((p) => p.length >= 3);
    if (parts.some((p) => new RegExp(`\\b${escapeRe(p)}\\b`, 'i').test(words))) issues.add('client_name');
  }
  return Array.from(issues);
}

/** Sender line: the practice name only when the practice allows it, else a neutral label. */
export function smsSender(practiceName: string | null | undefined, showPracticeName: boolean): string {
  const n = (practiceName ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
  return showPracticeName && n ? n : 'Your care team';
}
