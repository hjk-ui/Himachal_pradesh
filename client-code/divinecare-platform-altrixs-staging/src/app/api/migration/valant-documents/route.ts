import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { requireImportGate, type OrgGate } from '@/lib/migration/referenceImport';
import { multipartPartSize } from '@/lib/migration/valantDocumentsUpload';
import {
  batchDto,
  claimBatch,
  isValantDocsS3Configured,
  runValantDocBatch,
  sourceZipKey,
  valantDocsBucket,
  valantDocsS3,
  type Phase,
} from '@/lib/migration/valantDocumentsJob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Valant documents ZIP import (Admin → Data import → Valant documents). Practice Director / Admin only.
 *
 *   GET                       recent batches + whether browser upload (S3) is available
 *   GET ?id=                  one batch (the page polls this for progress)
 *   POST create               start an S3 multipart upload of the ZIP (migration/valant-docs/<id>/source.zip)
 *   POST sign-parts           presigned PUT URLs for upload parts (browser uploads straight to S3)
 *   POST list-parts           parts already uploaded (resume an interrupted upload with the same file)
 *   POST complete | abort     finish or cancel the multipart upload
 *   POST dry-run              report only; writes no documents
 *   POST apply                after a dry run: import (exact matches filed, the rest to the review queue)
 *   POST rematch              after an import: re-run with the updated matching (files review-queue
 *                             documents whose folder now matches, imports entries unreadable before;
 *                             never duplicates)
 *   POST resume               continue a stale or failed run where it stopped
 *
 * Processing runs on the server in the background; nothing here returns file contents or names.
 */

const MAX_ZIP_BYTES = 60 * 1024 ** 3; // 60 GB

const optionsSchema = z
  .object({
    allowNameOnly: z.boolean().optional(),
    ocrForSearch: z.boolean().optional(),
    wrapperDepth: z.number().int().min(0).max(5).nullable().optional(),
    use7z: z.boolean().optional(),
  })
  .optional();

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    fileName: z.string().min(1).max(255),
    fileSize: z.number().int().positive().max(MAX_ZIP_BYTES),
    options: optionsSchema,
  }),
  z.object({ action: z.literal('sign-parts'), id: z.string().uuid(), partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(100) }),
  z.object({ action: z.literal('list-parts'), id: z.string().uuid() }),
  z.object({
    action: z.literal('complete'),
    id: z.string().uuid(),
    parts: z.array(z.object({ partNumber: z.number().int().min(1).max(10000), etag: z.string().min(1).max(200) })).min(1).max(10000),
  }),
  z.object({ action: z.literal('abort'), id: z.string().uuid() }),
  z.object({ action: z.literal('dry-run'), id: z.string().uuid(), options: optionsSchema }),
  z.object({ action: z.literal('apply'), id: z.string().uuid(), confirm: z.literal(true) }),
  z.object({ action: z.literal('rematch'), id: z.string().uuid(), confirm: z.literal(true) }),
  z.object({ action: z.literal('resume'), id: z.string().uuid() }),
]);

const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

export async function GET(req: Request) {
  const g = await requireImportGate('Valant documents');
  if (g.denied) return g.denied;
  const { gate } = g;
  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    const b = await prisma.valantDocImportBatch.findFirst({ where: { id, organizationId: gate.organizationId } });
    if (!b) return fail('Import not found', 404);
    return NextResponse.json({ success: true, batch: batchDto(b) });
  }
  const rows = await prisma.valantDocImportBatch.findMany({
    where: { organizationId: gate.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return NextResponse.json({ success: true, s3Configured: isValantDocsS3Configured(), batches: rows.map(batchDto) });
}

function start(batchId: string, phase: Phase, gate: OrgGate) {
  // Long-running: continues after the response; progress is saved on the batch row
  void runValantDocBatch(batchId, phase, { userId: gate.userId, role: String(gate.role) });
}

export async function POST(req: Request) {
  const g = await requireImportGate('Valant documents');
  if (g.denied) return g.denied;
  const { gate } = g;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Invalid request');
  const body = parsed.data;

  const audit = (action: string, resourceId: string, metadata?: Record<string, unknown>) =>
    writeAuditLog({
      action,
      actorUserId: gate.userId,
      actorRole: String(gate.role),
      organizationId: gate.organizationId,
      resourceType: 'valantDocImportBatch',
      resourceId,
      metadata,
      ...auditRequestMeta(req),
    });

  try {
    if (body.action === 'create') {
      if (!isValantDocsS3Configured()) {
        return fail(
          'Browser upload needs S3 (DOC_INTAKE_S3_BUCKET or VALANT_IMPORT_S3_BUCKET and AWS credentials). Upload the ZIP with the AWS CLI and run scripts/import-valant-documents.ts instead.',
          503
        );
      }
      const bucket = valantDocsBucket();
      const batch = await prisma.valantDocImportBatch.create({
        data: {
          organizationId: gate.organizationId,
          status: 'uploading',
          sourceKind: 's3',
          sourceBucket: bucket,
          sourceKey: 'pending',
          fileName: body.fileName.replace(/[^\w .()-]/g, '_').slice(0, 200),
          fileSize: BigInt(body.fileSize),
          options: (body.options ?? {}) as Prisma.InputJsonValue,
          ocrForSearch: Boolean(body.options?.ocrForSearch),
          createdById: gate.userId,
        },
      });
      const key = sourceZipKey(batch.id);
      const mp = await valantDocsS3().send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: 'application/zip', ServerSideEncryption: 'AES256' })
      );
      if (!mp.UploadId) throw new Error('S3 returned no upload id');
      const updated = await prisma.valantDocImportBatch.update({ where: { id: batch.id }, data: { sourceKey: key, uploadId: mp.UploadId } });
      const partSize = multipartPartSize(body.fileSize);
      await audit('VALANT_DOCS_UPLOAD_START', batch.id, { sizeBytes: body.fileSize });
      return NextResponse.json({ success: true, batch: batchDto(updated), partSize, partCount: Math.ceil(body.fileSize / partSize) });
    }

    const batch = await prisma.valantDocImportBatch.findFirst({ where: { id: body.id, organizationId: gate.organizationId } });
    if (!batch) return fail('Import not found', 404);
    const bucket = batch.sourceBucket || valantDocsBucket();

    if (body.action === 'sign-parts' || body.action === 'list-parts' || body.action === 'complete' || body.action === 'abort') {
      if (batch.status !== 'uploading' || !batch.uploadId || batch.sourceKind !== 's3') return fail('This upload is not in progress', 409);
      const base = { Bucket: bucket, Key: batch.sourceKey, UploadId: batch.uploadId };

      if (body.action === 'sign-parts') {
        const s3 = valantDocsS3();
        const urls = await Promise.all(
          body.partNumbers.map(async (n) => ({
            partNumber: n,
            url: await getSignedUrl(s3, new UploadPartCommand({ ...base, PartNumber: n }), { expiresIn: 3600 }),
          }))
        );
        return NextResponse.json({ success: true, urls });
      }

      if (body.action === 'list-parts') {
        const parts: { partNumber: number; etag: string; size: number }[] = [];
        let marker: string | undefined;
        do {
          const r = await valantDocsS3().send(new ListPartsCommand({ ...base, PartNumberMarker: marker, MaxParts: 1000 }));
          for (const p of r.Parts ?? []) if (p.PartNumber && p.ETag) parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: Number(p.Size ?? 0) });
          marker = r.IsTruncated ? r.NextPartNumberMarker : undefined;
        } while (marker);
        return NextResponse.json({ success: true, parts });
      }

      if (body.action === 'abort') {
        await valantDocsS3().send(new AbortMultipartUploadCommand(base)).catch(() => {});
        await prisma.valantDocImportBatch.update({ where: { id: batch.id }, data: { status: 'failed', uploadId: null, error: 'Upload cancelled' } });
        await audit('VALANT_DOCS_UPLOAD_ABORT', batch.id);
        return NextResponse.json({ success: true });
      }

      // complete
      const parts = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);
      await valantDocsS3().send(
        new CompleteMultipartUploadCommand({
          ...base,
          MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
        })
      );
      const head = await valantDocsS3().send(new HeadObjectCommand({ Bucket: bucket, Key: batch.sourceKey }));
      const size = Number(head.ContentLength ?? 0);
      if (batch.fileSize !== null && size !== Number(batch.fileSize)) {
        await prisma.valantDocImportBatch.update({ where: { id: batch.id }, data: { status: 'failed', uploadId: null, error: 'Uploaded size does not match the file' } });
        return fail('The uploaded size does not match the file. Upload it again.', 409);
      }
      const done = await prisma.valantDocImportBatch.update({ where: { id: batch.id }, data: { status: 'uploaded', uploadId: null } });
      await audit('VALANT_DOCS_UPLOAD_COMPLETE', batch.id, { sizeBytes: size });
      return NextResponse.json({ success: true, batch: batchDto(done) });
    }

    if (body.action === 'dry-run') {
      if (body.options) {
        await prisma.valantDocImportBatch.updateMany({
          where: { id: batch.id, status: { in: ['uploaded', 'dry_run_done', 'failed'] } },
          data: { options: body.options as Prisma.InputJsonValue, ocrForSearch: Boolean(body.options.ocrForSearch) },
        });
      }
      if (!(await claimBatch(batch.id, gate.organizationId, 'dry_run'))) return fail('A dry run can start only after the upload, and not while a run is in progress', 409);
      await audit('VALANT_DOCS_DRY_RUN_START', batch.id);
      start(batch.id, 'dry_run', gate);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'apply') {
      if (!(await claimBatch(batch.id, gate.organizationId, 'apply'))) return fail('Run a dry run first (and wait for it to finish)', 409);
      await audit('VALANT_DOCS_APPLY_START', batch.id);
      start(batch.id, 'apply', gate);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'rematch') {
      if (!(await claimBatch(batch.id, gate.organizationId, 'rematch'))) return fail('A re-run can start only after the import has finished (or stopped)', 409);
      await audit('VALANT_DOCS_REMATCH_START', batch.id);
      start(batch.id, 'rematch', gate);
      return NextResponse.json({ success: true });
    }

    // resume
    const phase: Phase =
      batch.phase === 'rematch' || batch.status === 'rematching'
        ? 'rematch'
        : batch.phase === 'apply' || batch.status === 'applying'
          ? 'apply'
          : 'dry_run';
    if (!(await claimBatch(batch.id, gate.organizationId, phase))) return fail('Nothing to resume: the run is still active or already finished', 409);
    await audit('VALANT_DOCS_RESUME', batch.id, { phase });
    start(batch.id, phase, gate);
    return NextResponse.json({ success: true, phase });
  } catch (err) {
    console.error('[valant-docs] request failed:', err instanceof Error ? err.name : 'unknown');
    return fail('The request could not be completed', 500);
  }
}
