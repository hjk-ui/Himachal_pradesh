import { prisma } from '@/lib/db/prisma';
import { DEFAULT_PRACTICE_TIME_ZONE, resolvePracticeTimeZone } from '@/lib/time/practiceTime';

/**
 * The org's practice time zone: PracticeSettings.timeZone, else America/New_York.
 * PracticeSettings arrives with 20261018_practice_settings.sql; before that migration (or for an
 * org with no settings row) the default applies. Cached per process for a minute.
 */
const cache = new Map<string, { tz: string; at: number }>();
const TTL_MS = 60_000;

export async function getPracticeTimeZone(organizationId: string | null | undefined): Promise<string> {
  if (!organizationId) return DEFAULT_PRACTICE_TIME_ZONE;
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tz;
  let tz = DEFAULT_PRACTICE_TIME_ZONE;
  try {
    const row = await prisma.practiceSettings.findUnique({
      where: { organizationId },
      select: { timeZone: true },
    });
    tz = resolvePracticeTimeZone(row?.timeZone);
  } catch {
    tz = DEFAULT_PRACTICE_TIME_ZONE; // table not migrated yet
  }
  cache.set(organizationId, { tz, at: Date.now() });
  return tz;
}
