import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canSeeAotClinical, findParticipantInOrg } from '../../_scope';
import { isFormType } from '@/lib/aot/forms';
import { prefillFor } from '@/lib/aot/documents';

export const runtime = 'nodejs';

/**
 * GET /api/aot/documents/prefill?participantId=&formType= — current chart / participant values for a form
 * (the editor's "Fill blanks from chart"). Nothing is saved; chart values only when the chart is on the
 * caller's caseload.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  // Prefill copies chart diagnoses / affidavit facts into a form: EHR clinical roles only
  if (!canSeeAotClinical(gate.role)) {
    return NextResponse.json({ success: false, error: 'AOT form content is limited to the treating clinicians' }, { status: 403 });
  }

  try {
    const sp = new URL(req.url).searchParams;
    const formType = sp.get('formType');
    if (!isFormType(formType)) return NextResponse.json({ success: false, error: 'Unknown form type' }, { status: 400 });
    const participant = await findParticipantInOrg(sp.get('participantId') || '', gate.organizationId);
    if (!participant) return NextResponse.json({ success: false, error: 'AOT Participant not found' }, { status: 404 });

    const pre = await prefillFor(gate, participant, formType);

    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'aotDocumentPrefill',
      resourceId: participant.id,
      patientId: participant.clientId ?? null,
      metadata: { participantId: participant.id, formType, keys: Object.keys(pre.data).length },
    });

    return NextResponse.json({ success: true, data: pre.data, sources: pre.sources, chartNote: pre.chartNote });
  } catch (err: unknown) {
    console.error('[api/aot/documents/prefill GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load chart values' }, { status: 500 });
  }
}
