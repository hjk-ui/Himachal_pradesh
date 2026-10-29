import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  canAccessReferrals,
  createReferral,
  listReferrals,
} from '@/lib/referrals/manage';

export const runtime = 'nodejs';

const createSchema = z.object({
  direction: z.enum(['incoming', 'outgoing']),
  patientName: z.string().trim().min(2).max(120),
  sourceType: z.enum([
    'primary_care',
    'hospital',
    'court',
    'community_event',
    'social_media',
    'word_of_mouth',
    'self',
    'other_provider',
  ]),
  sourceName: z.string().trim().max(200).optional().nullable(),
  referralDate: z.string().trim().min(8).max(32),
  notes: z.string().trim().max(4000).optional().nullable(),
});

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessReferrals(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const referrals = await listReferrals(gate.organizationId);
    return NextResponse.json({ success: true, referrals });
  } catch (err) {
    console.error('[referrals GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load referrals' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessReferrals(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const result = await createReferral(gate.organizationId, body);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, referral: result.referral }, { status: 201 });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError
        ? 'Please check the referral form and try again.'
        : err instanceof Error
          ? err.message
          : 'Could not log referral';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
