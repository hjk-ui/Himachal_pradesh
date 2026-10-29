import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessEligibility } from '@/lib/eligibility/manage';
import { eligibilityChannels } from '@/lib/eligibility/waystar';
import { canManageNightlyEligibility, nightlyGate } from '@/lib/eligibility/nightly';
import { loadNightlySettings, saveNightlySettings } from '@/lib/eligibility/nightlyRun';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const RESOURCE = 'eligibilityNightlySettings';

async function view(organizationId: string, role: string) {
  const settings = await loadNightlySettings(organizationId);
  const ch = eligibilityChannels();
  const gate = nightlyGate({ settings, waystarActive: ch.waystar, usageIndicator: ch.usageIndicator });
  return {
    settings,
    waystar: { active: ch.waystar, usageIndicator: ch.usageIndicator },
    /** what tonight's run would do with these settings on this server */
    wouldRun: gate.run,
    blockedBy: gate.run === false ? gate.message : null,
    canEdit: canManageNightlyEligibility(role),
  };
}

/** GET — the practice setting "Automatic overnight eligibility checks" (eligibility page). */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessEligibility(gate.role) || !canAccessPath(gate.role, '/dashboard/ehr/eligibility')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json({ success: true, ...(await view(gate.organizationId, String(gate.role))) });
}

const patchSchema = z
  .object({ enabled: z.boolean().optional(), allowTest: z.boolean().optional() })
  .refine((b) => b.enabled !== undefined || b.allowTest !== undefined, 'Nothing to change');

/** PATCH — leadership + billing. Audited. */
export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canManageNightlyEligibility(String(gate.role)) || !canAccessPath(gate.role, '/dashboard/ehr/eligibility')) {
    await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: RESOURCE, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ success: false, error: 'Only leadership or billing can change this setting' }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  const before = await loadNightlySettings(gate.organizationId);
  await saveNightlySettings(gate.organizationId, gate.userId, parsed.data);
  await auditPhiAccess({
    gate, req, action: 'UPDATE', resourceType: RESOURCE,
    metadata: {
      enabledBefore: before.enabled, enabled: parsed.data.enabled ?? before.enabled,
      allowTestBefore: before.allowTest, allowTest: parsed.data.allowTest ?? before.allowTest,
    },
  });
  return NextResponse.json({ success: true, ...(await view(gate.organizationId, String(gate.role))) });
}
