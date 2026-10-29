import { mkdir, unlink } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { storedUploadName, uploadDir, uploadUrl } from '@/lib/storage/privateUploads';
import { caseloadAllows } from '@/lib/clients/caseloadAccess';

const MAX_CLIENT_AVATAR_BYTES = 10 * 1024 * 1024;
const CLIENT_AVATAR_SIZE = 400;
const ALLOWED_CLIENT_AVATAR_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const CLIENT_AVATAR_DIR = uploadDir('client-avatars');

export function clientOrgWhere(organizationId: string) {
  return clientOrgFilter(organizationId);
}

export type ClientAvatarUpload = {
  buffer: Buffer;
  mimeType: string;
};

function assertClientAvatarUpload(upload: ClientAvatarUpload) {
  if (!ALLOWED_CLIENT_AVATAR_TYPES.has(upload.mimeType)) {
    throw new Error('Use JPG, PNG, WEBP, or GIF');
  }

  if (upload.buffer.byteLength > MAX_CLIENT_AVATAR_BYTES) {
    throw new Error('Image must be under 10MB');
  }
}

async function removeStoredClientAvatar(image: string | null | undefined) {
  const filename = storedUploadName(image, 'client-avatars');
  if (!filename) return;
  const abs = path.join(CLIENT_AVATAR_DIR, filename);

  try {
    await unlink(abs);
  } catch {
    // Missing local files are fine after deploys or manual cleanup.
  }
}

export async function updateClientAvatar(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  upload: ClientAvatarUpload;
}) {
  assertClientAvatarUpload(input.upload);

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientOrgWhere(input.organizationId) },
    select: { id: true, assignedToId: true },
  });

  if (!client) {
    return { ok: false as const, status: 404, error: 'Client not found' };
  }

  if (!(await caseloadAllows({ organizationId: input.organizationId, userId: input.actorUserId, role: input.actorRole }, client))) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }

  await mkdir(CLIENT_AVATAR_DIR, { recursive: true });

  const filename = `${client.id}.webp`;
  const abs = path.join(CLIENT_AVATAR_DIR, filename);

  await sharp(input.upload.buffer, { animated: false })
    .rotate()
    .resize(CLIENT_AVATAR_SIZE, CLIENT_AVATAR_SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: 85 })
    .toFile(abs);

  const imageUrl = `${uploadUrl('client-avatars', filename)}?v=${Date.now()}`;
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: { image: imageUrl },
    select: { id: true, image: true },
  });

  return { ok: true as const, client: updated };
}

export async function removeClientAvatar(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: string;
}) {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientOrgWhere(input.organizationId) },
    select: { id: true, assignedToId: true, image: true },
  });

  if (!client) {
    return { ok: false as const, status: 404, error: 'Client not found' };
  }

  if (!(await caseloadAllows({ organizationId: input.organizationId, userId: input.actorUserId, role: input.actorRole }, client))) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }

  await removeStoredClientAvatar(client.image);

  const updated = await prisma.client.update({
    where: { id: client.id },
    data: { image: null },
    select: { id: true, image: true },
  });

  return { ok: true as const, client: updated };
}
