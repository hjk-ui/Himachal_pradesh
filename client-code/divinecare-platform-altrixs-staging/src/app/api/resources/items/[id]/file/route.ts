import { NextResponse } from 'next/server';
import { readItemFile, storeItemFile, ResourceError } from '@/lib/resources/store';
import { UPLOAD_MAX_BYTES } from '@/lib/resources/types';
import { auditPhiAccessResource, errorResponse, fail, ok, resourceGate } from '../../../_shared';

export const runtime = 'nodejs';

const safeName = (n: string) => n.replace(/["\\\r\n]/g, '');

/** GET: download the practice-uploaded handout (staff). Audited. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await resourceGate();
  if (g.ok === false) return g.res;
  try {
    const file = await readItemFile(g.actor, id);
    await auditPhiAccessResource(g.gate, req, { action: 'RESOURCE_FILE_DOWNLOAD', resourceType: 'resourceItem', resourceId: id, metadata: { bytes: file.bytes.length } });
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': file.mime,
        'Content-Disposition': `attachment; filename="${safeName(file.name)}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    if (e instanceof ResourceError) {
      await auditPhiAccessResource(g.gate, req, { action: 'RESOURCE_FILE_DOWNLOAD', resourceType: 'resourceItem', resourceId: id, outcome: e.status === 403 ? 'DENIED' : 'FAILURE' });
    }
    return errorResponse(e, 'Could not download the file');
  }
}

/** POST multipart (field "file"): attach the handout file (PDF / PNG / JPEG, 10 MB). Needs a fresh clinical review. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await resourceGate();
  if (g.ok === false) return g.res;
  try {
    const len = Number(req.headers.get('content-length') || 0);
    if (len > UPLOAD_MAX_BYTES + 64 * 1024) return fail('Files must be 10 MB or smaller', 413);
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('Choose a file to upload', 400);
    const item = await storeItemFile(g.actor, id, { bytes: Buffer.from(await file.arrayBuffer()), name: file.name });
    await auditPhiAccessResource(g.gate, req, { action: 'RESOURCE_FILE_UPLOAD', resourceType: 'resourceItem', resourceId: id, metadata: { bytes: item.fileSize, mime: item.fileMime } });
    return ok({ item });
  } catch (e) {
    return errorResponse(e, 'Could not upload the file');
  }
}
