import { mkdir, unlink } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { prisma } from '@/lib/db/prisma';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 400;
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const AVATAR_DIR = path.join(process.cwd(), 'public', 'uploads', 'avatars');
const AVATAR_PUBLIC_PATH = '/uploads/avatars';

const profileSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  image: true,
  createdAt: true,
} as const;

type AvatarProfile = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  image: string | null;
  createdAt: Date;
};

function serializeProfile(user: AvatarProfile) {
  return { ...user, createdAt: user.createdAt.toISOString() };
}

function assertAvatarFile(file: File) {
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    throw new Error('Use JPG, PNG, WEBP, or GIF');
  }

  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('Image must be under 5MB');
  }
}

async function removeStoredAvatar(image: string | null | undefined) {
  if (!image?.startsWith(`${AVATAR_PUBLIC_PATH}/`)) return;

  const clean = image.split('?')[0];
  const filename = path.basename(clean);
  const abs = path.join(AVATAR_DIR, filename);

  try {
    await unlink(abs);
  } catch {
    // The database can outlive local files between deploys; missing files are fine.
  }
}

export async function updateOwnAvatar(userId: string, file: File) {
  assertAvatarFile(file);

  const buffer = Buffer.from(await file.arrayBuffer());
  await mkdir(AVATAR_DIR, { recursive: true });

  const filename = `${userId}.webp`;
  const abs = path.join(AVATAR_DIR, filename);

  await sharp(buffer, { animated: false })
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: 85 })
    .toFile(abs);

  const imageUrl = `${AVATAR_PUBLIC_PATH}/${filename}?v=${Date.now()}`;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { image: imageUrl },
    select: profileSelect,
  });

  return serializeProfile(updated);
}

export async function removeOwnAvatar(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { image: true },
  });

  await removeStoredAvatar(user?.image);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { image: null },
    select: profileSelect,
  });

  return serializeProfile(updated);
}
