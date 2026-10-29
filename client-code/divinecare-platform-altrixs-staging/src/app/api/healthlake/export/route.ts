import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { startStoreExport } from '@/lib/healthlake/bulk';
import { createHealthLakeTransport } from '@/lib/healthlake/client';
import { HEALTHLAKE_EXPORT_NOT_CONFIGURED, healthLakeConfig } from '@/lib/healthlake/config';
import { healthLakeGate, notConfiguredResponse } from '../_lib/gate';

export const runtime = 'nodejs';

/** POST /api/healthlake/export — whole data store export to AWS_HEALTHLAKE_EXPORT_S3_URI (server config only). */
export async function POST() {
  const g = await healthLakeGate();
  if (g.ok === false) return g.response;
  const cfg = healthLakeConfig();
  const nc = notConfiguredResponse(cfg);
  if (nc) return nc;
  if (!cfg.export.ready) {
    return NextResponse.json(
      { success: false, code: HEALTHLAKE_EXPORT_NOT_CONFIGURED, error: 'Export is not configured', missing: cfg.export.missing },
      { status: 503 }
    );
  }
  try {
    const res = await startStoreExport({
      db: prisma,
      cfg,
      transport: createHealthLakeTransport(cfg)!,
      organizationId: g.gate.organizationId,
      actorUserId: g.gate.userId,
      actorRole: g.gate.role,
    });
    if (res.ok === false) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
    return NextResponse.json({ success: true, jobId: res.jobId, awsJobId: res.awsJobId });
  } catch (err) {
    console.error('[healthlake export]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'HealthLake export failed' }, { status: 502 });
  }
}
