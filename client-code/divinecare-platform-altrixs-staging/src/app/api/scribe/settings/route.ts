import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { canEditPracticeSettings } from '@/lib/practice/access';
import { MD_RECORDING_STATUTE } from '@/lib/scribe/consent';
import { scribeSettingsPatchSchema } from '@/lib/scribe/settings';
import { loadScribeSettings, saveScribeSettings } from '@/lib/scribe/store';

export const runtime = 'nodejs';

/** GET — practice AI Scribe settings (any signed-in staff; no PHI). */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const settings = await loadScribeSettings(gate.organizationId);
  return NextResponse.json({
    success: true,
    settings,
    canEdit: canEditPracticeSettings(String(gate.role)),
    recordingConsentNote: `Recording consent is always required (${MD_RECORDING_STATUTE}: every party must agree). It cannot be turned off.`,
  });
}

/** PUT — practice leadership only. Audited (setting names only). */
export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const audit = (outcome: 'SUCCESS' | 'DENIED' | 'FAILURE', metadata: Record<string, unknown> = {}) =>
    writeAuditLog({ action: 'SCRIBE_SETTINGS_WRITE', actorUserId: gate.userId, actorRole: String(gate.role), organizationId: gate.organizationId, resourceType: 'ScribeSettings', outcome, metadata });
  if (!canEditPracticeSettings(String(gate.role))) {
    await audit('DENIED');
    return NextResponse.json({ success: false, error: 'Only practice leadership can change AI Scribe settings' }, { status: 403 });
  }
  const parsed = scribeSettingsPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid settings' }, { status: 400 });
  }
  try {
    const settings = await saveScribeSettings(gate.organizationId, gate.userId, parsed.data);
    await audit('SUCCESS', { fields: Object.keys(parsed.data) });
    return NextResponse.json({ success: true, settings });
  } catch (err) {
    console.error('[scribe:settings]', err instanceof Error ? err.message : 'unknown');
    await audit('FAILURE');
    return NextResponse.json({ success: false, error: 'Could not save (have the 20261019_scribe_core and 20261020_scribe_transcription_engine migrations run?)' }, { status: 500 });
  }
}
