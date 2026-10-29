import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { removeOwnAvatar, updateOwnAvatar } from '@/lib/profile/avatar';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const file = form.get('avatar');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'No image uploaded' }, { status: 400 });
    }
    const user = await updateOwnAvatar(session.user.id, file);

    return NextResponse.json({
      success: true,
      message: 'Photo updated',
      user,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not upload photo' },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const user = await removeOwnAvatar(session.user.id);

    return NextResponse.json({
      success: true,
      message: 'Photo removed',
      user,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not remove photo' },
      { status: 400 }
    );
  }
}
