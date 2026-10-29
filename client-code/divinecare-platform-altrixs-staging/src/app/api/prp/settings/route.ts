import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { errorResponse, fail, ok, prpGate } from '@/lib/prp/http';
import { loadPrpSettings, PRP_SETTINGS_ROLES, savePrpSettings } from '@/lib/prp/settings';
import { PRP_BILLING_MODELS } from '@/lib/prp/standard';
import { ADULT_REVIEW_MAX_DAYS, MIN_PRACTICE_REVIEW_DAYS } from '@/lib/ehr/therapy/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESOURCE = 'prpPracticeSettings';

/** GET /api/prp/settings: PRP billing model (and who confirmed it), monthly contact minimum, IRP review interval. */
export async function GET() {
  const g = await prpGate();
  if (!g.ok) return g.res;
  try {
    return ok({ settings: await loadPrpSettings(g.actor.organizationId), canEdit: PRP_SETTINGS_ROLES.has(String(g.gate.role)) });
  } catch (e) {
    return errorResponse(e, 'Could not load PRP settings');
  }
}

const patchSchema = z
  .object({
    billingModel: z.enum(PRP_BILLING_MODELS).nullable().optional(),
    monthlyMinContacts: z.number().int().min(1).max(31).nullable().optional(),
    irpReviewDays: z.number().int().min(MIN_PRACTICE_REVIEW_DAYS).max(ADULT_REVIEW_MAX_DAYS).optional(),
  })
  .refine((b) => b.billingModel !== undefined || b.monthlyMinContacts !== undefined || b.irpReviewDays !== undefined, 'Nothing to change');

/** PATCH /api/prp/settings: leadership only. Audited (before / after values, no PHI). */
export async function PATCH(req: Request) {
  const g = await prpGate();
  if (!g.ok) return g.res;
  if (!PRP_SETTINGS_ROLES.has(String(g.gate.role))) {
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: RESOURCE, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return fail('Only practice leadership can change PRP settings', 403);
  }
  try {
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid request', 400);
    const before = await loadPrpSettings(g.actor.organizationId);
    const after = await savePrpSettings(g.actor.organizationId, g.actor.actorUserId, parsed.data);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'UPDATE',
      resourceType: RESOURCE,
      metadata: {
        fields: Object.keys(parsed.data),
        billingModelBefore: before.billing.model,
        billingModel: after.billing.model,
        monthlyMinContactsBefore: before.monthlyMinContacts,
        monthlyMinContacts: after.monthlyMinContacts,
        irpReviewDaysBefore: before.irpReviewDays,
        irpReviewDays: after.irpReviewDays,
      },
    });
    return ok({ settings: after, canEdit: true });
  } catch (e) {
    return errorResponse(e, 'Could not save PRP settings');
  }
}
