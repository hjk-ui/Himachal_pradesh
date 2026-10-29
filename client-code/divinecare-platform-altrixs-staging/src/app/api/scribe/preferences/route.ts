import { NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { scribePreferencesSchema } from '@/lib/scribe/settings';
import { loadPreferences, savePreferences } from '@/lib/scribe/store';
import { scribeGate } from '../_lib/gate';

export const runtime = 'nodejs';

/** GET / PUT — the signed-in clinician's own drafting preferences (no PHI). */
export async function GET() {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  return NextResponse.json({ success: true, preferences: await loadPreferences(g.actor.organizationId, g.actor.userId) });
}

export async function PUT(req: Request) {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  const parsed = scribePreferencesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid preferences' }, { status: 400 });
  const preferences = await savePreferences(g.actor.organizationId, g.actor.userId, parsed.data);
  await writeAuditLog({
    action: 'SCRIBE_PREFERENCES_WRITE',
    actorUserId: g.actor.userId,
    actorRole: String(g.actor.role),
    organizationId: g.actor.organizationId,
    resourceType: 'ScribePreference',
    metadata: { fields: Object.keys(parsed.data) },
  });
  return NextResponse.json({ success: true, preferences });
}
