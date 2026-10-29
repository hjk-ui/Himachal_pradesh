import { NextResponse } from 'next/server';
import { z } from 'zod';
import { completeIntakeInvite } from '@/lib/intake/manage';

export const runtime = 'nodejs';

const paramsSchema = z.object({ token: z.string().min(8).max(128) });

const completeSchema = z.object({
  demographics: z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    dateOfBirth: z.string().trim().min(4).max(32),
    pronouns: z.string().trim().max(40).optional().nullable(),
    addressLine1: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().max(80).optional().nullable(),
    state: z.string().trim().max(40).optional().nullable(),
    postalCode: z.string().trim().max(20).optional().nullable(),
    phone: z.string().trim().min(7).max(40),
    email: z.string().trim().email().max(200),
    emergencyContactName: z.string().trim().max(120).optional().nullable(),
    emergencyContactRelationship: z.string().trim().max(80).optional().nullable(),
    emergencyContactPhone: z.string().trim().max(40).optional().nullable(),
  }),
  insurance: z.object({
    primaryPayer: z.string().trim().min(1).max(120),
    memberId: z.string().trim().max(80).optional().nullable(),
    groupNumber: z.string().trim().max(80).optional().nullable(),
    subscriberName: z.string().trim().max(120).optional().nullable(),
    subscriberDob: z.string().trim().max(32).optional().nullable(),
    subscriberRelationship: z.string().trim().max(40).optional().nullable(),
    secondaryPayer: z.string().trim().max(120).optional().nullable(),
    secondaryMemberId: z.string().trim().max(80).optional().nullable(),
    secondaryGroupNumber: z.string().trim().max(80).optional().nullable(),
  }),
  medicalHistory: z.record(z.string(), z.unknown()).optional(),
  consents: z.record(z.string(), z.boolean()).optional(),
  signature: z.object({
    fullName: z.string().trim().min(2).max(120),
    signedAt: z.string().trim().min(4).max(64),
  }),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = paramsSchema.parse(await ctx.params);
    const body = completeSchema.parse(await req.json());
    const result = await completeIntakeInvite(token, body);
    if (result.ok === false) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({
      success: true,
      clientId: result.clientId,
      invite: result.invite,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not complete intake' },
      { status: 400 }
    );
  }
}
