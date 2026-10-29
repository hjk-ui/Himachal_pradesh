import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOrgPracticeSetup, upsertOrgPracticeSetup } from '@/lib/solo/manage';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import { hasDuplicateServices, practiceSetupSchema } from '@/lib/solo/schema';
import type { SoloPracticeSetup } from '@/lib/solo/types';
import { requireSession } from '@/lib/auth/requireSession';
import { EMPTY_PRACTICE_SETUP } from '@/lib/solo/defaults';
import { canEditPracticeSettings, canReadPracticeSetupDetails } from '@/lib/practice/access';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** Solo practice: the caller is the only ACTIVE staff user in their organization. */
async function isSoleActiveStaff(userId: string, organizationId: string): Promise<boolean> {
  const others = await prisma.user.count({
    where: { organizationId, status: 'ACTIVE', id: { not: userId } },
  });
  return others === 0;
}

export async function GET() {
  try {
    const sessionGate = await requireSession();
    if (sessionGate.ok && sessionGate.organizationId) {
      const practice = await getOrgPracticeSetup(sessionGate.organizationId);
      if (practice) {
        // Licenses, NPI, CAQH and payer policy: leadership (or a solo founder) only.
        const fullAccess =
          canEditPracticeSettings(sessionGate.role) ||
          canReadPracticeSetupDetails(
            sessionGate.role,
            await isSoleActiveStaff(sessionGate.session.user.id, sessionGate.organizationId)
          );
        if (!fullAccess) {
          return NextResponse.json({
            success: true,
            authenticated: true,
            completed: practice.completed,
          });
        }
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
      // Same write rule as /api/practice-settings: practice leadership only. The one exception is
      // a solo practice whose founder is the org's only active staff user (registered as e.g.
      // THERAPIST at /get-started) — otherwise any clinician could rewrite the clinic's setup.
      const canEdit =
        canEditPracticeSettings(sessionGate.role) ||
        (await isSoleActiveStaff(sessionGate.session.user.id, sessionGate.organizationId));
      if (!canEdit) {
        await writeAuditLog({
          action: 'practice_settings_write',
          actorUserId: sessionGate.session.user.id,
          actorRole: String(sessionGate.role),
          organizationId: sessionGate.organizationId,
          resourceType: 'PracticeSettings',
          outcome: 'DENIED',
          ...auditRequestMeta(req),
          metadata: { via: 'onboarding' },
        });
        return NextResponse.json(
          { success: false, error: 'Only practice leadership can change practice settings' },
          { status: 403 }
        );
      }
      // Update the user's registered organization
      const result = await upsertOrgPracticeSetup(
        sessionGate.organizationId,
        body as SoloPracticeSetup
      );
      await writeAuditLog({
        action: 'practice_settings_write',
        actorUserId: sessionGate.session.user.id,
        actorRole: String(sessionGate.role),
        organizationId: sessionGate.organizationId,
        resourceType: 'PracticeSettings',
        ...auditRequestMeta(req),
        metadata: { via: 'onboarding' },
      });
      return NextResponse.json({
        success: true,
        slug: result.slug,
        bookingUrl: result.bookingUrl,
        organizationId: sessionGate.organizationId,
      });
    }

    // No anonymous organization creation: accounts and practices are created by /get-started
    // (register + sign-in) and then completed in the setup wizard.
    return NextResponse.json(
      { success: false, error: 'Sign in (or create an account at /get-started) before saving practice setup.' },
      { status: 401 }
    );
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError
        ? err.issues[0]?.message || 'Please check the onboarding form and try again.'
        : 'Could not save onboarding.';
    if (!(err instanceof z.ZodError)) console.error('[onboarding POST]', err);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
