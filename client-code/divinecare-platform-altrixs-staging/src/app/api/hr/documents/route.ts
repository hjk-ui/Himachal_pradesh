import { NextResponse } from 'next/server';
import { canSeeDocument, HR_DOC_CATEGORIES, listHrDocuments, storeHrDocument } from '@/lib/hr/documents';
import { loadEmployee } from '@/lib/hr/people';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';
import { isHrAdminRole } from '@/lib/hr/standard';

export const runtime = 'nodejs';

/** GET /api/hr/documents?userId=: documents the viewer may see for that person (default: self). */
export async function GET(req: Request) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  const userId = new URL(req.url).searchParams.get('userId') || g.ctx.userId;
  try {
    const view = await loadEmployee(g.ctx, userId);
    if (!view) return hrJsonError('Employee not found', 404);
    const docs = (await listHrDocuments(g.ctx.organizationId, userId)).filter((d) =>
      canSeeDocument({ userId: g.ctx.userId, relationship: view.relationship, access: view.access }, d),
    );
    if (userId !== g.ctx.userId) await auditHr(g.ctx, req, 'LIST', 'hrDocument', userId, { count: docs.length });
    return NextResponse.json({ success: true, documents: docs, categories: HR_DOC_CATEGORIES });
  } catch (err) {
    return hrServerError('documents', err);
  }
}

/**
 * POST /api/hr/documents (multipart: file, userId, category, title, expiresOn, visibleToEmployee,
 * restricted): HR / leadership / Office Manager upload for anyone; staff upload their own
 * (pending HR review).
 */
export async function POST(req: Request) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return hrJsonError('Choose a file', 400);
    const userId = String(form.get('userId') || g.ctx.userId);
    const category = String(form.get('category') || 'other');
    if (!HR_DOC_CATEGORIES.some((c) => c.key === category)) return hrJsonError('Unknown document type', 400);
    const admin = isHrAdminRole(g.ctx.role);
    const om = g.ctx.role === 'OFFICE_MANAGER';
    const selfService = !admin && !om;
    if (om && !['license', 'certificate', 'training', 'health'].includes(category)) return hrJsonError('Office Manager uploads credential documents only', 403);
    const result = await storeHrDocument(g.ctx, {
      userId,
      category,
      title: String(form.get('title') || file.name),
      file,
      expiresOn: (form.get('expiresOn') as string) || null,
      visibleToEmployee: form.get('visibleToEmployee') == null ? undefined : form.get('visibleToEmployee') === 'true',
      restricted: admin && form.get('restricted') === 'true',
      selfService,
    });
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'UPLOAD', 'hrDocument', result.id, { staffUserId: userId, category, selfService });
    return NextResponse.json({ success: true, id: result.id }, { status: 201 });
  } catch (err) {
    return hrServerError('document upload', err);
  }
}
