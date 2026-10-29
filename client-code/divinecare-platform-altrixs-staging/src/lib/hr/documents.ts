/**
 * Employee documents. Files are stored under UPLOADS_DIR/hr-documents (outside public/) and are
 * served only by GET /api/hr/documents/[id], which re-checks visibility and writes an audit row.
 * I-9 identity document images are refused unless HR settings allow them (practice policy).
 */
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { dateOnlyValue, ymd, type HrFieldAccess } from './standard';
import { assertOrgUser, isMissingTable, loadHrSettings, type HrCtx } from './server';

const ROOT = process.env.UPLOADS_DIR || path.join(process.cwd(), 'private-uploads');
const DIR = path.join(ROOT, 'hr-documents');
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
export const MAX_HR_DOC_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const HR_DOC_CATEGORIES = [
  { key: 'offer_letter', label: 'Offer letter' },
  { key: 'license', label: 'License / registration' },
  { key: 'certificate', label: 'Certificate' },
  { key: 'training', label: 'Training certificate' },
  { key: 'health', label: 'TB / immunization record' },
  { key: 'policy_ack', label: 'Signed policy' },
  { key: 'i9', label: 'I-9 (completion record)' },
  { key: 'payroll_form', label: 'Payroll form (W-4 / MW507 copy)' },
  { key: 'performance', label: 'Performance' },
  { key: 'discipline', label: 'Corrective action' },
  { key: 'separation', label: 'Separation' },
  { key: 'other', label: 'Other' },
] as const;

/** Categories Office Manager may see (credentialing work only). */
const OM_CATEGORIES = new Set(['license', 'certificate', 'training', 'health']);

export function canSeeDocument(
  viewer: { userId: string; relationship: string; access: HrFieldAccess },
  doc: { userId: string; category: string; restricted: boolean; visibleToEmployee: boolean },
) {
  if (viewer.relationship === 'hr' || viewer.relationship === 'leadership') return true;
  if (doc.restricted) return false;
  if (viewer.relationship === 'office_manager') return OM_CATEGORIES.has(doc.category);
  if (viewer.relationship === 'self') return doc.visibleToEmployee && doc.category !== 'discipline';
  return false;
}

export async function storeHrDocument(
  ctx: HrCtx,
  input: {
    userId: string;
    category: string;
    title: string;
    file: File;
    expiresOn?: string | null;
    visibleToEmployee?: boolean;
    restricted?: boolean;
    selfService: boolean;
  },
) {
  if (input.selfService && input.userId !== ctx.userId) return { ok: false as const, status: 403, error: 'You can only upload your own documents' };
  const staff = await assertOrgUser(ctx.organizationId, input.userId);
  if (!staff) return { ok: false as const, status: 404, error: 'Staff member not found' };
  if (input.file.size > MAX_HR_DOC_BYTES) return { ok: false as const, status: 400, error: 'File must be under 10 MB' };
  const typeOk = ALLOWED.has(input.file.type) || /\.(pdf|png|jpe?g|webp|docx?)$/i.test(input.file.name);
  if (!typeOk) return { ok: false as const, status: 400, error: 'Use PDF, Word or an image' };
  if (input.category === 'i9') {
    const settings = await loadHrSettings(ctx.organizationId);
    if (!settings.i9StoreDocumentImages) {
      return { ok: false as const, status: 400, error: 'Practice policy: identity documents for the I-9 are not stored in Altrixs. Record completion on the compliance tab instead.' };
    }
  }
  await mkdir(DIR, { recursive: true });
  const ext = (path.extname(input.file.name || '').slice(0, 8) || '.bin').replace(/[^.A-Za-z0-9]/g, '');
  const storedName = `${randomBytes(16).toString('hex')}${ext}`;
  await writeFile(path.join(DIR, storedName), Buffer.from(await input.file.arrayBuffer()));
  const restricted = input.selfService ? false : Boolean(input.restricted) || input.category === 'discipline';
  const row = await prisma.hrDocument.create({
    data: {
      organizationId: ctx.organizationId,
      userId: input.userId,
      category: input.category,
      title: input.title.trim().slice(0, 200) || input.file.name,
      fileName: (input.file.name || storedName).slice(0, 200),
      storedName,
      mimeType: input.file.type || null,
      sizeBytes: input.file.size,
      expiresOn: dateOnlyValue(input.expiresOn ?? null),
      visibleToEmployee: input.selfService ? true : input.visibleToEmployee ?? !restricted,
      restricted,
      source: input.selfService ? 'self_service' : 'hr',
      status: input.selfService ? 'pending_review' : 'active',
      uploadedById: ctx.userId,
      uploadedByName: ctx.name,
    },
  });
  return { ok: true as const, id: row.id };
}

export async function listHrDocuments(organizationId: string, userId: string) {
  try {
    const rows = await prisma.hrDocument.findMany({ where: { organizationId, userId, status: { not: 'archived' } }, orderBy: { createdAt: 'desc' } });
    return rows.map((d) => ({
      id: d.id,
      userId: d.userId,
      category: d.category,
      title: d.title,
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      expiresOn: ymd(d.expiresOn),
      visibleToEmployee: d.visibleToEmployee,
      restricted: d.restricted,
      source: d.source,
      status: d.status,
      uploadedByName: d.uploadedByName,
      createdAt: d.createdAt.toISOString(),
    }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export async function readHrDocument(organizationId: string, id: string) {
  const doc = await prisma.hrDocument.findFirst({ where: { id, organizationId } });
  if (!doc || !SAFE_NAME.test(doc.storedName)) return null;
  try {
    const bytes = await readFile(path.join(DIR, doc.storedName));
    return { doc, bytes };
  } catch {
    return { doc, bytes: null };
  }
}

export async function updateHrDocument(ctx: HrCtx, id: string, input: { status?: string; expiresOn?: string | null; visibleToEmployee?: boolean; restricted?: boolean; title?: string }) {
  const doc = await prisma.hrDocument.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!doc) return { ok: false as const, status: 404, error: 'Document not found' };
  await prisma.hrDocument.update({
    where: { id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.expiresOn !== undefined ? { expiresOn: dateOnlyValue(input.expiresOn) } : {}),
      ...(input.visibleToEmployee !== undefined ? { visibleToEmployee: input.visibleToEmployee } : {}),
      ...(input.restricted !== undefined ? { restricted: input.restricted } : {}),
      ...(input.title ? { title: input.title.slice(0, 200) } : {}),
    },
  });
  return { ok: true as const, userId: doc.userId };
}

/** Archive (soft delete) keeps the row for the audit trail; the file is removed. */
export async function archiveHrDocument(ctx: HrCtx, id: string) {
  const doc = await prisma.hrDocument.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!doc) return { ok: false as const, status: 404, error: 'Document not found' };
  await prisma.hrDocument.update({ where: { id }, data: { status: 'archived' } });
  if (SAFE_NAME.test(doc.storedName)) {
    await unlink(path.join(DIR, doc.storedName)).catch(() => undefined);
  }
  return { ok: true as const, userId: doc.userId };
}
