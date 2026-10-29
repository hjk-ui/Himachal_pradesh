/**
 * Public intake forms (pure): field definitions, submission validation, spam checks, embed code.
 *
 * Public form rules: no PHI in the URL or query string (the form posts JSON in the body), no
 * third-party scripts or pixels, the SMS consent box is never pre-checked (TCPA), and the page
 * warns people not to type health details (minimum necessary) and shows 988.
 */
import { LEAD_SOURCE_KEYS, PREFERRED_CONTACT } from './constants';
import { isValidEmail, toUsE164 } from './consent';

export type FormFieldType = 'text' | 'email' | 'phone' | 'date' | 'select' | 'textarea' | 'checkbox';

export type FormField = {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
  help?: string;
};

/** Built-in fields (lead columns). Custom fields are not allowed: every answer lands in a known, minimum-necessary column. */
export const STANDARD_FIELDS: FormField[] = [
  { key: 'firstName', label: 'First name', type: 'text', required: true },
  { key: 'lastName', label: 'Last name', type: 'text', required: true },
  { key: 'phone', label: 'Mobile phone', type: 'phone', required: false },
  { key: 'email', label: 'Email', type: 'email', required: false },
  { key: 'dateOfBirth', label: 'Date of birth', type: 'date', required: false, help: 'Helps us find you if you have been here before.' },
  { key: 'serviceInterest', label: 'Service you are interested in', type: 'select', required: false },
  { key: 'location', label: 'Preferred location', type: 'select', required: false },
  { key: 'insurance', label: 'Insurance plan (name only)', type: 'text', required: false, help: 'Do not enter member ID numbers here.' },
  { key: 'preferredContact', label: 'Best way to reach you', type: 'select', required: false, options: PREFERRED_CONTACT.map((p) => p.label) },
  { key: 'howHeard', label: 'How did you hear about us?', type: 'select', required: false },
  { key: 'contactConsent', label: 'Contact consent', type: 'checkbox', required: true },
  { key: 'smsConsent', label: 'Text message consent', type: 'checkbox', required: false },
];

export const STANDARD_FIELD_KEYS = STANDARD_FIELDS.map((f) => f.key);

export const HOW_HEARD_OPTIONS: { label: string; source: string }[] = [
  { label: 'Search engine / website', source: 'website_form' },
  { label: 'Insurance directory', source: 'insurance_directory' },
  { label: 'Therapist listing site', source: 'listing' },
  { label: 'Doctor, school or other referral', source: 'referral_partner' },
  { label: 'Community event', source: 'community_event' },
  { label: 'Social media', source: 'social' },
  { label: 'Friend or family', source: 'other' },
  { label: 'Other', source: 'other' },
];

/** Normalize the builder's field list: standard keys only, required firstName / lastName / contactConsent always on. */
export function normalizeFormFields(raw: unknown): FormField[] {
  const picked = new Map<string, Partial<FormField>>();
  if (Array.isArray(raw)) {
    for (const f of raw as Partial<FormField>[]) {
      if (f && typeof f.key === 'string' && STANDARD_FIELD_KEYS.includes(f.key)) picked.set(f.key, f);
    }
  }
  const always = new Set(['firstName', 'lastName', 'contactConsent']);
  return STANDARD_FIELDS.filter((f) => always.has(f.key) || picked.has(f.key)).map((f) => {
    const p = picked.get(f.key);
    const label = typeof p?.label === 'string' && p.label.trim() ? p.label.trim().slice(0, 80) : f.label;
    return { ...f, label, required: always.has(f.key) ? true : f.key === 'smsConsent' ? false : Boolean(p?.required) };
  });
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export type Submission = Record<string, unknown>;

export type SpamMeta = {
  /** Hidden honeypot field; humans leave it empty */
  honeypot?: string | null;
  /** ms epoch when the form rendered (client sends it back) */
  renderedAt?: number | null;
  now: number;
};

export const MIN_FILL_MS = 3000;
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

/** true = looks like a bot. Bots get a normal-looking success response but nothing is saved. */
export function isSpam(meta: SpamMeta): boolean {
  if (meta.honeypot && String(meta.honeypot).trim()) return true;
  if (!meta.renderedAt || !Number.isFinite(meta.renderedAt)) return true;
  const age = meta.now - meta.renderedAt;
  if (age < MIN_FILL_MS) return true;
  if (age > MAX_FORM_AGE_MS) return true;
  return false;
}

export type CleanSubmission = {
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  serviceInterest: string | null;
  location: string | null;
  insurance: string | null;
  preferredContact: string | null;
  source: string;
  sourceDetail: string | null;
  contactConsent: boolean;
  smsConsent: boolean;
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Validate a public submission against the form definition. Answers to fields the form does not
 * show are dropped. Returns field errors keyed by field.
 */
export function validateSubmission(
  fields: FormField[],
  body: Submission,
  opts: { serviceOptions?: string[]; locationOptions?: string[]; now?: Date } = {},
): { ok: true; value: CleanSubmission } | { ok: false; errors: Record<string, string> } {
  const shown = new Set(fields.map((f) => f.key));
  const errors: Record<string, string> = {};
  const get = (k: string, max = 120) => (shown.has(k) ? str(body[k], max) : '');
  const firstName = get('firstName', 80);
  const lastName = get('lastName', 80);
  if (!firstName) errors.firstName = 'Enter your first name.';
  if (!lastName) errors.lastName = 'Enter your last name.';
  const phoneRaw = get('phone', 40);
  const phone = phoneRaw ? toUsE164(phoneRaw) : null;
  if (phoneRaw && !phone) errors.phone = 'Enter a 10-digit US phone number.';
  const emailRaw = get('email', 200).toLowerCase();
  if (emailRaw && !isValidEmail(emailRaw)) errors.email = 'Enter a valid email address.';
  if (!phoneRaw && !emailRaw) errors.phone = errors.phone ?? 'Enter a phone number or an email so we can reach you.';
  const dobRaw = get('dateOfBirth', 10);
  let dateOfBirth: string | null = null;
  if (dobRaw) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobRaw);
    const d = m ? new Date(`${dobRaw}T00:00:00Z`) : null;
    const now = opts.now ?? new Date();
    if (!d || Number.isNaN(d.getTime()) || d.getTime() >= now.getTime() || d.getUTCFullYear() < 1900) errors.dateOfBirth = 'Enter a valid date of birth.';
    else dateOfBirth = dobRaw;
  }
  const pick = (k: string, options: string[] | undefined) => {
    const v = get(k);
    if (!v) return null;
    if (options && options.length && !options.includes(v)) {
      errors[k] = 'Choose an option from the list.';
      return null;
    }
    return v;
  };
  const serviceInterest = pick('serviceInterest', opts.serviceOptions);
  const location = pick('location', opts.locationOptions);
  const insurance = get('insurance', 80) || null;
  if (insurance && /\d{6,}/.test(insurance)) errors.insurance = 'Enter the plan name only, not a member ID.';
  const pc = get('preferredContact', 40);
  const preferredContact = PREFERRED_CONTACT.find((p) => p.label === pc || p.key === pc)?.key ?? null;
  const howHeard = get('howHeard', 80);
  const heard = HOW_HEARD_OPTIONS.find((h) => h.label === howHeard);
  const contactConsent = body.contactConsent === true || body.contactConsent === 'true' || body.contactConsent === 'on';
  if (!contactConsent) errors.contactConsent = 'Please agree to be contacted so we can respond.';
  const smsConsent = shown.has('smsConsent') && (body.smsConsent === true || body.smsConsent === 'true' || body.smsConsent === 'on');
  if (preferredContact === 'sms' && !smsConsent) errors.smsConsent = 'Check the text message box to be reached by text.';
  if (smsConsent && !phone) errors.phone = errors.phone ?? 'Enter a mobile number to receive texts.';

  for (const f of fields) {
    if (f.required && !['firstName', 'lastName', 'contactConsent'].includes(f.key)) {
      const v = f.type === 'checkbox' ? body[f.key] === true : str(body[f.key], 200);
      if (!v) errors[f.key] = errors[f.key] ?? `${f.label} is required.`;
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const source = heard && (LEAD_SOURCE_KEYS as string[]).includes(heard.source) && heard.source !== 'website_form' ? heard.source : 'website_form';
  return {
    ok: true,
    value: {
      firstName,
      lastName,
      phone,
      email: emailRaw || null,
      dateOfBirth,
      serviceInterest,
      location,
      insurance,
      preferredContact,
      source,
      sourceDetail: heard ? heard.label : null,
      contactConsent,
      smsConsent,
    },
  };
}

/** Query keys that would carry PHI. Public form URLs must never contain them. */
const PHI_QUERY_KEYS = /^(first|last|full)?_?name$|^(e-?mail|phone|mobile|tel|dob|birth(date|day)?|date_?of_?birth|insurance|member(_?id)?|reason|diagnosis|symptoms?|message|notes?|address|zip)$/i;

export function urlHasPhi(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url, 'https://x.invalid');
  } catch {
    return true;
  }
  for (const k of u.searchParams.keys()) if (PHI_QUERY_KEYS.test(k)) return true;
  if (/@|%40/.test(u.pathname)) return true;
  if (/\d{7,}/.test(u.pathname)) return true;
  return false;
}

export function hostedFormPath(orgSlug: string, formSlug: string): string {
  return `/p/${encodeURIComponent(orgSlug)}/intake/${encodeURIComponent(formSlug)}`;
}

/** iframe embed (no script tag, no cookies shared with the host site). */
export function embedSnippet(baseUrl: string, orgSlug: string, formSlug: string, title = 'Request an appointment'): string {
  const src = `${baseUrl.replace(/\/+$/, '')}${hostedFormPath(orgSlug, formSlug)}?embed=1`;
  return `<iframe src="${src}" title="${title.replace(/"/g, '&quot;')}" style="width:100%;max-width:640px;min-height:900px;border:0" loading="lazy" referrerpolicy="no-referrer"></iframe>`;
}

/** Public rate limits: per IP across forms, and per IP per form. */
export const FORM_RATE_LIMIT = { perIp: { limit: 10, windowMs: 60 * 60 * 1000 }, perForm: { limit: 3, windowMs: 10 * 60 * 1000 } } as const;
