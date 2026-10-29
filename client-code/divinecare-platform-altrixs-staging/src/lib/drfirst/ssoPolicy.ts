import { canPrescribe } from '@/types/roles';

/**
 * Who may open Rcopia, and in what context. Pure (no database): unit-tested in
 * tests/clinical-route-hardening.test.ts.
 *
 * - Prescribers (canPrescribe): their OWN User.rcopiaUsername, any startup screen, with a patient on
 *   their caseload (drFirstClientWhere; the verified Medical Director is org-wide through
 *   clientAccessWhere) that passes the 42 CFR Part 2 / sensitive-record lock.
 * - ADMIN (not a prescriber): only with their OWN rcopiaUsername on file, and only the message and
 *   report screens (Limited Multi Patient Mode, no patient context). An ADMIN never opens a chart in
 *   Rcopia and never registers a patient.
 *   Future work: a dedicated "DrFirst staff user type" (non-prescriber Rcopia staff login, e.g. for
 *   office managers handling renewals) instead of reusing ADMIN.
 * - Everyone else: refused.
 */
export const DRFIRST_ADMIN_SCREENS = ['message', 'report'] as const;

export type DrFirstSsoDecision =
  | { ok: true; patientContextAllowed: boolean }
  | { ok: false; status: 403 | 409; error: string };

export function drFirstSsoDecision(input: {
  role: string | null | undefined;
  rcopiaUsername: string | null | undefined;
  screen: string;
  hasPatient: boolean;
}): DrFirstSsoDecision {
  const role = String(input.role ?? '').toUpperCase();
  const prescriber = canPrescribe(role);
  const admin = role === 'ADMIN';
  if (!prescriber && !admin) {
    return { ok: false, status: 403, error: 'Only prescribers can open e-prescribing.' };
  }
  if (!input.rcopiaUsername?.trim()) {
    return {
      ok: false,
      status: 409,
      error: 'Your DrFirst username is not set on your staff profile. Ask an administrator to add it.',
    };
  }
  if (prescriber) return { ok: true, patientContextAllowed: true };
  if (input.hasPatient || !(DRFIRST_ADMIN_SCREENS as readonly string[]).includes(input.screen)) {
    return {
      ok: false,
      status: 403,
      error: 'Administrators can open DrFirst messages and reports only. Opening a patient in DrFirst is for prescribers.',
    };
  }
  return { ok: true, patientContextAllowed: false };
}

/**
 * requireDrFirstCaller's username rule. With requireRcopiaUser, prescribers AND admins need their own
 * rcopiaUsername; the one exception is `adminPracticeLevel` (badge counts: practice totals, no
 * patient data), where an ADMIN without a username is let through.
 */
export function drFirstCallerNeedsUsername(input: {
  isPrescriber: boolean;
  isAdmin: boolean;
  requireRcopiaUser?: boolean;
  adminPracticeLevel?: boolean;
}): boolean {
  if (!input.requireRcopiaUser) return false;
  if (input.isPrescriber) return true;
  return input.isAdmin && !input.adminPracticeLevel;
}
