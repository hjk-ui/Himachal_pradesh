import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createHealthLakeTransport } from '@/lib/healthlake/client';
import { HEALTHLAKE_SYNC_DISABLED, healthLakeConfig } from '@/lib/healthlake/config';
import { runOrgSync } from '@/lib/healthlake/sync';
import { healthLakeGate, notConfiguredResponse } from '../_lib/gate';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** POST /api/healthlake/sync — run the scan + outbox worker now for the caller's org. */
export async function POST() {
  const g = await healthLakeGate();
  if (g.ok === false) return g.response;
  const cfg = healthLakeConfig();
  const nc = notConfiguredResponse(cfg);
  if (nc) return nc;
  const summary = await runOrgSync({
    db: prisma,
    organizationId: g.gate.organizationId,
    transport: createHealthLakeTransport(cfg)!,
    trigger: 'manual',
    actorUserId: g.gate.userId,
    actorRole: g.gate.role,
  });
  if (summary.status === 'SKIPPED') {
    return NextResponse.json({ success: false, code: HEALTHLAKE_SYNC_DISABLED, error: summary.reason }, { status: 409 });
  }
  return NextResponse.json(
    { success: summary.status !== 'FAILED', summary },
    { status: summary.status === 'FAILED' ? 502 : 200 }
  );
}
