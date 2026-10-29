import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPayerBilling } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { isMissingSchema, parseDay } from '@/lib/billing/patientReference';

export const runtime = 'nodejs';

type ArchiveRow = {
  id: string;
  fileName: string | null;
  fileSize: number | null;
  s3RawKey: string | null;
  extractedFields: unknown;
  createdAt: string;
  source: 'documentIntake' | 'zipModule';
};

/**
 * Billing archive list — merges:
 * 1) documentIntake rows (status archived + practice_billing)
 * 2) clinicModuleState `billing-archive:*` written by ZIP intake
 * so Valant ZIP-filed archives actually appear in the UI.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPayerBilling(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100).toLowerCase();
  const from = parseDay(url.searchParams.get('from'));
  const to = parseDay(url.searchParams.get('to'));
  const page = Math.min(1000, Math.max(0, Number(url.searchParams.get('page') || '0') || 0));
  const pageSize = 100;

  const rows: ArchiveRow[] = [];

  try {
    const where = {
      organizationId: gate.organizationId,
      status: 'archived',
      matchStatus: 'practice_billing',
      suggestedClientId: null,
      ...(q ? { fileName: { contains: q, mode: 'insensitive' as const } } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}),
            },
          }
        : {}),
    };
    const intake = await prisma.documentIntake.findMany({
      where,
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        s3RawKey: true,
        extractedFields: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    for (const row of intake) {
      rows.push({
        id: row.id,
        fileName: row.fileName,
        fileSize: row.fileSize,
        s3RawKey: row.s3RawKey,
        extractedFields: row.extractedFields,
        createdAt: row.createdAt.toISOString(),
        source: 'documentIntake',
      });
    }
  } catch (err) {
    if (!isMissingSchema(err)) {
      console.error('[valant-archive] documentIntake', err);
    }
  }

  try {
    const modules = await prisma.clinicModuleState.findMany({
      where: {
        organizationId: gate.organizationId,
        module: { startsWith: 'billing-archive:' },
      },
      select: { module: true, data: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    for (const row of modules) {
      const data = (row.data || {}) as Record<string, unknown>;
      const fileName = String(data.name || data.path || row.module);
      if (q && !fileName.toLowerCase().includes(q)) continue;
      const createdAt = row.createdAt;
      if (from && createdAt < from) continue;
      if (to && createdAt >= new Date(to.getTime() + 86_400_000)) continue;
      rows.push({
        id: row.module,
        fileName,
        fileSize: typeof data.bytes === 'number' ? data.bytes : null,
        s3RawKey: null,
        extractedFields: { path: data.path, sha256: data.sha256 },
        createdAt: createdAt.toISOString(),
        source: 'zipModule',
      });
    }
  } catch (err) {
    console.error('[valant-archive] zipModule', err);
  }

  rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const total = rows.length;
  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);

  return NextResponse.json({
    success: true,
    count: pageRows.length,
    total,
    page,
    pageSize,
    rows: pageRows,
  });
}
