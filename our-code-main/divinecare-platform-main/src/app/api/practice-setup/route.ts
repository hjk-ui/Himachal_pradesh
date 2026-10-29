import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { getOrgPracticeSetup, upsertOrgPracticeSetup } from '@/lib/solo/manage';
import { hasDuplicateServices, practiceSetupSchema } from '@/lib/solo/schema';
import type { SoloPracticeSetup } from '@/lib/solo/types';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/practice-setup')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const result = await getOrgPracticeSetup(gate.organizationId);
  if (!result) {
    return NextResponse.json({ success: false, error: 'Organization not found.' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    setup: result.setup,
    slug: result.slug,
    completed: result.completed,
    bookingUrl: result.bookingUrl,
  });
}

export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/practice-setup')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
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
    if (body.practiceBio.trim() && body.practiceBio.trim().length < 10) {
      return NextResponse.json(
        { success: false, error: 'Bio must be at least 10 characters when provided.' },
        { status: 400 }
      );
    }

    const result = await upsertOrgPracticeSetup(
      gate.organizationId,
      body as SoloPracticeSetup
    );
    return NextResponse.json({
      success: true,
      setup: result.setup,
      slug: result.slug,
      bookingUrl: result.bookingUrl,
    });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError
        ? 'Please check the practice setup form and try again.'
        : err instanceof Error
          ? err.message
          : 'Could not save practice setup.';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
