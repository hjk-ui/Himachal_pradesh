import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { loadApiVersion, resetApiVersionCache } from '@/lib/drfirst/persistence';
import { requireDrFirstCaller } from '../_lib/access';

export const dynamic = 'force-dynamic';

/**
 * GET / PUT /api/drfirst/settings — the Rcopia API version sent in every request envelope
 * (DrFirst GM4: stored in the database, drfirst_settings.api_version). ADMIN only; changes are audited
 * and take effect within 5 minutes (cache).
 */
export async function GET(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { allowAdmin: true });
  if (g.response) return g.response;
  if (!g.caller.isAdmin) return NextResponse.json({ error: 'Administrators only.' }, { status: 403 });
  return NextResponse.json({ success: true, data: { apiVersion: await loadApiVersion() } });
}

const schema = z.object({ apiVersion: z.string().trim().regex(/^\d+\.\d+$/, 'Version must look like 2.54') });

export async function PUT(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { allowAdmin: true });
  if (g.response) return g.response;
  const c = g.caller;
  if (!c.isAdmin) return NextResponse.json({ error: 'Administrators only.' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });

  const before = await loadApiVersion();
  await prisma.drFirstSetting.upsert({
    where: { key: 'api_version' },
    create: { key: 'api_version', value: parsed.data.apiVersion, updatedById: c.userId },
    update: { value: parsed.data.apiVersion, updatedById: c.userId },
  });
  resetApiVersionCache();
  await writeAuditLog({
    action: 'DRFIRST_SETTING_UPDATE',
    actorUserId: c.userId,
    actorRole: c.role,
    organizationId: c.organizationId,
    resourceType: 'setting',
    resourceId: 'drfirst:api_version',
    outcome: 'SUCCESS',
    ipAddress: c.ipAddress,
    userAgent: c.userAgent,
    metadata: { from: before, to: parsed.data.apiVersion },
  });
  return NextResponse.json({ success: true, data: { apiVersion: parsed.data.apiVersion } });
}
