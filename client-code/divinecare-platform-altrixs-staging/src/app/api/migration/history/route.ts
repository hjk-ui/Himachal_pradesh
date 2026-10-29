import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';

const LEADERSHIP = new Set(['PRACTICE_DIRECTOR', 'ADMIN']);

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
