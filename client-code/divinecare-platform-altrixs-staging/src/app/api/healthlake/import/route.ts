import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { startBulkImport } from '@/lib/healthlake/bulk';
import { createHealthLakeTransport } from '@/lib/healthlake/client';
import { HEALTHLAKE_IMPORT_NOT_CONFIGURED, HEALTHLAKE_SYNC_DISABLED, healthLakeConfig } from '@/lib/healthlake/config';
import { getSyncSettings } from '@/lib/healthlake/settings';
import { healthLakeGate, notConfiguredResponse } from '../_lib/gate';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/healthlake/import — bulk initial load: NDJSON of this org's not-yet-synced resources
 * is written to AWS_HEALTHLAKE_IMPORT_S3_URI and a HealthLake import job is started.
 * The S3 location comes from server config only, never from the request.
 */
export async function POST() {
  const g = await healthLakeGate();
  if (g.ok === false) return g.response;
  const cfg = healthLakeConfig();
  const nc = notConfiguredResponse(cfg);
  if (nc) return nc;
  const settings = await getSyncSettings(prisma, g.gate.organizationId);
  if (!settings.enabled) {
    return NextResponse.json(
      { success: false, code: HEALTHLAKE_SYNC_DISABLED, error: 'Turn on HealthLake sync for this organization first' },
      { status: 409 }
    );
  }
  if (!cfg.import.ready) {
    return NextResponse.json(
      { success: false, code: HEALTHLAKE_IMPORT_NOT_CONFIGURED, error: 'Bulk import is not configured', missing: cfg.import.missing },
      { status: 503 }
    );
  }
  try {
    const res = await startBulkImport({
      db: prisma,
      cfg,
      transport: createHealthLakeTransport(cfg)!,
      organizationId: g.gate.organizationId,
      actorUserId: g.gate.userId,
      actorRole: g.gate.role,
    });
    if (res.ok === false) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
    return NextResponse.json({ success: true, jobId: res.jobId, awsJobId: res.awsJobId, resourceCount: res.resourceCount });
  } catch (err) {
    console.error('[healthlake import]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'HealthLake import failed' }, { status: 502 });
  }
}
