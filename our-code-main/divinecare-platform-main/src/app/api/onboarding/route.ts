import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOrgPracticeSetup, saveSoloPracticeSetup, upsertOrgPracticeSetup } from '@/lib/solo/manage';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import { hasDuplicateServices, practiceSetupSchema } from '@/lib/solo/schema';
import type { SoloPracticeSetup } from '@/lib/solo/types';
import { requireSession } from '@/lib/auth/requireSession';
import { EMPTY_PRACTICE_SETUP } from '@/lib/solo/defaults';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const sessionGate = await requireSession();
    if (sessionGate.ok && sessionGate.organizationId) {
      const practice = await getOrgPracticeSetup(sessionGate.organizationId);
      if (practice) {
        return NextResponse.json({
          success: true,
          authenticated: true,
          setup: practice.setup,
          slug: practice.slug,
          completed: practice.completed,
          bookingUrl: practice.bookingUrl,
        });
      }
    }

    return NextResponse.json({
      success: true,
      authenticated: false,
      setup: EMPTY_PRACTICE_SETUP,
      completed: false,
    });
  } catch (err: unknown) {
    return NextResponse.json({
      success: true,
      authenticated: false,
      setup: EMPTY_PRACTICE_SETUP,
      completed: false,
    });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(clientKey(req, 'onboarding'), 15, 15 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { success: false, error: 'Too many onboarding attempts. Please try again later.' },
      { status: 429 }
    );
  }
  try {
    const body = practiceSetupSchema.parse(await req.json());
    if (new Date(body.licenseExpiryDate).getTime() <= Date.now()) {
      return NextResponse.json(
        { success: false, error: 'License expiry date must be in the future.' },
        { status: 400 }
      );
    }
    if (hasDuplicateServices(body.services)) {
      return NextResponse.json(
        { success: false, error: 'Duplicate services are not allowed.' },
        { status: 400 }
      );
    }
    for (const [day, rule] of Object.entries(body.availability)) {
      if (rule.enabled && rule.end <= rule.start) {
        return NextResponse.json(
          { success: false, error: `${day} end time must be after start time.` },
          { status: 400 }
        );
      }
    }
    if (body.acceptsInsurance && body.acceptedPayers.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Select at least one accepted payer or turn insurance off.' },
        { status: 400 }
      );
    }

    // Check if user is logged in
    const sessionGate = await requireSession();
    if (!sessionGate.ok && sessionGate.status !== 401) {
      return NextResponse.json({ success: false, error: sessionGate.error }, { status: sessionGate.status });
    }

    if (sessionGate?.ok && sessionGate.organizationId) {
      // Update the user's registered organization
      const result = await upsertOrgPracticeSetup(
        sessionGate.organizationId,
        body as SoloPracticeSetup
      );
      return NextResponse.json({
        success: true,
        slug: result.slug,
        bookingUrl: result.bookingUrl,
        organizationId: sessionGate.organizationId,
      });
    }

    // Unauthenticated public standalone onboarding
    const result = await saveSoloPracticeSetup(body as SoloPracticeSetup);
    return NextResponse.json({
      success: true,
      slug: result.slug,
      bookingUrl: `/book/${result.slug}`,
      organizationId: result.organizationId,
    });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError
        ? err.issues[0]?.message || 'Please check the onboarding form and try again.'
        : err instanceof Error
          ? err.message
          : 'Could not save onboarding.';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
