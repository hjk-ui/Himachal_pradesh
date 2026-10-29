import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientByIdWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { chartAttestationDocuments } from '@/lib/consents/carelon/store';
import { chartConsentDocuments } from '@/lib/consents/library/store2';
import { canAccessConsents } from '@/lib/consents/manage';
import { canManageCarelon } from '@/lib/consents/carelon/workflow';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { chartDocumentFilter } from '@/lib/docIntake/chartDocumentAccess';
import { canOpenChartDocuments, canVoidImportedDocument } from '@/lib/migration/valantDocuments';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function formatSize(bytes: number | null) {
  if (!bytes) return '—';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** GET /api/clients/[id]/documents: documents staff filed to this chart through Smart Document Intake */
export async function GET(req: NextRequest, { params }: Ctx) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  // Clinical chart roles, plus front office / billing for the document types they handle
  const ehrAccess = canAccessPath(gate.role, '/dashboard/ehr');
  if (!canOpenChartDocuments(String(gate.role), ehrAccess)) {
    return NextResponse.json({ success: false, error: 'Not allowed to view chart documents' }, { status: 403 });
  }

  const { id } = await params;
  const client = await prisma.client.findFirst({
    where: clientByIdWhere(id, gate.organizationId),
    select: { id: true },
  });
  if (!client) return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });

  // 42 CFR Part 2 / VIP lock: whitelist, break-glass or leadership only (logged)
  try {
    await assertClientPhiAccess({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientId: client.id,
      path: `/api/clients/${client.id}/documents`,
    });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) return NextResponse.json(err.body, { status: err.status });
    throw err;
  }

  const rows = await prisma.documentIntake.findMany({
    where: { suggestedClientId: client.id, status: 'filed' },
    orderBy: { filedAt: 'desc' },
    take: 2000,
    select: {
      source: true,
      readOnly: true,
      id: true,
      documentType: true,
      fileName: true,
      fileSize: true,
      filedAt: true,
      createdAt: true,
      s3RawKey: true,
      suggestedFilingPath: true,
      extractedFields: true,
    },
  });
  // Document types by role: receipts for billing / front desk / leadership; ID and demographics for
  // front office, billing, leadership and the care team; clinical types follow chart access
  const filter = chartDocumentFilter({ userId: gate.userId, organizationId: gate.organizationId, role: String(gate.role) }, client.id);
  const allowedTypes = new Map<string, boolean>();
  for (const t of new Set(rows.map((d) => d.documentType))) allowedTypes.set(t, await filter.canView(t));
  const docs = rows.filter((d) => allowedTypes.get(d.documentType));
  const canVoid = canVoidImportedDocument(String(gate.role));

  // Signed Carelon non-overlap attestations (download through their own audited PDF route)
  const attestations = ehrAccess && canManageCarelon(gate.role) ? await chartAttestationDocuments(gate.organizationId, client.id).catch(() => []) : [];
  // Signed consent packets (consent library; PDF through /api/consents/library/packets/[id]/pdf, audited)
  const packets = ehrAccess && canAccessConsents(gate.role) ? await chartConsentDocuments(gate.organizationId, client.id).catch(() => []) : [];

  await auditPhiAccess({
    gate,
    req,
    action: 'LIST',
    resourceType: 'chartDocuments',
    resourceId: client.id,
    patientId: client.id,
    metadata: { count: docs.length, hiddenByType: rows.length - docs.length, carelonAttestations: attestations.length, consentPackets: packets.length },
  });

  return NextResponse.json({
    success: true,
    documents: docs.map((d) => {
      const fields = Array.isArray(d.extractedFields) ? (d.extractedFields as Array<{ label?: string; value?: string }>) : [];
      const title = fields.find((f) => f.label === 'Title')?.value;
      const documentDate = fields.find((f) => f.label === 'Document date')?.value ?? null;
      return {
        id: d.id,
        name: title || d.fileName || d.documentType,
        category: d.documentType,
        size: formatSize(d.fileSize),
        uploadedAt: (d.filedAt ?? d.createdAt).toISOString().slice(0, 10),
        filesTo: d.suggestedFilingPath,
        url: d.s3RawKey && d.s3RawKey !== 'pending' && d.fileName ? `/api/files/intake-docs/${d.s3RawKey}` : null,
        documentDate,
        source: d.source,
        // Imported records (Valant): read-only; leadership may void with a reason
        readOnly: d.readOnly,
        canVoid: d.readOnly && canVoid,
      };
    }).concat(attestations, packets),
  });
}
