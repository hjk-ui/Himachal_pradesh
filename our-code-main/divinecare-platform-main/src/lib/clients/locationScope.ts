import type { Role } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export function isPrimaryCareRole(role: Role | string | null | undefined) {
  return role === 'PHYSICIAN' || role === 'MEDICAL_NP' || role === 'MEDICAL_ASSISTANT';
}

/** Locations this staff member actually works. Silver Spring and Bowie stay separate. */
export async function staffLocationIds(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      primaryLocationId: true,
      locations: { select: { locationId: true } },
    },
  });
  const ids = new Set<string>();
  if (user?.primaryLocationId) ids.add(user.primaryLocationId);
  for (const row of user?.locations ?? []) ids.add(row.locationId);
  return [...ids];
}

export async function limitPrimaryCareToOwnLocations(
  where: Prisma.ClientWhereInput,
  actor: { id: string; role: Role }
): Promise<Prisma.ClientWhereInput> {
  if (!isPrimaryCareRole(actor.role)) return where;
  const locationIds = await staffLocationIds(actor.id);
  return {
    AND: [
      where,
      locationIds.length ? { locationId: { in: locationIds } } : { id: '__no_location__' },
    ],
  };
}
