import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import type { Role, StaffCredential, StaffCredentialStatus, StaffCredentialType, UserStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  MAX_DOCUMENT_BYTES,
  readFileBounded,
  sanitizeFilename,
  validateDocumentBytes,
} from '@/lib/security/uploads';

export const STAFF_CREDENTIAL_TYPES = [
  'LICENSE',
  'CEU',
  'MALPRACTICE',
  'DEA',
  'CERTIFICATION',
  'BACKGROUND_CHECK',
  'SUPERVISION',
] as const satisfies readonly StaffCredentialType[];

export const STAFF_CREDENTIAL_STATUSES = [
  'ACTIVE',
  'EXPIRING_SOON',
  'EXPIRED',
  'PENDING_RENEWAL',
] as const satisfies readonly StaffCredentialStatus[];

export const EXPIRING_WINDOW_DAYS = 60;

const DOC_DIR = path.join(process.cwd(), 'public', 'uploads', 'credentials');
const DOC_PUBLIC = '/uploads/credentials';
const ALLOWED_DOC_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

export const HR_CORE_ROLES: Role[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'HR', 'OFFICE_MANAGER'];

function isMissingTableError(err: unknown) {
  const code =
    typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  return code === 'P2021' || code === 'P2010' || /does not exist/i.test(message);
}

export function canAccessCredentials(role: Role | undefined | null) {
  return Boolean(role && HR_CORE_ROLES.includes(role));
}

export function canMutateCredentials(role: Role | undefined | null) {
  return canAccessCredentials(role);
}

export type StaffCredentialActor = {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
};

export type DerivedCredentialStatus = 'active' | 'expiring_soon' | 'expired';

export type StaffCredentialListItem = {
  id: string;
  organizationId: string;
  userId: string;
  staffName: string;
  staffEmail: string;
  staffStatus: UserStatus;
  credentialType: StaffCredentialType;
  title: string;
  licenseNumber: string;
  issuer: string;
  issuedAt: string | null;
  expiresAt: string;
  ceuRequired: number;
  ceuCompleted: number;
  documentUrl: string | null;
  documentName: string | null;
  status: StaffCredentialStatus;
  derivedStatus: DerivedCredentialStatus;
  daysUntilExpiry: number;
  createdAt: string;
  updatedAt: string;
};

export type CredentialStaffOption = {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
};

export type CredentialWriteInput = {
  userId?: string;
  credentialType?: StaffCredentialType;
  title?: string;
  licenseNumber?: string;
  issuer?: string;
  issuedAt?: string | null;
  expiresAt?: string;
  ceuRequired?: number;
  ceuCompleted?: number;
  documentUrl?: string | null;
  documentName?: string | null;
  status?: StaffCredentialStatus;
};

function dateOnly(d: Date | null | undefined) {
  return d ? d.toISOString().slice(0, 10) : null;
}

function parseDate(value?: string | null, required = false) {
  if (value == null || value === '') return required ? undefined : null;
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function parseHours(value: unknown, fallback = 0) {
  if (value == null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(999, Math.round(n));
}

export function daysUntilExpiry(expiresAt: Date) {
  const expiry = new Date(expiresAt);
  expiry.setHours(23, 59, 59, 999);
  return Math.ceil((expiry.getTime() - Date.now()) / 86_400_000);
}

export function deriveDisplayStatus(expiresAt: Date): DerivedCredentialStatus {
  const days = daysUntilExpiry(expiresAt);
  if (days < 0) return 'expired';
  if (days <= EXPIRING_WINDOW_DAYS) return 'expiring_soon';
  return 'active';
}

function serialize(
  row: StaffCredential & {
    user: { name: string | null; email: string; status: UserStatus };
  }
): StaffCredentialListItem {
  const days = daysUntilExpiry(row.expiresAt);
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    staffName: row.user.name?.trim() || row.user.email,
    staffEmail: row.user.email,
    staffStatus: row.user.status,
    credentialType: row.credentialType,
    title: row.title,
    licenseNumber: row.licenseNumber,
    issuer: row.issuer,
    issuedAt: dateOnly(row.issuedAt),
    expiresAt: dateOnly(row.expiresAt)!,
    ceuRequired: row.ceuRequired,
    ceuCompleted: row.ceuCompleted,
    documentUrl: row.documentUrl,
    documentName: row.documentName,
    status: row.status,
    derivedStatus: deriveDisplayStatus(row.expiresAt),
    daysUntilExpiry: days,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadScoped(actor: StaffCredentialActor, id: string) {
  return prisma.staffCredential.findFirst({
    where: { id, organizationId: actor.organizationId },
    include: { user: { select: { name: true, email: true, status: true } } },
  });
}

export async function listOrgStaffForCredentials(organizationId: string) {
  const users = await prisma.user.findMany({
    where: { organizationId, status: { not: 'DEACTIVATED' } },
    select: { id: true, name: true, email: true, status: true },
    orderBy: [{ name: 'asc' }],
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name?.trim() || u.email,
    email: u.email,
    status: u.status,
  })) satisfies CredentialStaffOption[];
}

export async function listStaffCredentials(actor: StaffCredentialActor) {
  try {
    const rows = await prisma.staffCredential.findMany({
      where: { organizationId: actor.organizationId },
      include: { user: { select: { name: true, email: true, status: true } } },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
      take: 400,
    });
    return { ok: true as const, credentials: rows.map(serialize), schemaReady: true };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { ok: true as const, credentials: [] as StaffCredentialListItem[], schemaReady: false };
    }
    throw err;
  }
}

export async function createStaffCredential(actor: StaffCredentialActor, input: CredentialWriteInput) {
  if (!input.userId || !input.credentialType || !input.title || !input.licenseNumber || !input.issuer || !input.expiresAt) {
    return { ok: false as const, error: 'Missing required fields', status: 400 as const };
  }

  const staff = await prisma.user.findFirst({
    where: { id: input.userId, organizationId: actor.organizationId },
    select: { id: true },
  });
  if (!staff) {
    return { ok: false as const, error: 'Staff member not found', status: 404 as const };
  }

  const issuedAt = parseDate(input.issuedAt);
  const expiresAt = parseDate(input.expiresAt, true);
  if (issuedAt === undefined || expiresAt === undefined || !expiresAt) {
    return { ok: false as const, error: 'Invalid date', status: 400 as const };
  }

  const row = await prisma.staffCredential.create({
    data: {
      organizationId: actor.organizationId,
      userId: staff.id,
      credentialType: input.credentialType,
      title: input.title.trim(),
      licenseNumber: input.licenseNumber.trim(),
      issuer: input.issuer.trim(),
      issuedAt,
      expiresAt,
      ceuRequired: parseHours(input.ceuRequired),
      ceuCompleted: parseHours(input.ceuCompleted),
      documentUrl: input.documentUrl?.trim() || null,
      documentName: input.documentName?.trim() || null,
      status: input.status ?? 'ACTIVE',
    },
    include: { user: { select: { name: true, email: true, status: true } } },
  });
  return { ok: true as const, credential: serialize(row) };
}

export async function updateStaffCredential(
  actor: StaffCredentialActor,
  id: string,
  input: CredentialWriteInput
) {
  const existing = await loadScoped(actor, id);
  if (!existing) {
    return { ok: false as const, error: 'Credential not found', status: 404 as const };
  }

  const issuedAt =
    input.issuedAt === undefined ? existing.issuedAt : parseDate(input.issuedAt);
  const expiresAt =
    input.expiresAt === undefined ? existing.expiresAt : parseDate(input.expiresAt, true);
  if (issuedAt === undefined || expiresAt === undefined || !expiresAt) {
    return { ok: false as const, error: 'Invalid date', status: 400 as const };
  }

  const row = await prisma.staffCredential.update({
    where: { id: existing.id },
    data: {
      credentialType: input.credentialType ?? existing.credentialType,
      title: input.title?.trim() ?? existing.title,
      licenseNumber: input.licenseNumber?.trim() ?? existing.licenseNumber,
      issuer: input.issuer?.trim() ?? existing.issuer,
      issuedAt,
      expiresAt,
      ceuRequired: input.ceuRequired === undefined ? existing.ceuRequired : parseHours(input.ceuRequired),
      ceuCompleted: input.ceuCompleted === undefined ? existing.ceuCompleted : parseHours(input.ceuCompleted),
      documentUrl:
        input.documentUrl === undefined ? existing.documentUrl : input.documentUrl?.trim() || null,
      documentName:
        input.documentName === undefined ? existing.documentName : input.documentName?.trim() || null,
      status: input.status ?? existing.status,
    },
    include: { user: { select: { name: true, email: true, status: true } } },
  });
  return { ok: true as const, credential: serialize(row) };
}

export async function markCredentialRenewed(
  actor: StaffCredentialActor,
  id: string,
  expiresAt?: string
) {
  const existing = await loadScoped(actor, id);
  if (!existing) {
    return { ok: false as const, error: 'Credential not found', status: 404 as const };
  }

  let next = parseDate(expiresAt);
  if (expiresAt && next === undefined) {
    return { ok: false as const, error: 'Invalid date', status: 400 as const };
  }
  if (!next) {
    const base = daysUntilExpiry(existing.expiresAt) >= 0 ? new Date(existing.expiresAt) : new Date();
    base.setFullYear(base.getFullYear() + 1);
    base.setHours(12, 0, 0, 0);
    next = base;
  }

  const issuedAt = new Date();
  issuedAt.setHours(12, 0, 0, 0);

  const row = await prisma.staffCredential.update({
    where: { id: existing.id },
    data: {
      issuedAt,
      expiresAt: next,
      status: 'ACTIVE',
    },
    include: { user: { select: { name: true, email: true, status: true } } },
  });
  return { ok: true as const, credential: serialize(row) };
}

async function removeStoredDocument(url: string | null | undefined) {
  if (!url?.startsWith(`${DOC_PUBLIC}/`)) return;
  const filename = path.basename(url.split('?')[0]);
  try {
    await unlink(path.join(DOC_DIR, filename));
  } catch {
    // File may already be gone between deploys.
  }
}

export async function attachCredentialDocument(
  actor: StaffCredentialActor,
  id: string,
  file: File
) {
  const existing = await loadScoped(actor, id);
  if (!existing) {
    return { ok: false as const, error: 'Credential not found', status: 404 as const };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false as const, error: 'File must be 2 MB or smaller', status: 400 as const };
  }
  const typeOk = ALLOWED_DOC_TYPES.has(file.type) || /\.(pdf|txt|png|jpe?g|webp|gif|docx?)$/i.test(file.name);
  if (!typeOk) {
    return { ok: false as const, error: 'Use PDF, Word, or an image file', status: 400 as const };
  }

  const safeOriginalName = sanitizeFilename(file.name || 'document');
  const bytes = await readFileBounded(file);
  validateDocumentBytes(bytes, file.type, safeOriginalName);

  await mkdir(DOC_DIR, { recursive: true });
  const ext = path.extname(safeOriginalName).toLowerCase().slice(0, 8) || '.bin';
  const filename = `${existing.id}-${Date.now()}${ext}`;
  await writeFile(path.join(DOC_DIR, filename), bytes);
  await removeStoredDocument(existing.documentUrl);

  const row = await prisma.staffCredential.update({
    where: { id: existing.id },
    data: {
      documentUrl: `${DOC_PUBLIC}/${filename}`,
      documentName: safeOriginalName,
    },
    include: { user: { select: { name: true, email: true, status: true } } },
  });
  return { ok: true as const, credential: serialize(row) };
}
