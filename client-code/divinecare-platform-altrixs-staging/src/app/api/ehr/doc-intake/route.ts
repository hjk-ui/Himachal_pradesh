import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { advanceProcessing, reprocessDocument } from '@/lib/docIntake/process';
import { IntakeSplitError, splitExistingDocument, writeChildPdf } from '@/lib/docIntake/split';
import { docIntakeOrgWhere } from '@/lib/docIntake/queue';
import { BILLING_ARCHIVE_STATUS, canVoidImportedDocument } from '@/lib/migration/valantDocuments';

export const dynamic = 'force-dynamic';

/** Smart Document Intake queue for the caller's organization (shared with the inbox). */
const orgWhere = docIntakeOrgWhere;

async function gate() {
  const g = await requireOrgContext();
  if (!g.ok) return { error: NextResponse.json({ success: false, error: g.error }, { status: g.status }) } as const;
  if (!canAccessPath(g.role, '/dashboard/ehr/doc-intake')) {
    return { error: NextResponse.json({ success: false, error: 'Not allowed to use document intake' }, { status: 403 }) } as const;
  }
  return { g } as const;
}

export async function GET() {
  const a = await gate();
  if ('error' in a) return a.error;
  const { g } = a;

  try {
    // Move running OCR jobs forward; the page polls while anything is processing
    await advanceProcessing(g.organizationId).catch((err: unknown) =>
      console.error('[doc-intake] advance failed:', err instanceof Error ? err.message : 'unknown')
    );
    const docs = await prisma.documentIntake.findMany({
      // Bulk-imported records already filed (or voided) live in the chart, not in this queue; practice
      // billing records ('archived', no client) live in the billing archive (billing roles only)
      where: { AND: [orgWhere(g.organizationId), { NOT: { readOnly: true, status: { in: ['filed', 'voided', BILLING_ARCHIVE_STATUS] } } }] },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        readOnly: true,
        source: true,
        documentType: true,
        confidenceScore: true,
        suggestedClientId: true,
        suggestedFilingPath: true,
        s3RawKey: true,
        extractedFields: true,
        status: true,
        filedAt: true,
        createdAt: true,
        fileName: true,
        mimeType: true,
        pageCount: true,
        matchStatus: true,
        matchReason: true,
        matchCandidates: true,
        processingError: true,
        parentId: true,
        pageNumbers: true,
        parent: { select: { fileName: true, s3RawKey: true } },
        _count: { select: { children: true } },
        suggestedClient: { select: { name: true } },
      },
    });
    return NextResponse.json({
      success: true,
      data: docs.map(({ parent, _count, ...d }) => {
        const own = d.s3RawKey && d.s3RawKey !== 'pending' && d.fileName ? `/api/files/intake-docs/${d.s3RawKey}` : null;
        // A part of a split file has its own PDF only once filed; until then open the original at its first page
        const fromParent =
          !own && parent && parent.s3RawKey !== 'pending' && d.pageNumbers.length
            ? `/api/files/intake-docs/${parent.s3RawKey}#page=${d.pageNumbers[0]}`
            : null;
        return {
          ...d,
          parentFileName: parent?.fileName ?? null,
          childCount: _count.children,
          fileUrl: own ?? fromParent,
        };
      }),
    });
  } catch (err: unknown) {
    console.error('[doc-intake-get] error:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Failed to load document intake queue' }, { status: 500 });
  }
}

const fileActionSchema = z.object({
  id: z.string(),
  action: z.enum(['file', 'reject', 'changeClient', 'split', 'reprocess', 'void']),
  clientId: z.string().optional(),
  /** void: why an imported record is withdrawn from the chart (kept, never deleted) */
  reason: z.string().trim().min(5).max(500).optional(),
  clientName: z.string().optional(),
  filingDestination: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const a = await gate();
  if ('error' in a) return a.error;
  const { g } = a;

  try {
    const parsed = fileActionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
    }
    const { id, action, clientId, clientName, reason } = parsed.data;

    const doc = await prisma.documentIntake.findFirst({
      where: { id, ...orgWhere(g.organizationId) },
      select: {
        id: true, suggestedClientId: true, suggestedFilingPath: true, status: true, parentId: true, pageNumbers: true,
        readOnly: true,
      },
    });
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    // Imported records (Valant documents ZIP) are read-only. Waiting for review they can be filed,
    // moved to another client or rejected; once filed, only leadership can void them (with a reason).
    if (action === 'void') {
      if (!doc.readOnly) return NextResponse.json({ error: 'Only imported records can be voided' }, { status: 400 });
      if (!canVoidImportedDocument(String(g.role))) {
        return NextResponse.json({ error: 'Only Practice Director or Admin can void an imported record' }, { status: 403 });
      }
      if (!reason) return NextResponse.json({ error: 'Give a reason (at least 5 characters)' }, { status: 400 });
      const voided = await prisma.documentIntake.updateMany({
        where: { id, readOnly: true, status: { in: ['filed', 'ready'] } },
        data: { status: 'voided', voidedAt: new Date(), voidedById: g.userId, voidReason: reason },
      });
      if (voided.count !== 1) return NextResponse.json({ error: 'This record is already voided' }, { status: 409 });
      await writeAuditLog({
        action: 'VOID',
        actorUserId: g.userId,
        actorRole: String(g.role),
        organizationId: g.organizationId,
        resourceType: 'intakeDocument',
        resourceId: id,
        patientId: doc.suggestedClientId,
        metadata: { previousStatus: doc.status, readOnly: true },
        ...auditRequestMeta(req),
      });
      return NextResponse.json({ success: true, action: 'voided', message: 'Record voided. It is kept for the legal record and no longer shows in the chart.' });
    }
    if (doc.readOnly && (doc.status !== 'ready' || action === 'split' || action === 'reprocess')) {
      return NextResponse.json({ error: 'Imported records are read-only. Leadership can void one with a reason.' }, { status: 409 });
    }
    // The original of a split file holds several patients: it is never filed to one chart
    if (doc.status === 'split') {
      return NextResponse.json({ error: 'This file was split by patient. Review and file each part instead.' }, { status: 409 });
    }

    if (clientId) {
      const client = await prisma.client.findFirst({
        where: { id: clientId, organizationId: g.organizationId },
        select: { id: true },
      });
      if (!client) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const audit = (auditAction: string, patientId: string | null, metadata?: Record<string, unknown>) =>
      writeAuditLog({
        action: auditAction,
        actorUserId: g.userId,
        actorRole: String(g.role),
        organizationId: g.organizationId,
        resourceType: 'intakeDocument',
        resourceId: id,
        patientId,
        metadata,
        ...auditRequestMeta(req),
      });

    if (action === 'split') {
      const r = await splitExistingDocument(id, g.organizationId, { userId: g.userId, role: String(g.role) });
      if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ success: true, action: r.split ? 'split' : 'unchanged', message: r.message });
    }

    if (action === 'reprocess') {
      const r = await reprocessDocument(id, g.organizationId);
      if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
      await audit('REPROCESS', null);
      return NextResponse.json({ success: true, action: 'reprocessing', message: 'Reading the document again. This can take a few minutes.' });
    }

    if (action === 'file') {
      const target = clientId ?? doc.suggestedClientId;
      if (!target) return NextResponse.json({ error: 'Pick a client before filing' }, { status: 400 });
      if (doc.status === 'processing') {
        return NextResponse.json({ error: 'This document is still being processed' }, { status: 409 });
      }
      // A part of a split file is filed as a PDF of only its own pages, never the original
      let childFile: { s3RawKey: string; fileSize: number; mimeType: string } | null = null;
      if (doc.parentId) {
        try {
          const built = await writeChildPdf({ id: doc.id, parentId: doc.parentId, pageNumbers: doc.pageNumbers });
          childFile = { s3RawKey: built.storedName, fileSize: built.size, mimeType: 'application/pdf' };
        } catch (err) {
          if (err instanceof IntakeSplitError) return NextResponse.json({ error: err.message }, { status: 409 });
          throw err;
        }
      }
      await prisma.documentIntake.update({
        where: { id },
        data: {
          status: 'filed',
          filedAt: new Date(),
          filedByUserId: g.userId,
          suggestedClientId: target,
          organizationId: g.organizationId,
          matchStatus: 'confirmed',
          ...(childFile ?? {}),
        },
      });
      await audit(
        'FILE_TO_CHART',
        target,
        doc.parentId ? { parentId: doc.parentId, pages: doc.pageNumbers } : undefined
      );
      return NextResponse.json({
        success: true,
        action: 'filed',
        message: `Document filed to ${clientName || 'the chart'} (${doc.suggestedFilingPath}).`,
      });
    }

    if (action === 'reject') {
      await prisma.documentIntake.update({ where: { id }, data: { status: 'rejected' } });
      await audit('REJECT', doc.suggestedClientId);
      return NextResponse.json({ success: true, action: 'rejected', message: 'Document rejected and kept out of every chart.' });
    }

    if (action === 'changeClient' && clientId) {
      await prisma.documentIntake.update({
        where: { id },
        data: { suggestedClientId: clientId, matchStatus: 'staff_selected', organizationId: g.organizationId },
      });
      await audit('CHANGE_CLIENT', clientId);
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('[doc-intake-post] error:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Failed to update document intake' }, { status: 500 });
  }
}
