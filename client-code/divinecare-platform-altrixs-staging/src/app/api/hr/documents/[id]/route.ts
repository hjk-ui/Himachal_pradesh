import { NextResponse } from 'next/server';
import { z } from 'zod';
import { archiveHrDocument, canSeeDocument, readHrDocument, updateHrDocument } from '@/lib/hr/documents';
import { loadEmployee } from '@/lib/hr/people';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

/** GET: download (visibility re-checked; every read audited). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  try {
    const found = await readHrDocument(g.ctx.organizationId, id);
    if (!found || found.doc.status === 'archived') return hrJsonError('Not found', 404);
    const view = await loadEmployee(g.ctx, found.doc.userId);
    if (!view || !canSeeDocument({ userId: g.ctx.userId, relationship: view.relationship, access: view.access }, found.doc)) {
      await auditHr(g.ctx, req, 'READ', 'hrDocument', id, { staffUserId: found.doc.userId }, 'DENIED');
      return hrJsonError('Not found', 404);
    }
    if (!found.bytes) return hrJsonError('The file is missing on this server', 410);
    await auditHr(g.ctx, req, 'READ', 'hrDocument', id, { staffUserId: found.doc.userId, category: found.doc.category });
    return new NextResponse(new Uint8Array(found.bytes), {
      headers: {
        'Content-Type': found.doc.mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${found.doc.fileName.replace(/[^A-Za-z0-9._ -]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return hrServerError('document read', err);
  }
}

const patchSchema = z.object({
  status: z.enum(['active', 'pending_review']).optional(),
  expiresOn: z.string().trim().max(10).optional().nullable(),
  visibleToEmployee: z.boolean().optional(),
  restricted: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

/** PATCH: HR accepts a self-service upload, sets expiry / visibility. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return hrJsonError('Invalid update', 400);
  }
  try {
    const result = await updateHrDocument(g.ctx, id, body);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'UPDATE', 'hrDocument', id, { staffUserId: result.userId, fields: Object.keys(body) });
    return NextResponse.json({ success: true });
  } catch (err) {
    return hrServerError('document update', err);
  }
}

/** DELETE: archive (row kept, file removed). HR / leadership. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  try {
    const result = await archiveHrDocument(g.ctx, id);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'DELETE', 'hrDocument', id, { staffUserId: result.userId });
    return NextResponse.json({ success: true });
  } catch (err) {
    return hrServerError('document archive', err);
  }
}
