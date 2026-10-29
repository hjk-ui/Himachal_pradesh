import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { prisma } from '@/lib/db/prisma';
import { saveSyncSettings } from '@/lib/healthlake/settings';
import { healthLakeGate } from '../_lib/gate';

export const runtime = 'nodejs';

const schema = z
  .object({
    enabled: z.boolean().optional(),
    allowPart2Sync: z.boolean().optional(),
    /** Must be true to turn Part 2 sync on (explicit acknowledgement) */
    confirmPart2: z.boolean().optional(),
  })
  .strict();

/** PATCH /api/healthlake/settings — per-org sync opt-in and the explicit 42 CFR Part 2 setting (default off). */
export async function PATCH(req: Request) {
  const g = await healthLakeGate();
  if (g.ok === false) return g.response;
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { success: false, error: 'Expected { enabled?: boolean, allowPart2Sync?: boolean, confirmPart2?: boolean }' },
      { status: 400 }
    );
  }
  if (body.allowPart2Sync === true && body.confirmPart2 !== true) {
    return NextResponse.json(
      {
        success: false,
        code: 'PART2_CONFIRMATION_REQUIRED',
        error: 'Sending 42 CFR Part 2 records to HealthLake needs explicit confirmation',
      },
      { status: 400 }
    );
  }
  const settings = await saveSyncSettings(
    prisma,
    g.gate.organizationId,
    { enabled: body.enabled, allowPart2Sync: body.allowPart2Sync },
    g.gate.userId
  );
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'HEALTHLAKE_SETTINGS_UPDATE',
    resourceType: 'ClinicModuleState',
    resourceId: 'healthlake-sync',
    metadata: { enabled: settings.enabled, allowPart2Sync: settings.allowPart2Sync },
  });
  return NextResponse.json({ success: true, settings });
}
