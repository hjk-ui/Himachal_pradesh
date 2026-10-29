import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { actionLabel, describeResource, outcomeLabel } from '@/lib/audit/auditLabels';
import { csvRow } from '@/lib/audit/csv';

/** Hard cap on rows in one CSV export of the audit trail. */
export const AUDIT_EXPORT_MAX_ROWS = 50_000;
export const AUDIT_EXPORT_BATCH = 1_000;

export const AUDIT_CSV_HEADER = [
  'Timestamp (UTC)',
  'User',
  'User ID',
  'Role',
  'Action',
  'Action code',
  'Resource',
  'Resource type',
  'Resource ID',
  'Patient ID',
  'Patient MRN',
  'Outcome',
  'IP address',
];

/**
 * Streams the filtered audit trail as CSV, newest first, in keyset-paged batches so the
 * full result (up to `limit` rows) never sits in memory. Patient columns carry the id and
 * MRN only (no names); staff names are resolved org-scoped.
 */
export function streamAuditCsv(input: {
  organizationId: string;
  where: Prisma.AuditLogWhereInput;
  limit?: number;
  batchSize?: number;
}): ReadableStream<Uint8Array> {
  const limit = Math.min(input.limit ?? AUDIT_EXPORT_MAX_ROWS, AUDIT_EXPORT_MAX_ROWS);
  const batchSize = Math.max(1, Math.min(input.batchSize ?? AUDIT_EXPORT_BATCH, AUDIT_EXPORT_BATCH));
  const enc = new TextEncoder();
  const names = new Map<string, string | null>();
  let cursor: string | null = null;
  let sent = 0;
  let headerSent = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(enc.encode('﻿' + csvRow(AUDIT_CSV_HEADER)));
          return;
        }
        if (sent >= limit) {
          controller.close();
          return;
        }
        const take = Math.min(batchSize, limit - sent);
        const rows = await prisma.auditLog.findMany({
          where: input.where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: {
            id: true,
            createdAt: true,
            actorUserId: true,
            actorRole: true,
            action: true,
            resourceType: true,
            resourceId: true,
            patientId: true,
            outcome: true,
            ipAddress: true,
          },
        });
        if (!rows.length) {
          controller.close();
          return;
        }
        const missingUsers = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => !!v && !names.has(v)))];
        if (missingUsers.length) {
          const users = await prisma.user.findMany({
            where: { id: { in: missingUsers }, organizationId: input.organizationId },
            select: { id: true, name: true },
          });
          for (const id of missingUsers) names.set(id, users.find((u) => u.id === id)?.name ?? null);
        }
        const patientIds = [...new Set(rows.map((r) => r.patientId).filter((v): v is string => !!v))];
        const mrns = patientIds.length
          ? new Map(
              (
                await prisma.client.findMany({
                  where: { id: { in: patientIds }, organizationId: input.organizationId },
                  select: { id: true, mrn: true },
                })
              ).map((c) => [c.id, c.mrn])
            )
          : new Map<string, string | null>();
        let chunk = '';
        for (const r of rows) {
          chunk += csvRow([
            r.createdAt.toISOString(),
            r.actorUserId ? names.get(r.actorUserId) ?? '' : '',
            r.actorUserId ?? '',
            r.actorRole ?? '',
            actionLabel(r.action),
            r.action,
            describeResource(r.resourceType),
            r.resourceType ?? '',
            r.resourceId ?? '',
            r.patientId ?? '',
            r.patientId ? mrns.get(r.patientId) ?? '' : '',
            outcomeLabel(r.outcome),
            r.ipAddress ?? '',
          ]);
        }
        sent += rows.length;
        cursor = rows[rows.length - 1].id;
        controller.enqueue(enc.encode(chunk));
        if (rows.length < take || sent >= limit) controller.close();
      } catch (err) {
        console.error('[audit export] stream failed', err instanceof Error ? err.name : 'error');
        controller.error(err);
      }
    },
  });
}
