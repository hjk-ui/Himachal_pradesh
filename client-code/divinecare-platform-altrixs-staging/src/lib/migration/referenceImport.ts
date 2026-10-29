import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';

/**
 * Shared pieces of the Valant reference-only report imports (aging, insurance aging,
 * prepayments, copays). The browser sends raw CSV records (header row first) because these
 * reports repeat column names; the server parses them by position after checking the header.
 */

export const LEADERSHIP = new Set(['PRACTICE_DIRECTOR', 'ADMIN']);

export function referenceBody(maxCells = 60, maxRows = 12000) {
  return z.object({
    platform: z.literal('valant').default('valant'),
    dryRun: z.boolean().optional().default(false),
    /** Prepayments: replacing the org's earlier prepayment rows must be confirmed */
    confirmReplace: z.boolean().optional().default(false),
    records: z.array(z.array(z.string().max(500)).max(maxCells)).min(2).max(maxRows),
  });
}

export const referenceBodySchema = referenceBody();

export type OrgGate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;

export async function requireImportGate(what: string): Promise<{ gate: OrgGate; denied?: never } | { gate?: never; denied: NextResponse }> {
  const gate = await requireOrgContext();
  if (!gate.ok) return { denied: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  if (!LEADERSHIP.has(gate.role)) {
    return {
      denied: NextResponse.json({ success: false, error: `Only Practice Director or Admin can import ${what}` }, { status: 403 }),
    };
  }
  return { gate };
}

export async function createReferenceJob(
  gate: OrgGate,
  type: string,
  total: number,
  imported: number,
  errors: { line: number; error: string }[],
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  const status = errors.length === 0 ? 'success' : imported > 0 ? 'partial' : 'failed';
  const job = await db.migrationJob.create({
    data: {
      organizationId: gate.organizationId,
      type,
      platform: 'valant',
      total,
      imported,
      errors: errors.length,
      status,
      createdById: gate.userId,
      errorJson: errors.length ? (errors.slice(0, 100) as unknown as Prisma.InputJsonValue[]) : undefined,
    },
  });
  return { job, status };
}

export function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

export function handleImportError(err: unknown, tag: string, message: string) {
  if (err instanceof z.ZodError) {
    return NextResponse.json({ success: false, error: 'Invalid import payload', details: err.flatten() }, { status: 400 });
  }
  console.error(`[${tag}]`, err);
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}

/** Valant clients in the org keyed by upper-case Valant ID */
export async function valantClientsById(organizationId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    const clients = await prisma.client.findMany({
      where: { organizationId, sourcePlatform: 'valant', sourceId: { in: chunk, mode: 'insensitive' } },
      select: { id: true, sourceId: true },
    });
    for (const c of clients) map.set(String(c.sourceId).trim().replace(/\s+/g, ' ').toUpperCase(), c.id);
  }
  return map;
}
