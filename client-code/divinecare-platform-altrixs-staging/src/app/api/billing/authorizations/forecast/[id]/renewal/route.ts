import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessPriorAuths, canWritePriorAuths } from '@/lib/ehr/priorAuths';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { checkAiNoteConsent } from '@/lib/ai/noteDraftSafety';
import { loadRenewalFacts } from '@/lib/ai/authForecast/data';
import { draftRenewal } from '@/lib/ai/authForecast/draft';
import { renewalDraftedMarker } from '@/lib/ai/authForecast/forecast';
import { dayOf } from '@/lib/clinical/sessionFrequency';

export const runtime = 'nodejs';

const bodySchema = z.object({ action: z.enum(['draft', 'record']).default('draft') });

/**
 * POST /api/billing/authorizations/forecast/[id]/renewal
 * { action: 'draft' }  → renewal packet text for staff review (never submitted). Figures are computed;
 *                        Bedrock Haiku writes only the justification paragraph, unless the client
 *                        declined AI drafting or AI is unavailable (template paragraph instead).
 * { action: 'record' } → appends "[renewal-drafted:YYYY-MM-DD]" to the auth notes (write roles).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPriorAuths(gate.role) || !canAccessPath(gate.role, '/dashboard/ehr/prior-auths')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const actor = { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
  const auth = await prisma.priorAuth.findFirst({
    where: { id, organizationId: gate.organizationId, status: 'APPROVED', client: clientAccessWhere(actor) },
    select: { id: true, clientId: true, notes: true },
  });
  if (!auth) {
    await auditPhiAccess({ gate, req, action: body.action === 'record' ? 'WRITE' : 'READ', resourceType: 'priorAuthRenewal', resourceId: id, outcome: 'DENIED', metadata: { reason: 'not_found' } });
    return NextResponse.json({ success: false, error: 'Authorization not found' }, { status: 404 });
  }
  try {
    await assertClientPhiAccess({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role, clientId: auth.clientId, path: `/api/billing/authorizations/forecast/${id}/renewal` });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'priorAuthRenewal', resourceId: id, patientId: auth.clientId, outcome: 'DENIED', metadata: { reason: 'sensitive_record' } });
      return NextResponse.json(err.body, { status: err.status });
    }
    throw err;
  }

  const today = dayOf(new Date());

  if (body.action === 'record') {
    if (!canWritePriorAuths(gate.role)) return NextResponse.json({ success: false, error: 'Only billing and office staff can update authorizations' }, { status: 403 });
    const marker = renewalDraftedMarker(today);
    const notes = (auth.notes ?? '').includes(marker) ? auth.notes : `${(auth.notes ?? '').trim()}${auth.notes?.trim() ? ' ' : ''}${marker}`;
    await prisma.priorAuth.update({ where: { id: auth.id }, data: { notes } });
    await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'priorAuth', resourceId: auth.id, patientId: auth.clientId, metadata: { operation: 'renewal_drafted_marker', fields: ['notes'] } });
    return NextResponse.json({ success: true, renewalDraftedAt: today });
  }

  try {
    const facts = await loadRenewalFacts(actor, id);
    if (!facts) return NextResponse.json({ success: false, error: 'Authorization not found' }, { status: 404 });
    const result = await draftRenewal(
      facts,
      {
        consent: async () => (await checkAiNoteConsent(gate.organizationId, auth.clientId)).status,
        aiAvailable: isBedrockConfigured(),
        model: BEDROCK_MODELS.HAIKU,
        invoke: (system, userPrompt) => invokeBedrock({ model: 'HAIKU', system, userPrompt, maxTokens: 600, temperature: 0.2 }),
        audit: (e) => auditPhiAccess({ gate, req, action: e.action, resourceType: 'priorAuthRenewal', resourceId: auth.id, patientId: auth.clientId, outcome: e.outcome, metadata: e.metadata }),
      },
      today
    );
    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'priorAuthRenewal',
      resourceId: auth.id,
      patientId: auth.clientId,
      metadata: { operation: 'renewal_draft', justificationSource: result.justificationSource, fallbackReason: result.fallbackReason, forecastStatus: facts.forecast.status, submitted: false },
    });
    return NextResponse.json({
      success: true,
      draft: {
        text: result.text,
        justificationSource: result.justificationSource,
        fallbackReason: result.fallbackReason,
        consent: result.consent,
        warning: result.warning,
        model: result.model,
        forecast: facts.forecast,
        request: facts.request,
        canRecord: canWritePriorAuths(gate.role),
      },
    });
  } catch (err) {
    console.error('[auth renewal draft]', id, err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not draft the renewal request' }, { status: 500 });
  }
}
