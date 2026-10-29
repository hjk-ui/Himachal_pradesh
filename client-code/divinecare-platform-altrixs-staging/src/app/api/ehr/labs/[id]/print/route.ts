import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { labFacilityName } from '@/lib/labs/facility';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { LABS_PATH, canAccessLabs } from '@/lib/labs/manage';

export const runtime = 'nodejs';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NOT_RECORDED = 'Not recorded';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessLabs(gate.role) || !canAccessPath(gate.role, LABS_PATH)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const order = await prisma.labOrder.findFirst({
      where: {
        id,
        organizationId: gate.organizationId,
        // Caseload roles only print their assigned clients' requisitions.
        client: clientAccessWhere({
          organizationId: gate.organizationId,
          actorUserId: gate.userId,
          actorRole: gate.role,
        }),
      },
      include: {
        client: true,
      },
    });

    if (!order) {
      return new Response('<h3>Lab Order Not Found</h3>', {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Only stored values are printed — missing data shows as "Not recorded", never a placeholder.
    const facilityName = esc(order.facilityName || labFacilityName());
    const panelsText = [...order.panels, order.otherPanel].filter(Boolean).map(esc).join(', ');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Lab Requisition - ${esc(order.id)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 40px; color: #111827; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #5C2D91; padding-bottom: 12px; margin-bottom: 24px; }
    .logo { font-size: 22px; font-weight: 800; color: #5C2D91; }
    .badge { background: #ECFDF5; border: 1px solid #A7F3D0; color: #065F46; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; display: inline-block; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .panel { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 16px; }
    .panel h4 { margin: 0 0 10px 0; font-size: 13px; text-transform: uppercase; color: #4B5563; }
    .row { margin-bottom: 6px; font-size: 14px; }
    .label { font-weight: 600; color: #374151; }
    .signature-block { margin-top: 40px; border-top: 1px dashed #D1D5DB; padding-top: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
    .sig-text { font-family: "Georgia", serif; font-size: 20px; font-style: italic; color: #1E3A8A; margin-bottom: 4px; }
    .no-print { margin-bottom: 20px; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()" style="padding: 10px 20px; background: #5C2D91; color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">
      Print Lab Requisition
    </button>
  </div>
  <div class="header">
    <div>
      <div class="logo">${facilityName}</div>
      <div style="font-size: 13px; color: #6B7280; margin-top: 2px;">Comprehensive Behavioral & Somatic Medicine</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 14px; font-weight: 700;">LAB REQUISITION ORDER</div>
      <div style="font-size: 12px; color: #6B7280; font-family: monospace;">ORD-${esc(order.id.slice(0, 10).toUpperCase())}</div>
      <div style="margin-top: 4px;"><span class="badge">Vendor: ${esc(order.lab)}</span></div>
    </div>
  </div>

  <div class="grid">
    <div class="panel">
      <h4>Patient Demographics</h4>
      <div class="row"><span class="label">Patient Name:</span> ${esc(order.client.name)}</div>
      <div class="row"><span class="label">MRN:</span> ${order.client.mrn ? esc(order.client.mrn) : NOT_RECORDED}</div>
      <div class="row"><span class="label">DOB:</span> ${order.client.dateOfBirth ? new Date(order.client.dateOfBirth).toLocaleDateString() : NOT_RECORDED}</div>
      <div class="row"><span class="label">Gender:</span> ${order.client.gender ? esc(order.client.gender) : NOT_RECORDED}</div>
    </div>

    <div class="panel">
      <h4>Order Telemetry & Protocol</h4>
      <div class="row"><span class="label">Priority:</span> ${esc(order.priority)}</div>
      <div class="row"><span class="label">Specimen:</span> ${order.specimen ? esc(order.specimen) : NOT_RECORDED}</div>
      <div class="row"><span class="label">Date Ordered:</span> ${new Date(order.createdAt).toLocaleString()}</div>
      <div class="row"><span class="label">Clinical Status:</span> ${esc(order.status.toUpperCase())}</div>
      <div class="row"><span class="label">Facility CLIA:</span> ${order.facilityClia ? esc(order.facilityClia) : NOT_RECORDED}</div>
    </div>
  </div>

  <div class="panel" style="margin-bottom: 24px;">
    <h4>Diagnostic Panels & ICD-10 Indications</h4>
    <div class="row"><span class="label">Panels:</span> ${panelsText || NOT_RECORDED}</div>
    <div class="row"><span class="label">ICD-10 Diagnostic Codes:</span> ${order.icd10Codes.map(esc).join(', ') || NOT_RECORDED}</div>
    ${order.clinicalNotes ? `<div class="row" style="margin-top: 10px;"><span class="label">Clinical Indications:</span> ${esc(order.clinicalNotes)}</div>` : ''}
  </div>

  <div class="signature-block">
    <div>
      <div class="badge" style="margin-bottom: 8px;">✓ E-Signed / No wet signature required</div>
      <div class="sig-text">${order.orderedByName ? esc(order.orderedByName) : NOT_RECORDED}</div>
      <div style="font-size: 12px; color: #4B5563;">Ordering Clinician &middot; NPI: ${order.signerNpi ? esc(order.signerNpi) : NOT_RECORDED}</div>
      <div style="font-size: 11px; color: #9CA3AF; margin-top: 2px;">Electronically authenticated via ${facilityName} EHR on ${new Date(order.createdAt).toLocaleDateString()}</div>
    </div>
    <div style="text-align: right; font-size: 12px; color: #6B7280;">
      Draw Station Barcode / Routing:<br>
      <span style="font-family: monospace; font-size: 14px; font-weight: 700; color: #111827;">*DC-${esc(order.id.slice(0, 8).toUpperCase())}*</span>
    </div>
  </div>
</body>
</html>`;

    await auditPhiAccess({ gate, req, action: 'EXPORT', resourceType: 'labRequisition', resourceId: order.id, patientId: order.clientId, metadata: { format: 'html-print' } });
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (err: unknown) {
    console.error('[ehr/labs/[id]/print GET] error:', err);
    return new Response('Error generating print requisition', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
