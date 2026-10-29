import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export class SensitiveRecordAccessError extends Error {
  readonly status = 403 as const;
  readonly body = {
    error: 'SENSITIVE_RECORD' as const,
    canRequestBreakGlass: true as const,
  };

  constructor(message = 'Sensitive record — break-glass required') {
    super(message);
    this.name = 'SensitiveRecordAccessError';
  }
}

import { isSensitivePrivilegedRole } from '@/lib/privacy/sensitiveRoles';
export { isSensitivePrivilegedRole };

async function logAccess(input: {
  organizationId: string;
  clientId: string;
  userId: string;
  accessType: 'whitelist' | 'break_the_glass' | 'admin_bypass' | 'denied';
  path?: string;
  reason?: string;
}) {
  try {
    await prisma.sensitiveAccessLog.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        userId: input.userId,
        accessType: input.accessType,
        path: input.path ?? null,
        reason: input.reason ?? null,
      },
    });
  } catch (err) {
    console.error('[sensitiveAccess] log failed', err);
  }
}

/**
 * Gate PHI detail access for a protected client.
 * No SensitiveRecord → allow (normal client).
 * Otherwise: PD/ADMIN bypass, whitelist, or valid BTG grant; else 403.
 */
export async function assertClientPhiAccess(input: {
  organizationId: string;
  userId: string;
  role: Role | string;
  clientId: string;
  path?: string;
}): Promise<void> {
  const record = await prisma.sensitiveRecord.findFirst({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
    },
    select: { id: true, accessWhitelist: true },
  });

  if (!record) return;

  if (isSensitivePrivilegedRole(input.role)) {
    await logAccess({
      organizationId: input.organizationId,
      clientId: input.clientId,
      userId: input.userId,
      accessType: 'admin_bypass',
      path: input.path,
    });
    return;
  }

  if (record.accessWhitelist.includes(input.userId)) {
    await logAccess({
      organizationId: input.organizationId,
      clientId: input.clientId,
      userId: input.userId,
      accessType: 'whitelist',
      path: input.path,
    });
    return;
  }

  const now = new Date();
  const grant = await prisma.breakTheGlassGrant.findFirst({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      userId: input.userId,
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: 'desc' },
  });

  if (grant) {
    await logAccess({
      organizationId: input.organizationId,
      clientId: input.clientId,
      userId: input.userId,
      accessType: 'break_the_glass',
      path: input.path,
      reason: grant.reason,
    });
    return;
  }

  await logAccess({
    organizationId: input.organizationId,
    clientId: input.clientId,
    userId: input.userId,
    accessType: 'denied',
    path: input.path,
  });

  throw new SensitiveRecordAccessError();
}

/** Non-logging access check for roster / list metadata. */
export async function resolveSensitiveAccessMap(input: {
  organizationId: string;
  userId: string;
  role: Role | string;
  clientIds: string[];
}): Promise<
  Map<
    string,
    {
      isSensitive: true;
      sensitiveReason: string;
      alias: string | null;
      canAccessSensitive: boolean;
    }
  >
> {
  const map = new Map<
    string,
    {
      isSensitive: true;
      sensitiveReason: string;
      alias: string | null;
      canAccessSensitive: boolean;
    }
  >();

  if (!input.clientIds.length) return map;

  const records = await prisma.sensitiveRecord.findMany({
    where: {
      organizationId: input.organizationId,
      clientId: { in: input.clientIds },
    },
    select: {
      clientId: true,
      reason: true,
      alias: true,
      accessWhitelist: true,
    },
  });

  if (!records.length) return map;

  const privileged = isSensitivePrivilegedRole(input.role);
  const now = new Date();
  const grants = privileged
    ? []
    : await prisma.breakTheGlassGrant.findMany({
        where: {
          organizationId: input.organizationId,
          userId: input.userId,
          clientId: { in: records.map((r) => r.clientId) },
          expiresAt: { gt: now },
        },
        select: { clientId: true },
      });
  const grantSet = new Set(grants.map((g) => g.clientId));

  for (const r of records) {
    const canAccess =
      privileged ||
      r.accessWhitelist.includes(input.userId) ||
      grantSet.has(r.clientId);
    map.set(r.clientId, {
      isSensitive: true,
      sensitiveReason: r.reason,
      alias: r.alias,
      canAccessSensitive: canAccess,
    });
  }

  return map;
}

/**
 * Client ids (from `clientIds`) that are flagged sensitive and that this actor
 * may NOT open (no PD/ADMIN bypass, not whitelisted, no live break-glass grant).
 * Use to drop rows from list endpoints that carry Part 2 / protected content.
 * Throws on lookup failure so callers fail closed.
 */
export async function lockedSensitiveClientIds(input: {
  organizationId: string;
  userId: string;
  role: Role | string;
  clientIds: string[];
}): Promise<Set<string>> {
  const map = await resolveSensitiveAccessMap({
    ...input,
    clientIds: [...new Set(input.clientIds.filter(Boolean))],
  });
  const locked = new Set<string>();
  for (const [clientId, info] of map) {
    if (!info.canAccessSensitive) locked.add(clientId);
  }
  return locked;
}
