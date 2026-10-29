import 'server-only';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import type { DrFirstContext } from './access';
import type { DrFirstExchangeAuditSink } from './types';
import { encryptDrFirstAuditEvent } from './audit-crypto';

export function createDrFirstExchangeAuditSink(
  context: DrFirstContext,
  encryptionKey: string | undefined,
  retentionDays: number,
): DrFirstExchangeAuditSink {
  return async event => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + retentionDays * 86_400_000);
    const encrypted = encryptDrFirstAuditEvent(event, encryptionKey || '');
    await prisma.$transaction([
      prisma.clinicModuleState.deleteMany({
        where: {
          organizationId: context.organizationId,
          module: { startsWith: 'drfirst:exchange:' },
          updatedAt: { lt: new Date(now.getTime() - retentionDays * 86_400_000) },
        },
      }),
      prisma.clinicModuleState.create({
        data: {
          organizationId: context.organizationId,
          module: `drfirst:exchange:${randomUUID()}`,
          data: { ...encrypted, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() },
        },
      }),
    ]);
  };
}
