import type { UserStatus } from '@prisma/client';

/**
 * Staff statuses that can be booked as the clinician on an appointment. An invited clinician
 * (account created, invite not yet accepted, e.g. providers imported from Valant) is a real
 * provider and can be scheduled; they just can't sign in until they accept the invite.
 * Deactivated staff are never bookable.
 */
export const SCHEDULABLE_STAFF_STATUSES: UserStatus[] = ['ACTIVE', 'INVITED'];
