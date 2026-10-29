import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { loadPracticeIdentity } from '@/lib/practice/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET: letterhead for consult letters — practice name and main phone / fax from practice settings,
 * the signed-in provider's name, credentials and NPI, and their primary location's address.
 * Missing values are null (the letter shows a placeholder that blocks print / copy). No PHI.
 */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/medical/referrals')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const [identity, settings, user] = await Promise.all([
      loadPracticeIdentity(gate.organizationId),
      prisma.practiceSettings
        .findUnique({ where: { organizationId: gate.organizationId }, select: { mainPhone: true, mainFax: true } })
        .catch(() => null),
      prisma.user.findUnique({
        where: { id: gate.userId },
        select: {
          name: true,
          npi: true,
          credentials: true,
          primaryLocation: { select: { addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true, phone: true } },
        },
      }),
    ]);
    const loc = user?.primaryLocation;
    const address = loc?.addressLine1
      ? [loc.addressLine1, loc.addressLine2, [loc.city, loc.state].filter(Boolean).join(", "), loc.postalCode].filter(Boolean).join(' ')
      : null;
    return NextResponse.json(
      {
        success: true,
        letterhead: {
          practiceName: identity.name,
          address,
          phone: settings?.mainPhone?.trim() || loc?.phone?.trim() || null,
          fax: settings?.mainFax?.trim() || null,
          providerName: user?.name?.trim() || null,
          providerCredentials: user?.credentials?.trim() || null,
          providerNpi: user?.npi?.trim() || null,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    console.error('[medical/referrals/letterhead]', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not load the letterhead' }, { status: 500 });
  }
}
