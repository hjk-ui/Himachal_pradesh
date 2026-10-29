import type { Role } from '@prisma/client';

/**
 * Roles that may open protected (42 CFR Part 2) records and their access logs. No database access: safe in the browser.
 *
 * Medical Director (src/lib/auth/medicalDirector.ts) is deliberately NOT here. 42 CFR 2.12(c)(3)
 * lets Part 2 information move without consent only between personnel "having a need for the
 * information in connection with their duties that arise out of the provision of diagnosis,
 * treatment, or referral for treatment", within the Part 2 program (or with an entity having direct
 * administrative control over it). That is a per-person, per-patient need-to-know test, not a title:
 * a medical director with oversight duties for a patient can qualify, but a blanket bypass of every
 * protected record in the organization would not meet it. This codebase has no program-wide
 * "Part 2 program staff" role; the need-to-know designation is the record's SensitiveRecord
 * accessWhitelist (set by the Practice Director / privacy officer), otherwise break-the-glass
 * (42 CFR 2.51 medical emergency, reason required, time-limited, logged). A medical director follows
 * the same rules as any clinician; every access lands in SensitiveAccessLog.
 */
export function isSensitivePrivilegedRole(role: Role | string | null | undefined): boolean {
  return role === 'ADMIN' || role === 'PRACTICE_DIRECTOR';
}
