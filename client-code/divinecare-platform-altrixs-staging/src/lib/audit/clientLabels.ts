import { prisma } from '@/lib/db/prisma';
import { resolveSensitiveAccessMap } from '@/lib/privacy/sensitiveAccess';

/** protected = sensitive / Part 2 record; locked = protected and this viewer may not open it */
export type ClientLabel = { label: string; mrn: string | null; protected: boolean; locked: boolean };

/**
 * Display labels for patient ids found in audit rows: org-scoped; protected (sensitive /
 * Part 2) clients the viewer may not open show their alias only, never the name or MRN.
 * Ids from another org or deleted clients are simply absent from the map.
 */
export async function clientLabelMap(input: {
  organizationId: string;
  userId: string;
  role: string;
  clientIds: (string | null | undefined)[];
}): Promise<Map<string, ClientLabel>> {
  const ids = [...new Set(input.clientIds.filter((v): v is string => !!v))];
  const out = new Map<string, ClientLabel>();
  if (!ids.length) return out;
  const [clients, sensitive] = await Promise.all([
    prisma.client.findMany({
      where: { id: { in: ids }, organizationId: input.organizationId },
      select: { id: true, name: true, mrn: true },
    }),
    resolveSensitiveAccessMap({
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
      clientIds: ids,
    }),
  ]);
  for (const c of clients) {
    const s = sensitive.get(c.id);
    if (s && !s.canAccessSensitive) {
      out.set(c.id, { label: s.alias || 'Protected client', mrn: null, protected: true, locked: true });
    } else {
      out.set(c.id, { label: c.name, mrn: c.mrn ?? null, protected: !!s, locked: false });
    }
  }
  return out;
}

/** Org-scoped staff names for actor ids. */
export async function staffNameMap(organizationId: string, userIds: (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(userIds.filter((v): v is string => !!v))];
  if (!ids.length) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.name || u.email || null]));
}
