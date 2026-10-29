import type { Prisma } from '@prisma/client';

/**
 * Voicemail inbox scope. Pure (no database).
 *
 * Voicemail.routeTo is a free VARCHAR(100) with no foreign key (prisma/schema.prisma, migration
 * 20261015_oct10_14_pillars.sql); the triage writer stores either a staff user id or a role name.
 * Matching is exact: routeTo equals the viewer's user id, or equals the viewer's role (role names
 * compared case-insensitively, e.g. "FRONT_DESK" / "front_desk"). Never a substring match, so a
 * routeTo of "THERAPIST_TEAM" or a name fragment does not leak to anyone.
 *
 * - Leadership (ADMIN, DIRECTOR, PRACTICE_DIRECTOR) and OFFICE_MANAGER: the full list, and may
 *   re-route (change routeTo).
 * - Everyone else with communications access: only voicemails routed to them; they may mark one of
 *   those as handled (isRouted) but not re-route it.
 */
const VOICEMAIL_MANAGER_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER'];

export function canManageVoicemails(role: string | null | undefined): boolean {
  return VOICEMAIL_MANAGER_ROLES.includes(String(role ?? '').toUpperCase());
}

export function voicemailWhere(role: string | null | undefined, userId: string): Prisma.VoicemailWhereInput {
  if (canManageVoicemails(role)) return {};
  const r = String(role ?? '').trim();
  return {
    OR: [
      { routeTo: { equals: userId } },
      ...(r ? [{ routeTo: { equals: r, mode: 'insensitive' as const } }] : []),
    ],
  };
}

/** Same rule as voicemailWhere, for one row already loaded (PATCH). */
export function voicemailRoutedTo(routeTo: string | null | undefined, role: string | null | undefined, userId: string): boolean {
  if (canManageVoicemails(role)) return true;
  const target = String(routeTo ?? '').trim();
  if (!target) return false;
  if (target === userId) return true;
  const r = String(role ?? '').trim();
  return Boolean(r) && target.toUpperCase() === r.toUpperCase();
}
