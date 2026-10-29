import { NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import type { Role } from '@prisma/client';
import { slugifyPracticeName, uniqueSlugCandidate } from '@/lib/solo/slug';
import { Prisma } from '@prisma/client';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import { EMPTY_PRACTICE_SETUP } from '@/lib/solo/defaults';
import { rejectUntrustedMutation } from '@/lib/security/request';
import {
  PASSWORD_ERRORS,
  STAFF_PASSWORD_MAX_LENGTH,
  validateStaffPassword,
} from '@/lib/security/passwordPolicy';
import {
  BAA_MISSING_SIGNER,
  BAA_MUST_ACCEPT,
  BAA_REQUIRED_CODE,
  BAA_STALE_CODE,
  BAA_STALE_MESSAGE,
  BAA_VERSION,
  baaTextSha256,
} from '@/lib/legal/baa';

export const runtime = 'nodejs';

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
  email: z.string().trim().email('Please enter a valid email address').toLowerCase(),
  password: z.string().max(STAFF_PASSWORD_MAX_LENGTH, PASSWORD_ERRORS.tooLong),
  orgName: z.string().trim().min(2, 'Practice name must be at least 2 characters').max(120),
  role: z
    .enum(['therapist', 'psychiatrist', 'np', 'practice_director', 'office_manager', 'admin'])
    .default('therapist'),
  plan: z.enum(['free', 'solo', 'professional', 'practice']).default('solo'),
  baa: z
    .object({
      accepted: z.boolean(),
      version: z.string(),
      signerName: z.string().optional(),
      signerTitle: z.string().optional(),
      signerEmail: z.string().optional(),
    })
    .optional(),
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
  const rejected = rejectUntrustedMutation(req);
  if (rejected) return rejected;
  if (!rateLimit(clientKey(req, 'registration'), 20, 60_000).ok) {
    return NextResponse.json({ success: false, error: 'Too many registration attempts. Please try again later.' }, { status: 429 });
  }
  try {
    const raw = await req.json();
    const body = registerSchema.parse(raw);

    if (!body.baa?.accepted) {
      return NextResponse.json(
        { success: false, code: BAA_REQUIRED_CODE, error: BAA_MUST_ACCEPT },
        { status: 400 }
      );
    }
    if (body.baa.version !== BAA_VERSION) {
      return NextResponse.json(
        { success: false, code: BAA_STALE_CODE, error: BAA_STALE_MESSAGE },
        { status: 409 }
      );
    }
    const signerName = String(body.baa.signerName || '').trim();
    const signerTitle = String(body.baa.signerTitle || '').trim();
    const signerEmail = String(body.baa.signerEmail || '').trim().toLowerCase();
    if (!signerName || !signerTitle || !signerEmail) {
      return NextResponse.json({ success: false, error: BAA_MISSING_SIGNER }, { status: 400 });
    }

    const passwordCheck = validateStaffPassword(body.password, {
      name: body.name,
      email: body.email,
    });
    if (passwordCheck.ok === false) {
      return NextResponse.json({ success: false, error: passwordCheck.error }, { status: 400 });
    }

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

    const slug = await getUniqueOrgSlug(body.orgName);
    const passwordHash = await hash(body.password, 12);
    const assignedRole = ROLE_MAP[body.role] || 'THERAPIST';

    const { org, user } = await prisma.$transaction(async (tx) => {
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

      // Save initial subscription state with chosen plan
      const subscription = {
        plan: body.plan,
        billingCycle: 'monthly',
        updatedAt: new Date().toISOString(),
      };

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

      const ip =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        null;
      await tx.baaAcceptance.create({
        data: {
          organizationId: org.id,
          version: BAA_VERSION,
          textSha256: baaTextSha256(),
          signerName,
          signerTitle,
          signerEmail,
          acceptedById: user.id,
          via: 'registration',
          ip,
          userAgent: req.headers.get('user-agent'),
        },
      });
      return { org, user };
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
