import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  canAccessReferrals,
  COMMUNITY_REFERRAL_RESOURCE,
  createReferral,
  listReferrals,
} from '@/lib/referrals/manage';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

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

// Internal cross-location transfers (enterprise page) share this table, tagged by sourceName.
// They are not outside referrals, so the default list leaves them out; ?kind=cross_location returns only them.
const CROSS_LOCATION_PREFIX = 'Cross-location: ';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessReferrals(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const crossOnly = new URL(req.url).searchParams.get('kind') === 'cross_location';
    // Peer Support / Case Manager: only referrals they logged or for clients on their caseload
    const referrals = (await listReferrals(gate.organizationId, { userId: gate.userId, role: gate.role })).filter(
      (r) => (r.sourceName ?? '').startsWith(CROSS_LOCATION_PREFIX) === crossOnly
    );
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: COMMUNITY_REFERRAL_RESOURCE,
      metadata: { count: referrals.length, ids: referrals.slice(0, 50).map((r) => r.id), kind: crossOnly ? 'cross_location' : 'community' },
    });
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
    // The CREATE row is also how a Peer / Case Manager's own referrals are found (no creator column)
    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: COMMUNITY_REFERRAL_RESOURCE,
      resourceId: result.referral.id,
      metadata: { direction: body.direction, sourceType: body.sourceType },
    });
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
