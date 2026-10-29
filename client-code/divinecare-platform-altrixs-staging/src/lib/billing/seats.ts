/**
 * Seat counting (pure). The plain-language version is SEAT_RULE in plans.ts; the role lists are
 * SEAT_TYPES[...].roles there.
 *
 *  - PSYCHIATRIST / NP / PHYSICIAN / MEDICAL_NP                                  -> prescriber
 *  - THERAPIST / CLINICIAN                                                        -> clinician
 *  - PRP_SPECIALIST / CASE_MANAGER / PEER_SUPPORT / MEDICAL_ASSISTANT / CRISIS_RESPONDER -> paraprofessional
 *  - ADMIN / PRACTICE_DIRECTOR / DIRECTOR / OFFICE_MANAGER / FRONT_DESK / BILLING / HR -> support (free)
 *  - SUPER_ADMIN (Altrixs platform staff) is not counted at all.
 *  - Only ACTIVE accounts count (invited and deactivated do not).
 *  - A user with several roles is counted once, at their highest-cost seat type.
 *  - Unknown roles count as free support accounts and are reported in `unmapped`.
 */
import {
  NON_COUNTED_ROLES,
  SEAT_TYPES,
  SEAT_TYPE_ORDER,
  emptySeats,
  providerSeatsOf,
  type SeatQuantities,
  type SeatType,
} from './plans';

export type SeatUser = {
  role: string | null | undefined;
  roles?: (string | null | undefined)[] | null;
  status: string | null | undefined;
};

export type SeatCount = {
  /** Paid seats by type (the Stripe quantities). */
  byType: SeatQuantities;
  /** Free support accounts. */
  support: number;
  /** Prescribers + clinicians. */
  providers: number;
  /** All paid seats (prescriber + clinician + paraprofessional). */
  seats: number;
  /** Active users whose roles matched no seat type (counted as support). */
  unmapped: number;
  // Older field names kept for existing screens.
  /** Prescribers + clinicians (licensed providers). */
  licensed: number;
  /** Paraprofessional / program staff. */
  program: number;
  prescribers: number;
  /** Active users that never cost anything (support). */
  free: number;
};

function rolesOf(user: Pick<SeatUser, 'role' | 'roles'>): string[] {
  const all = [user.role, ...(user.roles || [])]
    .filter((r): r is string => typeof r === 'string' && r.length > 0)
    .map((r) => r.toUpperCase());
  return [...new Set(all)];
}

/** Highest-cost seat type among a user's roles, or null for accounts that are never counted. */
export function seatTypeForUser(user: Pick<SeatUser, 'role' | 'roles'>): SeatType | null {
  const roles = rolesOf(user);
  if (roles.some((r) => NON_COUNTED_ROLES.includes(r))) return null;
  for (const type of SEAT_TYPE_ORDER) {
    if (roles.some((r) => SEAT_TYPES[type].roles.includes(r))) return type;
  }
  return 'support';
}

function isMapped(user: SeatUser): boolean {
  return rolesOf(user).some((r) => SEAT_TYPE_ORDER.some((t) => SEAT_TYPES[t].roles.includes(r)));
}

export function countSeats(users: SeatUser[]): SeatCount {
  const byType = emptySeats();
  let support = 0;
  let unmapped = 0;
  for (const user of users) {
    if ((user.status || '').toUpperCase() !== 'ACTIVE') continue;
    const type = seatTypeForUser(user);
    if (type === null) continue;
    if (type === 'support') {
      support += 1;
      if (!isMapped(user)) unmapped += 1;
    } else {
      byType[type] += 1;
    }
  }
  const providers = providerSeatsOf(byType);
  return {
    byType,
    support,
    providers,
    seats: providers + byType.paraprofessional,
    unmapped,
    licensed: providers,
    program: byType.paraprofessional,
    prescribers: byType.prescriber,
    free: support,
  };
}
