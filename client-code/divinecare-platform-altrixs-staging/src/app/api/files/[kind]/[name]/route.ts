import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireSession';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { canAccessCredentials } from '@/lib/hr/credentials';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { requirePatient } from '@/patient/application/auth/session';
import { isUploadKind, uploadPath, type UploadKind } from '@/lib/storage/privateUploads';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { chartDocumentFilter } from '@/lib/docIntake/chartDocumentAccess';
import { BILLING_ARCHIVE_STATUS, canViewBillingArchive, canVoidImportedDocument } from '@/lib/migration/valantDocuments';

export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

type StaffActor = { userId: string; organizationId: string | null; role: string };

/** Staff may see a file only within their own organization (credentials: HR roles or the owner). */
async function staffCanRead(
  kind: UploadKind,
  name: string,
  onActor?: (a: StaffActor) => void
): Promise<boolean | 'unauthenticated'> {
  const s = await requireSession();
  if (!s.ok) return 'unauthenticated';
  onActor?.({ userId: s.session.user.id, organizationId: s.organizationId ?? null, role: String(s.role) });
  const isSuperAdmin = s.role === 'SUPER_ADMIN';
  const orgId = s.organizationId;
  const stem = path.parse(name).name;

  if (kind === 'avatars') {
    const owner = await prisma.user.findUnique({ where: { id: stem }, select: { organizationId: true } });
    return !!owner && (isSuperAdmin || stem === s.session.user.id || (!!orgId && owner.organizationId === orgId));
  }

  if (kind === 'client-avatars') {
    if (isSuperAdmin) return !!(await prisma.client.findUnique({ where: { id: stem }, select: { id: true } }));
    if (!orgId) return false;
    return !!(await prisma.client.findFirst({ where: { id: stem, ...clientOrgFilter(orgId) }, select: { id: true } }));
  }

  if (kind === 'intake-docs') {
    // Intake documents: same organization and access to the intake queue or the matched chart
    const doc = await prisma.documentIntake.findFirst({
      where: { s3RawKey: name },
      select: {
        organizationId: true,
        status: true,
        documentType: true,
        suggestedClientId: true,
        suggestedClient: { select: { organizationId: true } },
      },
    });
    if (!doc) return false;
    if (isSuperAdmin) return true;
    const docOrg = doc.organizationId ?? doc.suggestedClient?.organizationId ?? null;
    if (!orgId || docOrg !== orgId) return false;
    const role = String(s.role);
    // A voided imported record: leadership only (kept for the legal record, out of the chart)
    if (doc.status === 'voided') return canVoidImportedDocument(role);
    // Practice billing archive (Valant ERA exceptions, claims, ...): billing roles and leadership; Office Manager reads
    if (doc.status === BILLING_ARCHIVE_STATUS) return canViewBillingArchive(role);
    if (doc.status !== 'filed' || !doc.suggestedClientId) return canAccessPath(role, '/dashboard/ehr');
    // Filed to a chart: the chart documents rules by type, and the Part 2 / VIP lock
    const filter = chartDocumentFilter({ userId: s.session.user.id, organizationId: orgId, role }, doc.suggestedClientId);
    if (!(await filter.canView(doc.documentType))) return false;
    try {
      await assertClientPhiAccess({ organizationId: orgId, userId: s.session.user.id, role, clientId: doc.suggestedClientId, path: `/api/files/intake-docs/${name}` });
    } catch (err) {
      if (err instanceof SensitiveRecordAccessError) return false;
      throw err;
    }
    return true;
  }

  // credentials: look the document up by the stored URL, never trust the file name alone
  const cred = await prisma.staffCredential.findFirst({
    where: { documentUrl: { endsWith: `/${name}` } },
    select: { userId: true, organizationId: true },
  });
  if (!cred) return false;
  if (isSuperAdmin) return true;
  return cred.organizationId === orgId && (canAccessCredentials(s.role) || cred.userId === s.session.user.id);
}

/** Patients (mobile app, bearer token) may only load their own photo. */
async function patientCanRead(req: Request, kind: UploadKind, name: string): Promise<boolean | 'unauthenticated'> {
  try {
    const me = await requirePatient(req);
    return kind === 'client-avatars' && path.parse(name).name === me.clientId;
  } catch {
    return 'unauthenticated';
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string; name: string }> }) {
  const { kind, name } = await params;
  if (!isUploadKind(kind)) return notFound();
  const abs = uploadPath(kind, name);
  if (!abs) return notFound();

  const hasBearer = /^Bearer\s+/i.test(req.headers.get('authorization') || '');
  let staffActor: StaffActor | null = null;
  const allowed = hasBearer
    ? await patientCanRead(req, kind, name)
    : await staffCanRead(kind, name, (a) => { staffActor = a; });
  if (allowed === 'unauthenticated') return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  // Same response for "no access" and "no such file" so file names can't be probed
  if (!allowed) return notFound();

  let body: Buffer;
  try {
    body = await readFile(abs);
  } catch {
    return notFound();
  }

  const actor = staffActor as StaffActor | null;
  if (actor && (kind === 'client-avatars' || kind === 'credentials' || kind === 'intake-docs')) {
    const stem = path.parse(name).name;
    const intakeClientId =
      kind === 'intake-docs'
        ? (await prisma.documentIntake.findUnique({ where: { id: stem }, select: { suggestedClientId: true } }))
            ?.suggestedClientId ?? null
        : null;
    await writeAuditLog({
      action: 'READ',
      actorUserId: actor.userId,
      actorRole: actor.role,
      organizationId: actor.organizationId,
      resourceType:
        kind === 'client-avatars' ? 'clientAvatar' : kind === 'intake-docs' ? 'intakeDocument' : 'staffCredentialDocument',
      resourceId: stem,
      patientId: kind === 'client-avatars' ? stem : intakeClientId,
      ...auditRequestMeta(req),
    });
  }

  const ext = path.extname(name).toLowerCase();
  const type = CONTENT_TYPES[ext] || 'application/octet-stream';
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': type,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      // Intake PDFs open in the browser for review; other documents download
      'Content-Disposition':
        type.startsWith('image/') || (kind === 'intake-docs' && type === 'application/pdf')
          ? 'inline'
          : `attachment; filename="${name}"`,
    },
  });
}
