import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/auth/tenant';
import { createOrganization, listOrganizations } from '@/lib/platform/manage';

const createSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).optional().nullable(),
  primaryLocationName: z.string().min(2).max(120).optional().nullable(),
  ownerEmail: z.string().email(),
  ownerName: z.string().min(2).max(100).optional().nullable(),
});

export async function GET() {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const organizations = await listOrganizations();
    return NextResponse.json({ success: true, organizations });
  } catch (err) {
    console.error('[platform/orgs GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load organizations' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = createSchema.parse(await req.json());
    const result = await createOrganization({
      ...body,
      invitedById: gate.session.user.id,
    });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json(
      {
        success: true,
        organization: result.organization,
        owner: result.owner,
        emailMode: result.emailMode,
        message:
          result.emailMode !== 'console'
            ? `Clinic created. Invite emailed to ${result.owner.email}.`
            : `Clinic created. Invite for ${result.owner.email} (check server logs if SMTP off).`,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not create organization' },
      { status: 400 }
    );
  }
}
