import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { PatientAppError, type PatientProfile } from '@/patient/domain';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';
import { storedUploadName, uploadDir, uploadUrl } from '@/lib/storage/privateUploads';
import { addressContactFields, demographicFields, normalizeStateCode, normalizeUsPhone, normalizeUsZip } from '@/lib/clients/demographics';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const phone = z.string().trim().min(5).max(30).regex(/^\+?[0-9() .-]+$/).nullable().optional();

const usPhone = (what: string) =>
  phone.refine((v) => v == null || v === '' || normalizeUsPhone(v) !== null, { message: `${what} must be a valid 10-digit US number` });

/** Same standard formats as the staff forms (src/lib/clients/demographics.ts) */
export const updatePatientProfileSchema = z.object({
  phone: usPhone('Phone'),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  state: addressContactFields.state,
  postalCode: addressContactFields.postalCode,
  emergencyContactName: optionalText(120),
  emergencyContactPhone: usPhone('Emergency contact phone'),
  // Patient-reported, coded (optional; the app may not show them yet)
  pronouns: demographicFields.pronouns,
  preferredLanguage: demographicFields.preferredLanguage,
  interpreterNeeded: demographicFields.interpreterNeeded,
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one profile field');

const profileSelect = {
  id: true, name: true, phone: true, image: true,
  addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true,
  emergencyContactName: true, emergencyContactPhone: true,
  pronouns: true, preferredLanguage: true, interpreterNeeded: true,
} as const;

export async function getPatientProfile(me: PatientProfile) {
  const client = await prisma.client.findUnique({ where: { id: me.clientId }, select: profileSelect });
  if (!client) throw new PatientAppError('Account not found', 404, 'NOT_FOUND');
  return { ...client, email: me.email };
}

export async function updatePatientProfile(me: PatientProfile, input: unknown) {
  const parsed = updatePatientProfileSchema.parse(input);
  const data = {
    ...parsed,
    ...(parsed.state !== undefined ? { state: normalizeStateCode(parsed.state) } : {}),
    ...(parsed.postalCode !== undefined ? { postalCode: normalizeUsZip(parsed.postalCode) } : {}),
    ...(parsed.pronouns !== undefined ? { pronouns: parsed.pronouns || null } : {}),
    ...(parsed.preferredLanguage !== undefined ? { preferredLanguage: parsed.preferredLanguage || null } : {}),
  };
  const client = await prisma.client.update({ where: { id: me.clientId }, data, select: profileSelect });
  await logPatientAudit({ clientId: me.clientId, accountId: me.accountId, action: 'profile.updated' });
  return { ...client, email: me.email };
}

import { mkdir, unlink } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const CLIENT_AVATAR_DIR = uploadDir('client-avatars');

export async function setPatientAvatar(
  me: PatientProfile,
  upload: { buffer: Buffer; mimeType: string }
) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'];
  if (!allowed.includes(upload.mimeType)) {
    throw new PatientAppError('Please upload a valid JPG, PNG, WEBP, or HEIC image', 400, 'INVALID_FILE_TYPE');
  }
  if (upload.buffer.byteLength > 10 * 1024 * 1024) {
    throw new PatientAppError('Image must be under 10MB', 400, 'PAYLOAD_TOO_LARGE');
  }

  await mkdir(CLIENT_AVATAR_DIR, { recursive: true });
  const filename = `${me.clientId}.webp`;
  const abs = path.join(CLIENT_AVATAR_DIR, filename);

  await sharp(upload.buffer, { animated: false })
    .rotate()
    .resize(400, 400, { fit: 'cover', position: 'centre' })
    .webp({ quality: 85 })
    .toFile(abs);

  const imageUrl = `${uploadUrl('client-avatars', filename)}?v=${Date.now()}`;
  const client = await prisma.client.update({
    where: { id: me.clientId },
    data: { image: imageUrl },
    select: profileSelect,
  });

  await logPatientAudit({ clientId: me.clientId, accountId: me.accountId, action: 'profile.avatar_updated' });
  return { ...client, email: me.email };
}

export async function removePatientAvatar(me: PatientProfile) {
  const existing = await prisma.client.findUnique({
    where: { id: me.clientId },
    select: { image: true },
  });

  const filename = storedUploadName(existing?.image, 'client-avatars');
  if (filename) {
    try {
      await unlink(path.join(CLIENT_AVATAR_DIR, filename));
    } catch {
      // Ignored if file does not exist
    }
  }

  const client = await prisma.client.update({
    where: { id: me.clientId },
    data: { image: null },
    select: profileSelect,
  });

  await logPatientAudit({ clientId: me.clientId, accountId: me.accountId, action: 'profile.avatar_removed' });
  return { ...client, email: me.email };
}

export async function deletePatientAccount(me: PatientProfile) {
  try {
    await prisma.patientAccount.updateMany({
      where: { id: me.accountId },
      data: {
        status: 'DISABLED',
        passwordHash: null,
      },
    });
  } catch {
    // Graceful fallback
  }

  await logPatientAudit({
    clientId: me.clientId,
    accountId: me.accountId,
    action: 'account.deleted',
    entityType: 'patient_account',
    entityId: me.accountId,
  });

  return { message: 'Account deleted successfully' };
}
