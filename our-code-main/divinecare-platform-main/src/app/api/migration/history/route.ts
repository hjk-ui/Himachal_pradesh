import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';

const LEADERSHIP = new Set(['PRACTICE_DIRECTOR', 'ADMIN']);

const IMPORT_KINDS = [
  'assignedProvider',
  'coverageNotes',
  'aging',
  'prepayments',
  'copays',
  'transactions',
  'authorizations',
  'autopay',
  'transactionJournal',
  'treatmentPlans',
] as const;

function importSections(job: { imported: number; errors: number; errorJson: unknown }) {
  const stored = job.errorJson && typeof job.errorJson === 'object' && !Array.isArray(job.errorJson)
    ? (job.errorJson as { sections?: Record<string, { created?: number; updated?: number; skipped?: number }> }).sections
    : undefined;
  return IMPORT_KINDS.map((kind) => ({
    kind,
    created: stored?.[kind]?.created ?? (kind === 'assignedProvider' ? job.imported : 0),
    updated: stored?.[kind]?.updated ?? 0,
    skipped: stored?.[kind]?.skipped ?? (kind === 'assignedProvider' ? job.errors : 0),
  }));
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!LEADERSHIP.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const jobs = await prisma.migrationJob.findMany({
      where: { organizationId: gate.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      success: true,
      jobs: jobs.map((j) => ({
        id: j.id,
        type: j.type,
        platform: j.platform,
        total: j.total,
        imported: j.imported,
        errors: j.errors,
        sections: importSections(j),
        status: j.status,
        createdById: j.createdById,
        createdAt: j.createdAt.toISOString(),
        errorJson: j.errorJson,
      })),
    });
  } catch (err) {
    console.error('[migration/history GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load migration history' },
      { status: 500 }
    );
  }
}
