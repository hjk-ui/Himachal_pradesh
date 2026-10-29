import { NextResponse } from 'next/server';
import { z } from 'zod';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { tmsError, tmsGate } from '@/lib/tms/http';
import { loadPracticeDefaults, savePracticeDefaults } from '@/lib/tms/workflowDb';

export const runtime = 'nodejs';

const schema = z.object({
  /** A TMS_DEVICES name or free text ("Other (specify)") */
  deviceName: z.string().trim().max(120).nullish(),
  /** Cleared indications / coil, free text */
  deviceDetail: z.string().trim().max(500).nullish(),
});

/** GET — the clinic's default TMS device (practice setting; no PHI). */
export async function GET() {
  const g = await tmsGate('read');
  if (g.ok === false) return g.res;
  try {
    return NextResponse.json({ success: true, defaults: await loadPracticeDefaults(g.actor.organizationId) });
  } catch (err) {
    return tmsError(err, 'Could not load the TMS practice defaults');
  }
}

/** PUT — set the clinic's default TMS device once; new cases prefill it (TMS write roles). */
export async function PUT(req: Request) {
  const g = await tmsGate('write');
  if (g.ok === false) return g.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  try {
    const defaults = await savePracticeDefaults(g.actor, { deviceName: parsed.data.deviceName ?? null, deviceDetail: parsed.data.deviceDetail ?? null });
    await writeAuditLog({
      action: 'TMS_PRACTICE_DEFAULTS_SAVED',
      actorUserId: g.actor.userId,
      actorRole: g.actor.role,
      organizationId: g.actor.organizationId,
      resourceType: 'tmsPracticeDefault',
      resourceId: g.actor.organizationId,
      metadata: { fields: ['deviceName', 'deviceDetail'] },
    }).catch(() => {});
    return NextResponse.json({ success: true, defaults });
  } catch (err) {
    return tmsError(err, 'Could not save the TMS practice defaults');
  }
}
