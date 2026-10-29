import { prisma } from '@/lib/db/prisma';

/**
 * Waitlist suggestions for a freed slot (cancel / late cancel). SUGGESTION ONLY: nothing is booked,
 * offered, or sent to anyone; staff decide and contact the person themselves.
 *
 * Match: WAITING entries of the same organization where
 *   - the entry asked for the same clinician, or
 *   - the entry has no clinician preference and its specialty matches the visit's service
 * Order: CRISIS, URGENT, ROUTINE, then longest waiting. Fields: what front desk needs to call.
 */

const URGENCY_RANK: Record<string, number> = { CRISIS: 0, URGENT: 1, ROUTINE: 2 };

export type WaitlistSuggestion = {
  entryId: string;
  name: string;
  urgency: string;
  specialty: string;
  match: 'same_clinician' | 'same_service';
  waitingSince: string;
  /** The cancelled appointment this would fill */
  appointmentId: string;
  slotStartsAt: string;
};

export function normalizeService(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

/** Loose service match: "Individual Therapy" ~ "therapy", "Psychiatric Evaluation" ~ "psychiatry". */
export function serviceMatches(specialty: string | null | undefined, visitType: string | null | undefined): boolean {
  const a = normalizeService(specialty);
  const b = normalizeService(visitType);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const stem = (w: string) => w.replace(/(ic|ical|ist|ists|y|ies|ion|ions|al)$/, '').slice(0, 7);
  const wordsA = new Set(a.split(' ').filter((w) => w.length > 3).map(stem));
  return b.split(' ').filter((w) => w.length > 3).map(stem).some((w) => wordsA.has(w));
}

type Entry = { id: string; name: string; urgency: string; specialty: string; clinicianId: string | null; createdAt: Date };
type Slot = { id: string; clinicianId: string | null; type: string; startsAt: Date };

export function rankWaitlist(entries: Entry[], slot: Slot, limit = 5): WaitlistSuggestion[] {
  return entries
    .map((e) => {
      const match: WaitlistSuggestion['match'] | null =
        slot.clinicianId && e.clinicianId === slot.clinicianId
          ? 'same_clinician'
          : !e.clinicianId && serviceMatches(e.specialty, slot.type)
            ? 'same_service'
            : null;
      return match ? { e, match } : null;
    })
    .filter((x): x is { e: Entry; match: WaitlistSuggestion['match'] } => Boolean(x))
    .sort(
      (x, y) =>
        (URGENCY_RANK[x.e.urgency] ?? 9) - (URGENCY_RANK[y.e.urgency] ?? 9) ||
        (x.match === y.match ? 0 : x.match === 'same_clinician' ? -1 : 1) ||
        x.e.createdAt.getTime() - y.e.createdAt.getTime()
    )
    .slice(0, limit)
    .map(({ e, match }) => ({
      entryId: e.id,
      name: e.name,
      urgency: e.urgency,
      specialty: e.specialty,
      match,
      waitingSince: e.createdAt.toISOString(),
      appointmentId: slot.id,
      slotStartsAt: slot.startsAt.toISOString(),
    }));
}

/** Suggestions for freshly cancelled appointments that are still in the future. */
export async function suggestWaitlistForCancelled(organizationId: string, appointmentIds: string[], limit = 5): Promise<WaitlistSuggestion[]> {
  if (!appointmentIds.length) return [];
  const slots = await prisma.appointment.findMany({
    where: { id: { in: appointmentIds }, organizationId, startsAt: { gt: new Date() } },
    select: { id: true, clinicianId: true, type: true, startsAt: true },
  });
  if (!slots.length) return [];
  const entries = await prisma.waitlistEntry.findMany({
    where: { organizationId, status: 'WAITING' },
    select: { id: true, name: true, urgency: true, specialty: true, clinicianId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 300,
  });
  const out: WaitlistSuggestion[] = [];
  for (const slot of slots) out.push(...rankWaitlist(entries, slot, limit));
  return out;
}
