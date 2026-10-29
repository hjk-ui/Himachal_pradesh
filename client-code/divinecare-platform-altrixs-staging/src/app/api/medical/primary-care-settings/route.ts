import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  CARE_GAP_KEYS,
  CARE_GAPS,
  canManagePrimaryCareSettings,
  canViewPrimaryCareWorkflow,
  DEFAULT_RESULTS_NOTIFY_DAYS,
  STANDING_ORDER_ATTESTATION,
  canApproveStandingOrders,
  canRetireStandingOrders,
  mergeStandingOrderEdits,
  type CareGapKey,
} from '@/lib/medical/primaryCareWorkflow';
import { loadPrimaryCareSettings, savePrimaryCareSettings, standingOrderActor } from '@/lib/medical/primaryCareWorkflowDb';
import { workflowGate, zodMessage } from '../_lib/workflowGate';

export const runtime = 'nodejs';

const RESOURCE = 'primaryCareSettings';

const putSchema = z.object({
  resultsNotifyDays: z.number().int().min(1).max(30).default(DEFAULT_RESULTS_NOTIFY_DAYS),
  pocStandingOrders: z
    .array(
      z.object({
        key: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,40}$/, 'Test key: letters, digits, dashes'),
        name: z.string().trim().min(2, 'Test name is required').max(80),
        // May be blank on a draft; approval requires it (approveStandingOrder)
        criteria: z.string().trim().max(300).default(''),
        resultType: z.enum(['numeric', 'pos_neg', 'text']),
        unit: z.string().trim().max(20).optional().nullable(),
        cpt: z.string().trim().max(10).optional().nullable(),
      })
    )
    .max(30)
    .default([])
    .refine((list) => new Set(list.map((o) => o.key)).size === list.length, 'Each test key must be unique'),
  careGapsDisabled: z.array(z.enum(CARE_GAP_KEYS as [CareGapKey, ...CareGapKey[]])).max(CARE_GAP_KEYS.length).default([]),
});

/** GET /api/medical/primary-care-settings — primary care team + leadership read (defaults when never saved) */
export async function GET(req: Request) {
  const g = await workflowGate(req, { action: 'READ', resourceType: RESOURCE, allow: canViewPrimaryCareWorkflow });
  if (g.ok === false) return g.response;
  const [settings, actor] = await Promise.all([loadPrimaryCareSettings(g.viewer.organizationId), standingOrderActor(g.viewer)]);
  return NextResponse.json({
    success: true,
    settings,
    careGaps: CARE_GAPS,
    canEdit: canManagePrimaryCareSettings(g.viewer.role),
    canApproveStandingOrders: canApproveStandingOrders(actor),
    canRetireStandingOrders: canRetireStandingOrders(actor),
    standingOrderAttestation: STANDING_ORDER_ATTESTATION,
  });
}

/** PUT /api/medical/primary-care-settings — leadership (practice director / admin / director) */
export async function PUT(req: Request) {
  const g = await workflowGate(req, { action: 'UPDATE', resourceType: RESOURCE, allow: canManagePrimaryCareSettings });
  if (g.ok === false) return g.response;
  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ success: false, error: zodMessage(err, 'Check the settings') }, { status: 400 });
  }
  try {
    // Status / approval never come from the request; an edited approved order goes back to draft
    const stored = await loadPrimaryCareSettings(g.viewer.organizationId);
    const merged = mergeStandingOrderEdits(
      stored.pocStandingOrders,
      body.pocStandingOrders.map((o) => ({ ...o, criteria: o.criteria ?? '', unit: o.unit || null, cpt: o.cpt || null }))
    );
    await savePrimaryCareSettings(g.viewer.organizationId, g.viewer.userId, {
      resultsNotifyDays: body.resultsNotifyDays,
      pocStandingOrders: merged.list,
      careGapsDisabled: body.careGapsDisabled,
    });
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'UPDATE',
      resourceType: RESOURCE,
      metadata: {
        resultsNotifyDays: body.resultsNotifyDays,
        standingOrders: merged.list.length,
        standingOrdersBackToDraft: merged.reverted,
        careGapsDisabled: body.careGapsDisabled,
      },
    });
    return NextResponse.json({ success: true, settings: await loadPrimaryCareSettings(g.viewer.organizationId) });
  } catch (err) {
    console.error('[medical/primary-care-settings PUT]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not save the settings' }, { status: 500 });
  }
}
