import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import type { DrFirstCaller } from './access';

/**
 * Prescriber badge counts from the tables the 15-minute DrFirst cron sync writes (counts only, no
 * rows): pending refills routed to the provider who owns them in Rcopia, and prescriptions still
 * pending signature by the prescriber's NPI. ADMIN: organization totals.
 */
export async function syncedBadgeCounts(c: DrFirstCaller): Promise<{ refill: number; pending_prescription: number }> {
  const org = clientOrgFilter(c.organizationId);
  const mine = c.isPrescriber;
  const [refill, pending] = await Promise.all([
    mine && !c.rcopiaUsername
      ? Promise.resolve(0)
      : prisma.rcopiaRefillNotification.count({
          where: {
            actionTaken: 'pending',
            client: org,
            ...(mine ? { providerUsername: { equals: c.rcopiaUsername as string, mode: 'insensitive' as const } } : {}),
          },
        }),
    mine && !c.npi
      ? Promise.resolve(0)
      : prisma.rcopiaPrescription.count({
          where: { lifecycleStatus: 'pending', client: org, ...(mine ? { providerNpi: c.npi as string } : {}) },
        }),
  ]);
  return { refill, pending_prescription: pending };
}
