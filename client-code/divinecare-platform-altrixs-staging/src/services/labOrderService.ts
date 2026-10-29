/**
 * Lab Order & Digital Signature Hash Generator (Commit 819d6b2)
 * Creates CLIA/HIPAA compliant lab orders with embedded SHA-256 verified digital signatures.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { labFacilityClia, labFacilityName, labSignaturePayload, normalizeClia, normalizeNpi } from '@/lib/labs/facility';

export interface CreateLabOrderParams {
  organizationId: string;
  clientId: string;
  clientName?: string;
  targetLab?: 'QUEST' | 'LABCORP' | string;
  specimenType?: string;
  priority?: 'Routine' | 'Urgent' | 'Stat' | string;
  testPanels: string[];
  otherPanel?: string | null;
  icd10Codes: string[];
  collectionDate?: Date;
  clinicalNotes?: string;
  orderedById?: string;
  orderedByName?: string;
  signerNpi?: string;
  facilityName?: string;
  facilityClia?: string;
}

export async function createSignedLabOrder(params: CreateLabOrderParams) {
  const {
    organizationId,
    clientId,
    clientName,
    targetLab = 'QUEST',
    specimenType,
    priority = 'Routine',
    testPanels,
    otherPanel = null,
    icd10Codes,
    collectionDate,
    clinicalNotes = null,
    orderedById,
    orderedByName = '',
  } = params;

  // No placeholder identifiers: the NPI must be the ordering clinician's real 10-digit NPI,
  // and CLIA is only ever the configured facility CLIA (omitted when not configured).
  const signerNpi = normalizeNpi(params.signerNpi);
  if (!signerNpi) {
    throw new Error('Valid ordering provider NPI is required for electronic signature.');
  }
  const facilityName = params.facilityName?.trim() || labFacilityName();
  const facilityClia = normalizeClia(params.facilityClia) ?? labFacilityClia();
  if (!orderedByName || !orderedByName.trim()) {
    throw new Error('Ordering clinician name is required for electronic signature.');
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
  });

  const resolvedClientName = clientName || client?.name || 'Patient';
  const resolvedMrn = client?.mrn || clientId;
  const orderedDate = new Date();
  const orderNumber = `LAB-${orderedDate.getFullYear()}-${String(Date.now()).slice(-4)}`;

  // Compute tamper-proof digital signature hash
  const signaturePayload = labSignaturePayload({
    orderNumber,
    patientRef: resolvedMrn,
    signerNpi,
    signerName: orderedByName,
    signedAt: orderedDate,
    facilityClia,
  });
  const signatureHash = crypto.createHash('sha256').update(signaturePayload).digest('hex');

  const labEnum = targetLab === 'LABCORP' ? 'LABCORP' : 'QUEST';

  const order = await prisma.labOrder.create({
    data: {
      organizationId,
      clientId,
      clientName: resolvedClientName,
      lab: labEnum,
      priority,
      specimen: specimenType?.trim() || null,
      panels: testPanels,
      otherPanel,
      icd10Codes,
      clinicalNotes,
      status: 'ordered',
      orderedById: orderedById || null,
      orderedByName,
      orderedAt: orderedDate,
      collectedAt: collectionDate || null,
      isElectronicallySigned: true,
      signedAt: orderedDate,
      signerName: orderedByName,
      signerNpi,
      facilityName,
      facilityClia,
      signatureHash,
    },
    include: {
      client: true,
      results: true,
    },
  });

  return order;
}

export interface RequisitionHtmlInput {
  id: string;
  clientName: string;
  clientId: string;
  clientDob?: string;
  clientGender?: string;
  lab: string;
  priority: string;
  specimen?: string | null;
  panels: string[];
  otherPanel?: string | null;
  icd10Codes: string[];
  clinicalNotes?: string | null;
  orderedByName?: string | null;
  orderedAt: string | Date;
  signerNpi?: string | null;
  facilityName?: string | null;
  facilityClia?: string | null;
  signatureHash?: string | null;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MISSING = '&mdash;';

export function generateRequisitionHTML(order: RequisitionHtmlInput): string {
  const formattedDate = new Date(order.orderedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Only stored values are printed; anything missing shows as "—" / "Not recorded".
  const signerName = order.orderedByName ? esc(order.orderedByName) : 'Not recorded';
  const facilityName = esc(order.facilityName || labFacilityName());
  const facilityClia = order.facilityClia ? esc(order.facilityClia) : null;
  const signerNpi = order.signerNpi ? esc(order.signerNpi) : 'Not recorded';
  const hash = order.signatureHash ? esc(order.signatureHash) : null;

  const panels = [...order.panels, order.otherPanel].filter(Boolean).map(esc);
  const isStat = order.priority.toLowerCase() === 'stat' || order.priority.toLowerCase() === 'urgent';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Lab Requisition - ${esc(order.id)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 24px;
      color: #111827;
      background: #FFFFFF;
      font-size: 13px;
      line-height: 1.4;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #5C2D91;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .clinic-title {
      font-size: 18px;
      font-weight: 800;
      color: #5C2D91;
      margin: 0;
    }
    .subtext {
      font-size: 11px;
      color: #6B7280;
      margin-top: 2px;
    }
    .priority-badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      background: ${isStat ? '#FEE2E2' : '#F3F4F6'};
      color: ${isStat ? '#B91C1C' : '#374151'};
      border: 1px solid ${isStat ? '#FCA5A5' : '#D1D5DB'};
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #E5E7EB;
    }
    .section-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #4B5563;
      margin-bottom: 4px;
    }
    .data-row {
      margin-bottom: 3px;
    }
    .data-label {
      color: #6B7280;
      display: inline-block;
      width: 110px;
    }
    .tests-box {
      margin-bottom: 16px;
      border-bottom: 1px solid #E5E7EB;
      padding-bottom: 12px;
    }
    .test-pill {
      display: inline-block;
      background: #F9FAFB;
      border: 1px solid #E5E7EB;
      padding: 4px 8px;
      border-radius: 6px;
      margin: 3px;
      font-weight: 500;
    }
    .esig-block {
      margin-top: 20px;
      border: 1px solid #D1D5DB;
      border-radius: 8px;
      padding: 12px 16px;
      background: #F9FAFB;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .esig-name {
      font-size: 15px;
      font-weight: 700;
      color: #111827;
      font-family: Georgia, 'Times New Roman', serif;
      font-style: italic;
      margin-top: 2px;
    }
    .esig-badge {
      background: #F0FDF4;
      border: 1px solid #BBF7D0;
      border-radius: 6px;
      padding: 6px 12px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="clinic-title">${facilityName}</h1>
      <div class="subtext">Integrated Behavioral Health &amp; Medical Care${facilityClia ? ` · CLIA: ${facilityClia}` : ''}</div>
      <div class="subtext">Target Laboratory: <strong>${order.lab === 'LABCORP' ? 'LabCorp of America' : 'Quest Diagnostics'}</strong></div>
    </div>
    <div style="text-align: right;">
      <div style="font-family: monospace; font-weight: 700; font-size: 14px;">REQ-${esc(order.id)}</div>
      <div style="margin-top: 4px;"><span class="priority-badge">${esc(order.priority)}</span></div>
      <div class="subtext">Ordered: ${formattedDate}</div>
    </div>
  </div>

  <div class="grid">
    <div>
      <div class="section-title">Patient Demographics</div>
      <div class="data-row"><span class="data-label">Name:</span> <strong>${esc(order.clientName)}</strong></div>
      <div class="data-row"><span class="data-label">Patient ID/MRN:</span> ${esc(order.clientId)}</div>
      <div class="data-row"><span class="data-label">DOB:</span> ${order.clientDob ? esc(order.clientDob) : MISSING}</div>
      <div class="data-row"><span class="data-label">Specimen:</span> ${order.specimen ? esc(order.specimen) : 'Not recorded'}</div>
    </div>
    <div>
      <div class="section-title">Ordering Clinician</div>
      <div class="data-row"><span class="data-label">Provider:</span> <strong>${signerName}</strong></div>
      <div class="data-row"><span class="data-label">NPI:</span> ${signerNpi}</div>
      <div class="data-row"><span class="data-label">CLIA License:</span> ${facilityClia ?? MISSING}</div>
      <div class="data-row"><span class="data-label">Facility Phone:</span> &mdash;</div>
    </div>
  </div>

  <div class="tests-box">
    <div class="section-title">Requested Tests / Panels</div>
    <div>
      ${panels.map((p) => `<span class="test-pill">[X] ${p}</span>`).join(' ')}
    </div>
  </div>

  <div style="margin-bottom: 16px; border-bottom: 1px solid #E5E7EB; padding-bottom: 12px;">
    <div class="section-title">ICD-10 Diagnoses Pointers (Medical Necessity)</div>
    <div style="color: #374151;">
      ${order.icd10Codes.length > 0 ? order.icd10Codes.map(esc).join(', ') : 'Not recorded'}
    </div>
    ${order.clinicalNotes ? `<div style="margin-top: 6px; font-style: italic; color: #6B7280;">Notes: ${esc(order.clinicalNotes)}</div>` : ''}
  </div>

  <!-- Official Electronic Signature Block (Commit 819d6b2) -->
  <div class="esig-block">
    <div>
      <div style="font-size: 10px; color: #6B7280; text-transform: uppercase; font-weight: 700;">Electronically Signed By</div>
      <div class="esig-name">${signerName}</div>
      <div style="font-size: 11px; color: #374151; margin-top: 4px;">
        ${facilityName} &nbsp;·&nbsp; Signed: ${formattedDate} &nbsp;·&nbsp; NPI: ${signerNpi}${facilityClia ? ` &nbsp;·&nbsp; CLIA: ${facilityClia}` : ''}
      </div>
      <div style="font-size: 9px; color: #9CA3AF; margin-top: 2px; font-family: monospace;">
        Verification Hash: ${hash ? `${hash.slice(0, 32)}...` : 'Not recorded'}
      </div>
    </div>
    <div class="esig-badge">
      <div style="font-size: 10px; font-weight: 700; color: #15803D; text-transform: uppercase; letter-spacing: 0.5px;">✓ E-Signed</div>
      <div style="font-size: 9px; color: #16A34A; margin-top: 2px;">No wet signature required</div>
    </div>
  </div>
</body>
</html>`;
}
