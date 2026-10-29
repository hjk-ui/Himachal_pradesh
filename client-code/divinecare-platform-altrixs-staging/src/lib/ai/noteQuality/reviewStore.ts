/**
 * Supervisor actions taken with a quality checklist: "Return to author" (checklist attached) and
 * "Co-sign anyway" (findings + optional comment recorded). The note itself is never changed: a
 * signed note is corrected by its author with an addendum.
 *
 * Own table (raw SQL, not in prisma/schema.prisma), created by migration
 * 20261019_runtime_ddl_to_migration.sql.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { QualityReviewAction, QualityReviewView } from './types';

// Table + index: prisma/migrations/20261019_runtime_ddl_to_migration.sql (no runtime DDL).

type Row = {
  id: string;
  reviewerName: string | null;
  action: string;
  comment: string | null;
  findings: unknown;
  createdAt: Date;
};

function findingsFrom(raw: unknown): QualityReviewView['findings'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
    .map((f) => ({
      id: String(f.id ?? ''),
      label: String(f.label ?? ''),
      status: f.status === 'fail' ? ('fail' as const) : ('warn' as const),
      fix: typeof f.fix === 'string' ? f.fix : null,
    }))
    .filter((f) => f.id && f.label);
}

export async function recordQualityReview(input: {
  organizationId: string;
  noteId: string;
  clientId: string;
  reviewerId: string;
  reviewerName: string | null;
  action: QualityReviewAction;
  comment: string | null;
  findings: QualityReviewView['findings'];
}): Promise<{ id: string; createdAt: string }> {
  const id = randomUUID();
  const now = new Date();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "NoteQualityReview" ("id", "organizationId", "noteId", "clientId", "reviewerId", "reviewerName", "action", "comment", "findings", "createdAt")
    VALUES (${id}, ${input.organizationId}, ${input.noteId}, ${input.clientId}, ${input.reviewerId}, ${input.reviewerName}, ${input.action}, ${input.comment},
            ${JSON.stringify(input.findings.slice(0, 60))}::jsonb, ${now})
  `);
  return { id, createdAt: now.toISOString() };
}

/** Latest supervisor action on this note (org-scoped), with addenda added since. Missing table → null. */
export async function latestQualityReview(organizationId: string, noteId: string): Promise<QualityReviewView | null> {
  try {
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT "id", "reviewerName", "action", "comment", "findings", "createdAt"
      FROM "NoteQualityReview"
      WHERE "noteId" = ${noteId} AND "organizationId" = ${organizationId}
      ORDER BY "createdAt" DESC
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return null;
    const addendaSince = await prisma.progressNoteAddendum.count({ where: { noteId, createdAt: { gt: row.createdAt } } });
    return {
      id: row.id,
      action: row.action === 'COSIGNED' ? 'COSIGNED' : 'RETURNED',
      reviewerName: row.reviewerName,
      comment: row.comment,
      createdAt: row.createdAt.toISOString(),
      findings: findingsFrom(row.findings),
      addendaSince,
    };
  } catch (err) {
    console.error('[noteQuality] review lookup failed', err);
    return null;
  }
}
