import 'server-only';

/**
 * Compatibility layer for older call sites (clients, bulk transfer, modules API).
 * Plans, prices and features live in src/lib/billing/plans.ts; access rules in
 * src/lib/billing/entitlements.ts. Tiers have no active-client limits (pricing is per clinician),
 * so the only restriction here is read-only mode and per-feature gates.
 */
import { prisma } from '@/lib/db/prisma';
import { getModuleData } from '@/lib/modules/manage';
import { requireFeatureWrite, requireWritable } from '@/lib/billing/entitlementsServer';
import type { FeatureId } from '@/lib/billing/plans';

export async function getSubscriptionUsage(organizationId: string) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [activeClients, notesThisMonth, aiNotesThisMonth, staffCount] = await Promise.all([
    prisma.client.count({
      where: {
        status: 'ACTIVE',
        OR: [{ location: { organizationId } }, { assignedTo: { organizationId } }],
      },
    }),
    prisma.progressNote.count({
      where: { createdAt: { gte: monthStart }, clinician: { organizationId } },
    }),
    getModuleData<unknown[]>(organizationId, 'ai-session-history').then(
      (items) =>
        (Array.isArray(items) ? items : []).filter((item) => {
          const rec = item as { generatedAt?: string; createdAt?: string } | null;
          const stamp = rec?.generatedAt || rec?.createdAt;
          if (!stamp) return false;
          const date = new Date(stamp);
          return !Number.isNaN(date.getTime()) && date >= monthStart;
        }).length
    ),
    prisma.user.count({ where: { organizationId, role: { not: 'SUPER_ADMIN' }, status: 'ACTIVE' } }),
  ]);

  return { activeClients, notesThisMonth, aiNotesThisMonth, staffCount };
}

/** Kept for the clients API: no client-count limits; blocked only when the account is read-only. */
export async function assertActiveClientLimit(organizationId: string) {
  const gate = await requireWritable(organizationId);
  return gate.ok === false ? { ok: false as const, error: gate.error } : { ok: true as const };
}

/** Module collections that belong to a tier-gated feature. Everything else only needs write access. */
const MODULE_FEATURES: { test: (m: string) => boolean; feature: FeatureId }[] = [
  { test: (m) => m === 'ai-session-notes' || m === 'ai-session-history', feature: 'ai_scribe' },
];

export async function canUsePlanModule(organizationId: string, module: string) {
  const mapped = MODULE_FEATURES.find((x) => x.test(module));
  const gate = mapped ? await requireFeatureWrite(organizationId, mapped.feature) : await requireWritable(organizationId);
  return gate.ok === false ? { ok: false as const, error: gate.error } : { ok: true as const };
}
