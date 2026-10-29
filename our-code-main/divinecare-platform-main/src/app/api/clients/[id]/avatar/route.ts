import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  removeClientAvatar,
  updateClientAvatar,
  type ClientAvatarUpload,
} from '@/lib/clients/avatar';

import { isClinicalStaff } from '@/types/roles';

export const runtime = 'nodejs';

function canManageClientPhoto(role: string) {
  return isClinicalStaff(role) || role === 'FRONT_DESK';
}

async function readAvatarUpload(req: Request): Promise<ClientAvatarUpload> {
  const contentType = req.headers.get('content-type') || '';
  const contentLength = Number(req.headers.get('content-length') || 0);

  if (contentLength > 12 * 1024 * 1024) {
    throw new Error('Image must be under 10MB');
  }

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('avatar');

    if (!file || !(file instanceof File)) {
      throw new Error('No image uploaded');
    }

    return {
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
    };
  }

  let body: { mimeType?: string; dataBase64?: string };

  try {
    body = (await req.json()) as {
      mimeType?: string;
      dataBase64?: string;
    };
  } catch {
    throw new Error('Image upload was too large or incomplete. Use an image under 10MB.');
  }

  if (!body.mimeType || !body.dataBase64) {
    throw new Error('No image uploaded');
  }

  return {
    buffer: Buffer.from(body.dataBase64, 'base64'),
    mimeType: body.mimeType,
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canManageClientPhoto(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const upload = await readAvatarUpload(req);

    const result = await updateClientAvatar({
      clientId: id,
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      upload,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Client photo updated',
      client: result.client,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not upload client photo' },
      { status: 400 }
    );
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canManageClientPhoto(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const result = await removeClientAvatar({
      clientId: id,
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Client photo removed',
      client: result.client,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not remove client photo' },
      { status: 400 }
    );
  }
}
