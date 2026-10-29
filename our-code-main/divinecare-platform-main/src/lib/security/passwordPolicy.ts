/**
 * Staff password policy (Oct 24). Single source of truth for register, first-admin
 * setup, and password reset. Pure — safe to import from client components.
 */

export const STAFF_PASSWORD_MIN_LENGTH = 12;
export const STAFF_PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_ERRORS = {
  tooShort: `Password must be at least ${STAFF_PASSWORD_MIN_LENGTH} characters.`,
  tooLong: `Password must be ${STAFF_PASSWORD_MAX_LENGTH} characters or fewer.`,
  common: 'That password is too common. Choose something harder to guess.',
  personal: 'Password must not contain your name or email address.',
  repetitive: 'Password must not be repetitive or a simple sequence.',
} as const;

const COMMON_PASSWORDS = [
  'password',
  'passw0rd',
  'p@ssw0rd',
  'password1',
  'password123',
  'qwerty',
  'qwertyuiop',
  'letmein',
  'welcome',
  'admin',
  'administrator',
  'iloveyou',
  'monkey',
  'dragon',
  'abc123',
  'changeme',
  'trustno1',
  'football',
  'baseball',
  'master',
  'login',
  'altrixs',
  'divinecare',
  'clinic',
  'therapy',
  'doctor',
];

const SEQUENCES = [
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
  'qwertyuiopasdfghjklzxcvbnm',
];

export type PasswordContext = {
  name?: string | null;
  email?: string | null;
};

/** `error?: undefined` keeps `.error` readable without narrowing (repo runs strict: false). */
export type PasswordCheck = { ok: true; error?: undefined } | { ok: false; error: string };

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Normalize leetspeak so "P@ssw0rd" matches "password". */
function deLeet(value: string) {
  return value
    .toLowerCase()
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/0/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/[^a-z0-9]/g, '');
}

function isCommon(password: string) {
  const plain = normalize(password);
  const leet = deLeet(password);
  return COMMON_PASSWORDS.some((word) => {
    const w = normalize(word);
    // Reject when the password is essentially the common word plus a short suffix/prefix.
    return (plain.includes(w) || leet.includes(w)) && plain.length <= w.length + 6;
  });
}

function containsPersonal(password: string, ctx: PasswordContext) {
  const plain = normalize(password);
  const tokens = new Set<string>();
  const local = (ctx.email || '').split('@')[0] || '';
  if (normalize(local).length >= 4) tokens.add(normalize(local));
  for (const part of (ctx.name || '').split(/\s+/)) {
    const n = normalize(part);
    if (n.length >= 4) tokens.add(n);
  }
  for (const token of tokens) {
    if (plain.includes(token)) return true;
  }
  return false;
}

function isRepetitive(password: string) {
  const plain = password.toLowerCase();
  if (/^(.{1,3})\1+$/.test(plain)) return true; // "abababababab"
  if (/(.)\1{4,}/.test(plain)) return true; // 5+ of one character in a row
  if (new Set(plain).size <= 3) return true;
  for (const seq of SEQUENCES) {
    const reversed = [...seq].reverse().join('');
    for (let i = 0; i + 6 <= seq.length; i += 1) {
      const run = seq.slice(i, i + 6);
      const back = reversed.slice(i, i + 6);
      if (plain.includes(run) || plain.includes(back)) return true;
    }
  }
  return false;
}

export function validateStaffPassword(
  password: string,
  context: PasswordContext = {}
): PasswordCheck {
  if (typeof password !== 'string' || password.length < STAFF_PASSWORD_MIN_LENGTH) {
    return { ok: false, error: PASSWORD_ERRORS.tooShort };
  }
  if (password.length > STAFF_PASSWORD_MAX_LENGTH) {
    return { ok: false, error: PASSWORD_ERRORS.tooLong };
  }
  if (containsPersonal(password, context)) {
    return { ok: false, error: PASSWORD_ERRORS.personal };
  }
  if (isCommon(password)) {
    return { ok: false, error: PASSWORD_ERRORS.common };
  }
  if (isRepetitive(password)) {
    return { ok: false, error: PASSWORD_ERRORS.repetitive };
  }
  return { ok: true };
}
