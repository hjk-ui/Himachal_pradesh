/**
 * Imported appointment history (Appointment.source, 20261025_valant_appointment_history.sql).
 * Pure: no prisma client, safe for tests.
 *
 * Valant visits imported by scripts/import-valant-appointment-history.ts are real past visits: they
 * count for "Last seen", session cadence and care-team links. Their notes, charges and copays live in
 * Valant, so work queues that ask "what still needs a note / a charge" must leave them out.
 */
import type { Prisma } from '@prisma/client';

export const VALANT_HISTORY_SOURCE = 'valant_history';

/**
 * Where-fragment: appointments booked in Altrixs (not imported history). `source` is nullable and
 * `{ not: x }` alone drops NULL rows, hence the OR. Spread it only where the where object has no OR
 * of its own (otherwise put it in an AND entry).
 */
export const NOT_IMPORTED_HISTORY = {
  OR: [{ source: null }, { source: { not: VALANT_HISTORY_SOURCE } }],
} satisfies Prisma.AppointmentWhereInput;
