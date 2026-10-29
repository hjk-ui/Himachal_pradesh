import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { canEditPracticeSettings, canViewPracticeSettings } from '@/lib/practice/access';
import { PracticeSettingsError, type PracticeActor } from '@/lib/practice/store';
import { firstIssue } from '@/lib/practice/settings';

/** Org-scoped practice settings gate. Reads: leadership (roleAccess). Writes: leadership only, denials audited. */
export async function practiceGate(mode: 'read' | 'write', action = 'practice_settings_write') {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false as const, response: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  const actor: PracticeActor = { organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) };
  const canEdit = canEditPracticeSettings(actor.role);
  if (!canViewPracticeSettings(actor.role) || (mode === 'write' && !canEdit)) {
    if (mode === 'write') {
      await writeAuditLog({
        action,
        actorUserId: actor.userId,
        actorRole: actor.role,
        organizationId: actor.organizationId,
        resourceType: 'PracticeSettings',
        outcome: 'DENIED',
      });
    }
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: 'Only practice leadership can change practice settings' }, { status: 403 }),
    };
  }
  return { ok: true as const, actor, canEdit };
}

export function practiceError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: firstIssue(error), field: error.issues[0]?.path.join('.') }, { status: 400 });
  if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
    return NextResponse.json({ success: false, error: 'That name is already used by another location in this practice' }, { status: 409 });
  }
  if (error instanceof PracticeSettingsError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  console.error(`[practice-settings] ${fallback}:`, error instanceof Error ? error.message : 'unknown error');
  return NextResponse.json({ success: false, error: `${fallback} (has the 20261018_practice_settings migration run?)` }, { status: 500 });
}
