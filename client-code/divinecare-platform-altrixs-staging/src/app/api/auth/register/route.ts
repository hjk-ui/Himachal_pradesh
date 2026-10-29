import { NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import type { Role } from '@prisma/client';
import { slugifyPracticeName, uniqueSlugCandidate } from '@/lib/solo/slug';
import { Prisma } from '@prisma/client';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import { EMPTY_PRACTICE_SETUP } from '@/lib/solo/defaults';
import { newTrialRecord } from '@/lib/billing/subscriptionRecord';
import { tierFromLegacyPlan } from '@/lib/billing/plans';
import { checkStaffPassword, newStaffPasswordField } from '@/lib/auth/passwordPolicy';
import { baaAuditMetadata, buildBaaAcceptanceRecord, parseBaaAcceptance } from '@/lib/legal/baaAcceptance';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const runtime = 'nodejs';

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
  email: z.string().trim().email('Please enter a valid email address').toLowerCase(),
  password: newStaffPasswordField,
  orgName: z.string().trim().min(2, 'Practice name must be at least 2 characters').max(120),
  role: z
    .enum(['therapist', 'psychiatrist', 'np', 'practice_director', 'office_manager', 'admin'])
    .default('therapist'),
  /** Tier from src/lib/billing/plans.ts; legacy ids (free/solo/practice) map onto tiers. */
  plan: z.enum(['starter', 'professional', 'clinic', 'free', 'solo', 'practice']).default('starter'),
});

const ROLE_MAP: Record<string, Role> = {
  therapist: 'THERAPIST',
  psychiatrist: 'PSYCHIATRIST',
  np: 'NP',
  practice_director: 'PRACTICE_DIRECTOR',
  office_manager: 'OFFICE_MANAGER',
  admin: 'ADMIN',
};

async function getUniqueOrgSlug(name: string): Promise<string> {
  const base = slugifyPracticeName(name);
  const taken: string[] = [];
  let candidate = uniqueSlugCandidate(base, taken);
  while (true) {
    const existing = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    taken.push(candidate);
    candidate = uniqueSlugCandidate(base, taken);
  }
}

export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, 'registration'), 15, 15 * 60 * 1000).ok) {
    return NextResponse.json({ success: false, error: 'Too many registration attempts. Please try again later.' }, { status: 429 });
  }
  try {
    const raw = await req.json();
    const body = registerSchema.parse(raw);
    // Click-through BAA: the organization's authorized signer must accept before anything is created.
    const baa = parseBaaAcceptance((raw as { baa?: unknown } | null)?.baa);
    if (!baa.ok) {
      return NextResponse.json({ success: false, error: baa.error, code: 'BAA_REQUIRED' }, { status: baa.status });
    }
    const reqMeta = auditRequestMeta(req);

    const existingUser = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true },
    });
    if (existingUser) {
      return NextResponse.json(
        {
          success: false,
          error: 'An account with this email address already exists. Please sign in instead.',
        },
        { status: 409 }
      );
    }

    const policyError = checkStaffPassword(body.password, { email: body.email, name: body.name });
    if (policyError) {
      return NextResponse.json({ success: false, error: policyError }, { status: 400 });
    }

    const slug = await getUniqueOrgSlug(body.orgName);
    const passwordHash = await hash(body.password, 12);
    const assignedRole = ROLE_MAP[body.role] || 'THERAPIST';

    const { org, user, baaRecord, baaAcceptanceId } = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: body.orgName.trim(),
          slug,
          active: true,
          locations: {
            create: {
              name: 'Main Office',
              code: 'MAIN',
              isPrimary: true,
              active: true,
            },
          },
        },
        include: {
          locations: { where: { isPrimary: true }, take: 1 },
        },
      });

      const primaryLocationId = org.locations[0]?.id;

      const user = await tx.user.create({
        data: {
          name: body.name.trim(),
          email: body.email,
          passwordHash,
          role: assignedRole,
          roles: [assignedRole],
          organizationId: org.id,
          primaryLocationId,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          roles: true,
          organizationId: true,
        },
      });

      if (primaryLocationId) {
        await tx.userLocation.create({
          data: {
            userId: user.id,
            locationId: primaryLocationId,
            isPrimary: true,
          },
        });
      }

      // New self-serve org: free trial on the chosen tier (see TRIAL_RULE in billing/plans.ts)
      const subscription = newTrialRecord(tierFromLegacyPlan(body.plan) || 'starter') as unknown as Prisma.InputJsonValue;

      // Save draft practice setup
      const setup = {
        ...EMPTY_PRACTICE_SETUP,
        practiceName: body.orgName.trim(),
        fullName: body.name.trim(),
        bookingSlug: org.slug,
      };
      await tx.clinicModuleState.createMany({ data: [
        { organizationId: org.id, module: 'subscription-state', data: subscription },
        { organizationId: org.id, module: 'solo-practice-settings', data: setup as unknown as Prisma.InputJsonValue },
      ] });

      const baaRecord = buildBaaAcceptanceRecord({
        organizationId: org.id,
        userId: user.id,
        input: baa.value,
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        source: 'registration',
      });
      const acceptance = await tx.baaAcceptance.create({ data: baaRecord, select: { id: true } });
      return { org, user, baaRecord, baaAcceptanceId: acceptance.id };
    });

    await writeAuditLog({
      action: 'BAA_ACCEPTED',
      actorUserId: user.id,
      actorRole: user.role,
      organizationId: org.id,
      resourceType: 'BaaAcceptance',
      resourceId: baaAcceptanceId,
      outcome: 'SUCCESS',
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      requestId: req.headers.get('x-request-id'),
      metadata: baaAuditMetadata(baaRecord, baaAcceptanceId),
    });

    return NextResponse.json({
      success: true,
      message: 'Account and practice created successfully.',
      user,
      org: {
        id: org.id,
        name: org.name,
        slug: org.slug,
      },
      plan: body.plan,
      bookingUrl: `/book/${org.slug}`,
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: err.issues[0]?.message || 'Invalid registration form input' },
        { status: 400 }
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ success: false, error: 'This email or practice address is already in use. Please sign in or try again.' }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: 'Registration could not be completed. Please try again.' }, { status: 500 });
  }
}
