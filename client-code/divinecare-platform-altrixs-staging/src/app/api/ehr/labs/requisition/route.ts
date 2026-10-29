import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { LABS_PATH, canAccessLabs, createOrder } from '@/lib/labs/manage';
import { canOrderLabs } from '@/lib/labs/access';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  // Ordering is a prescriber action (same rule as POST /api/labs/orders)
  if (!canAccessLabs(gate.role) || !canAccessPath(gate.role, LABS_PATH) || !canOrderLabs(gate.role)) {
    return NextResponse.json({ success: false, error: 'Only prescribers can order labs' }, { status: 403 });
  }

  try {
    const body = await req.json();

    if (!body.clientId) {
      return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
    }
    // Medical necessity: ICD-10 codes are required on every lab order
    if (!Array.isArray(body.icd10Codes) || !body.icd10Codes.some((c: unknown) => typeof c === 'string' && c.trim())) {
      return NextResponse.json({ success: false, error: 'Add at least one ICD-10 diagnosis (medical necessity)' }, { status: 400 });
    }

    const strList = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

    // Same path as /api/labs/orders: caseload check, ordering clinician's own NPI (409 when
    // missing), configured facility/CLIA. No placeholder panels, ICD-10 codes or specimen.
    const result = await createOrder(
      { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role },
      {
        clientId: String(body.clientId),
        lab: body.lab === 'LABCORP' ? 'LABCORP' : body.lab === 'IN_HOUSE' ? 'IN_HOUSE' : 'QUEST',
        priority: typeof body.priority === 'string' ? body.priority : undefined,
        specimen: typeof body.specimen === 'string' ? body.specimen : null,
        icd10Codes: strList(body.icd10Codes),
        panels: strList(body.panels),
        otherPanel: typeof body.otherPanel === 'string' ? body.otherPanel : null,
        clinicalNotes:
          typeof body.clinicalNotes === 'string'
            ? body.clinicalNotes
            : body.isEkg
              ? 'Antipsychotic QTc Prolongation Safety Protocol — Baseline EKG'
              : null,
      }
    );
    if (result.ok === false) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    const order = result.order;

    await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'labRequisition', resourceId: order.id, patientId: order.clientId, metadata: { lab: order.lab } });
    return NextResponse.json({
      success: true,
      order,
      esignature: {
        signedByName: order.signerName,
        signedAt: order.signedAt,
        hash: order.signatureHash,
        verifiedBadge: '✓ E-Signed / No wet signature required',
      },
    }, { status: 201 });
  } catch (err: unknown) {
    console.error('[api/ehr/labs/requisition POST] error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not create lab requisition' },
      { status: 500 }
    );
  }
}
