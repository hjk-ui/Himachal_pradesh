import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import {
  createIntakeDocument,
  detectFileType,
  MAX_UPLOAD_BYTES,
  ocrUnavailableReason,
} from '@/lib/docIntake/process';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/ehr/doc-intake/upload: multipart form with one `file` (PDF, JPEG or PNG, ≤ 20 MB).
 * Stores it privately, starts text extraction and returns the queue id. Classification and
 * patient matching finish in the background; nothing is filed until staff confirm.
 */
export async function POST(req: NextRequest) {
  const g = await requireOrgContext();
  if (!g.ok) return NextResponse.json({ success: false, error: g.error }, { status: g.status });
  if (!canAccessPath(g.role, '/dashboard/ehr/doc-intake')) {
    return NextResponse.json({ success: false, error: 'Not allowed to upload intake documents' }, { status: 403 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('file');
    file = f instanceof File ? f : null;
  } catch {
    return NextResponse.json({ success: false, error: 'Send the document as multipart form data' }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return NextResponse.json({ success: false, error: 'No file received' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ success: false, error: 'File is larger than 20 MB' }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectFileType(bytes);
  if (!type) {
    return NextResponse.json({ success: false, error: 'Only PDF, JPEG and PNG files are accepted' }, { status: 415 });
  }
  const unavailable = ocrUnavailableReason(type);
  if (unavailable) {
    return NextResponse.json({ success: false, error: unavailable }, { status: 503 });
  }

  try {
    const id = await createIntakeDocument({
      organizationId: g.organizationId,
      userId: g.userId,
      fileName: file.name || `upload.${type.ext}`,
      bytes,
      type,
    });
    await writeAuditLog({
      action: 'UPLOAD',
      actorUserId: g.userId,
      actorRole: String(g.role),
      organizationId: g.organizationId,
      resourceType: 'intakeDocument',
      resourceId: id,
      metadata: { mimeType: type.mime, sizeBytes: bytes.byteLength },
      ...auditRequestMeta(req),
    });
    return NextResponse.json({ success: true, id });
  } catch (err: unknown) {
    console.error('[doc-intake-upload] error:', err instanceof Error ? err.message.split('\n')[0] : 'unknown');
    return NextResponse.json({ success: false, error: 'The document could not be stored' }, { status: 500 });
  }
}
