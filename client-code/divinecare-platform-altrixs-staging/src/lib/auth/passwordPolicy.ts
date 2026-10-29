/**
 * Staff password policy (server): 12-128 characters, not one of the top 10,000 common passwords
 * (bundled list, no network), not a common password with digits / symbols added, not containing
 * the user's email or name, and not a single repeated character pattern.
 *
 * Applies when a password is SET (first admin, self-serve registration, invite accept, admin create,
 * reset, change). Existing passwords keep working; the rule applies at the next change.
 * Patient portal passwords are separate (src/patient) and unchanged.
 */
import { z } from 'zod';
import { COMMON_PASSWORDS_TEXT } from './data/commonPasswords';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_TOO_LONG, PASSWORD_TOO_SHORT } from './passwordRules';

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './passwordRules';

let commonSet: Set<string> | null = null;
function common(): Set<string> {
  return (commonSet ??= new Set(COMMON_PASSWORDS_TEXT.split('\n')));
}

export const PASSWORD_COMMON = 'That password is too common. Choose a less predictable password (a short phrase works well).';
export const PASSWORD_PERSONAL = 'Password must not contain your name or email address.';
export const PASSWORD_REPETITIVE = 'Password is too repetitive. Use more different characters.';

export type PasswordContext = { email?: string | null; name?: string | null };

/** True when the password is on the bundled common list, or is a listed password with digits / symbols around it. */
export function isCommonPassword(password: string): boolean {
  const lower = password.toLowerCase();
  const set = common();
  if (set.has(lower)) return true;
  const core = lower.replace(/^[\d\W_]+/, '').replace(/[\d\W_]+$/, '');
  return core.length >= 4 && core !== lower && set.has(core);
}

function personalTokens(ctx: PasswordContext): string[] {
  const out = new Set<string>();
  const email = (ctx.email || '').trim().toLowerCase();
  if (email) {
    out.add(email);
    const local = email.split('@')[0] || '';
    if (local.length >= 3) out.add(local);
    for (const part of local.split(/[._+-]+/)) if (part.length >= 3) out.add(part);
  }
  for (const part of (ctx.name || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length >= 3) out.add(part);
  }
  return [...out];
}

/** null when the password is acceptable, else the message to show. */
export function checkStaffPassword(password: string, ctx: PasswordContext = {}): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) return PASSWORD_TOO_SHORT;
  if (password.length > PASSWORD_MAX_LENGTH) return PASSWORD_TOO_LONG;
  if (new Set(password.toLowerCase()).size < 4) return PASSWORD_REPETITIVE;
  if (isCommonPassword(password)) return PASSWORD_COMMON;
  const lower = password.toLowerCase();
  if (personalTokens(ctx).some((t) => lower.includes(t))) return PASSWORD_PERSONAL;
  return null;
}

/** zod field for a new staff password (length only; call checkStaffPassword with the user context too). */
export const newStaffPasswordField = z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT).max(PASSWORD_MAX_LENGTH, PASSWORD_TOO_LONG);

export class PasswordPolicyError extends Error {
  readonly status = 400;
}

/** Throws PasswordPolicyError (message safe to show) when the password breaks the policy. */
export function assertStaffPassword(password: string, ctx: PasswordContext = {}): void {
  const err = checkStaffPassword(password, ctx);
  if (err) throw new PasswordPolicyError(err);
}
