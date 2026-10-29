/**
 * Central redaction for the integration call log (Admin > Integrations > Logs).
 *
 * Two layers, applied to everything the log stores or shows:
 *  1. Key names: any object key that names a credential or a card / SSN field is replaced with
 *     "[redacted]" whatever its value (password, vendor_pass, token, api_key, secret, MAC,
 *     Authorization, cookie, signature, card number, CVC, SSN ...).
 *  2. Value patterns inside strings: XML credential elements (<VendorPassword>, <Password>, ...),
 *     MAC= / token= / key= query parameters, Authorization / Bearer / Basic headers, JWTs, AWS
 *     access keys, Stripe keys, Luhn-valid card numbers and dashed SSNs.
 *
 * Patient masking (maskPatientIdentifiers) is a separate, optional step used for the
 * "Download for vendor support" file: names, dates of birth, addresses, phones, emails.
 */

export const REDACTED = '[redacted]';

/** Object keys whose values are never stored or shown. */
const SECRET_KEY_RE =
  /^(?:.*(?:password|passwd|passphrase|secret|token|api[-_]?key|apikey|private[-_]?key|credential|cookie|signature|authorization)|.*vendor[-_]?pass.*|pass|pwd|mac|hmac|auth|x[-_]api[-_]key|card[-_]?number|cardnumber|pan|cvc|cvv|cvv2|ssn|social[-_]?security(?:[-_]?number)?|account[-_]?number|routing[-_]?number)$/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key.trim());
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Redact credentials and card / SSN numbers inside free text (XML, URLs, headers, messages). */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input
    // XML credential elements (DrFirst <VendorPassword>, any *Password / *Secret / *Token / *ApiKey element)
    .replace(
      /<((?:[\w-]+:)?[\w-]*(?:Password|Passwd|Secret|Token|ApiKey|PrivateKey)[\w-]*)(\s[^>]*)?>[^<]*<\/\1>/gi,
      (_m, tag: string, attrs: string | undefined) => `<${tag}${attrs ?? ''}>${REDACTED}</${tag}>`
    )
    // Authorization headers (raw header lines or JSON-ish "Authorization": "...")
    .replace(/(authorization["']?\s*[:=]\s*["']?)(?:bearer|basic|digest|aws4-hmac-sha256)?\s*[^"'\r\n,}]+/gi, `$1${REDACTED}`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${REDACTED}`)
    // MAC / signature / token / key / password query parameters (SSO URLs, signed URLs)
    .replace(
      /((?:^|[?&;\s])(?:MAC|mac|sig|signature|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|token|access_token|refresh_token|id_token|api_key|apikey|key|password|pass|pwd|secret|client_secret)=)[^&\s"'<]*/g,
      `$1${REDACTED}`
    )
    // "password": "..." / password=... pairs in JSON or form text
    .replace(
      /(["']?(?:[\w-]*password|[\w-]*secret|[\w-]*token|api[-_]?key|vendor[-_]?pass\w*|client[-_]?secret)["']?\s*[:=]\s*)(["'])(?:(?!\2)[^\\]|\\.)*\2/gi,
      `$1$2${REDACTED}$2`
    )
    // JWTs
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[jwt]')
    // AWS access key ids
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[aws-key]')
    // Stripe secret / restricted keys and webhook secrets
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g, '[stripe-key]')
    .replace(/\bwhsec_[A-Za-z0-9]{8,}\b/g, '[stripe-key]')
    // SSN (dashed or spaced)
    .replace(/\b\d{3}[- ]\d{2}[- ]\d{4}\b/g, '[ssn]');
  // Card numbers: 13-19 digits, optionally grouped by spaces / dashes, Luhn-valid
  out = out.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => {
    const digits = m.replace(/[ -]/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? '[card]' : m;
  });
  return out;
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

/** Error text for the log: secrets removed, emails / phone numbers masked, at most `max` characters. */
export function sanitizeErrorMessage(message: unknown, max = 500): string | null {
  if (message === null || message === undefined) return null;
  const raw = message instanceof Error ? message.message : String(message);
  if (!raw.trim()) return null;
  // Prisma errors quote the query (and its values): keep the error class only
  if ((message instanceof Error && /^Prisma/.test(message.name)) || /Invalid `prisma\.|PrismaClient\w*Error|prisma\.\w+\.\w+\(\)/.test(raw)) {
    const code = message && typeof message === 'object' && 'code' in message ? ` ${String((message as { code?: unknown }).code)}` : '';
    return `Database query failed${code}`.slice(0, max);
  }
  const cleaned = redactSecrets(raw)
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, (m) => (m.replace(/\D/g, '').length >= 10 ? '[phone]' : m));
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/**
 * Deep copy of `value` with secret keys replaced and every string passed through redactSecrets.
 * Depth and size are bounded so a large object cannot bloat a log row.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSecrets(value).slice(0, 2000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactValue(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[k] = isSecretKey(k) ? REDACTED : redactValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

// ─── Patient identifier masking (vendor-support downloads) ─────────────────────

/** XML elements whose text identifies a person (DrFirst patient / provider demographics). */
const PATIENT_TAG_RE =
  /<((?:[\w-]+:)?(?:FirstName|LastName|MiddleName|Name|Suffix|Prefix|DOB|DateOfBirth|BirthDate|Birthdate|Address\d?|AddressLine\d?|Street\d?|City|Zip|ZipCode|PostalCode|HomePhone|WorkPhone|CellPhone|MobilePhone|Phone|Fax|Email|EmailAddress|SSN|MRN|MedicalRecordNumber|MothersMaidenName))(\s[^>]*)?>([^<]+)<\/\1>/gi;

export const MASK = '[masked]';

/**
 * Masks patient identifiers for text that leaves the practice (vendor support): XML name / DOB /
 * address / phone / email elements, plus any email address, phone number, SSN or card number.
 * Vendor ids (RcopiaID, ExternalID) and codes stay so the vendor can trace the call.
 */
export function maskPatientIdentifiers(text: string): string {
  if (!text) return text;
  return redactSecrets(text)
    .replace(PATIENT_TAG_RE, (_m, tag: string, attrs: string | undefined) => `<${tag}${attrs ?? ''}>${MASK}</${tag}>`)
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, (m) => (m.replace(/\D/g, '').length >= 10 ? '[phone]' : m));
}

/** Indents XML for reading (one element per line). Leaves non-XML text unchanged. */
export function prettyPrintXml(xml: string): string {
  const src = xml.trim();
  if (!src.startsWith('<')) return xml;
  const tokens = src.replace(/>\s+</g, '><').split(/(?=<)|(?<=>)/g).filter((t) => t.length > 0);
  const lines: string[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      lines.push(`${'  '.repeat(depth)}${t}`);
    } else if (t.startsWith('<?') || t.startsWith('<!') || t.endsWith('/>')) {
      lines.push(`${'  '.repeat(depth)}${t}`);
    } else if (t.startsWith('<')) {
      // <Tag>text</Tag> on one line
      const text = tokens[i + 1];
      const close = tokens[i + 2];
      if (text !== undefined && !text.startsWith('<') && close?.startsWith('</')) {
        lines.push(`${'  '.repeat(depth)}${t}${text}${close}`);
        i += 2;
      } else {
        lines.push(`${'  '.repeat(depth)}${t}`);
        depth++;
      }
    } else {
      lines.push(`${'  '.repeat(depth)}${t}`);
    }
  }
  return lines.join('\n');
}
