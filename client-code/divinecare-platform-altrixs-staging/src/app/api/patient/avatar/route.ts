import {
  patientAccountHandler,
  patientOk,
  patientOptions,
  patientFail,
} from '@/patient/infrastructure/http/handler';
import {
  setPatientAvatar,
  removePatientAvatar,
} from '@/patient/application/profile/service';

export const runtime = 'nodejs';

export function OPTIONS() {
  return patientOptions();
}

async function parseAvatarUpload(req: Request) {
  const contentType = req.headers.get('content-type') || '';
  const contentLength = Number(req.headers.get('content-length') || 0);

  if (contentLength > 12 * 1024 * 1024) {
    throw new Error('Image must be under 10MB');
  }

  // 1. Multipart Form Data (standard file upload from Flutter / mobile)
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    // Accept 'avatar', 'image', or 'file' field name
    const file = form.get('avatar') || form.get('image') || form.get('file');

    if (!file || !(file instanceof File)) {
      throw new Error('No image file provided. Send file with key "avatar", "image", or "file".');
    }

    return {
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || 'image/jpeg',
    };
  }

  // 2. JSON Payload (Base64 data or remove action)
  let body: { action?: string; dataBase64?: string; mimeType?: string; image?: string };
  try {
    body = (await req.json()) as {
      action?: string;
      dataBase64?: string;
      mimeType?: string;
      image?: string;
    };
  } catch {
    throw new Error('Invalid request payload. Send multipart/form-data or JSON with dataBase64.');
  }

  if (body.action === 'remove' || body.action === 'delete') {
    return { remove: true };
  }

  const base64Str = body.dataBase64 || body.image;
  if (!base64Str) {
    throw new Error('No image provided. Send base64 data in "dataBase64" or "image".');
  }

  // Handle data URI prefix if present (e.g. "data:image/jpeg;base64,...")
  let cleanBase64 = base64Str;
  let detectedMime = body.mimeType || 'image/jpeg';
  const match = base64Str.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  if (match) {
    detectedMime = match[1];
    cleanBase64 = match[2];
  }

  return {
    buffer: Buffer.from(cleanBase64, 'base64'),
    mimeType: detectedMime,
  };
}

export const POST = patientAccountHandler(async ({ req, me }) => {
  try {
    const parsed = await parseAvatarUpload(req);

    if ('remove' in parsed && parsed.remove) {
      const client = await removePatientAvatar(me);
      return patientOk({ client }, 200, 'Avatar removed successfully');
    }

    const client = await setPatientAvatar(me, {
      buffer: parsed.buffer!,
      mimeType: parsed.mimeType!,
    });

    return patientOk({ client }, 200, 'Avatar updated successfully');
  } catch (err: any) {
    return patientFail(
      'AVATAR_UPLOAD_FAILED',
      err.message || 'Could not update profile photo',
      400
    );
  }
}, ['patient-avatar-upload', 20]);

export const DELETE = patientAccountHandler(async ({ me }) => {
  try {
    const client = await removePatientAvatar(me);
    return patientOk({ client }, 200, 'Avatar removed successfully');
  } catch (err: any) {
    return patientFail(
      'AVATAR_REMOVE_FAILED',
      err.message || 'Could not remove profile photo',
      400
    );
  }
}, ['patient-avatar-remove', 20]);
