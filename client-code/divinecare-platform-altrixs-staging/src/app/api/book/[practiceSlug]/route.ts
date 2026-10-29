import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPublicBooking, getPublicPractice, listPublicSlots, publicBookingOpen } from '@/lib/solo/manage';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';

const paramsSchema = z.object({
  practiceSlug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
});

const bookingSchema = z.object({
  serviceId: z.string().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  phone: z.string().trim().max(40).optional().nullable(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentType: z.enum(['Insurance', 'Self-Pay', 'Sliding Scale']),
  insurance: z.string().trim().max(120).optional().nullable(),
  memberId: z.string().trim().max(80).optional().nullable(),
  reason: z.string().trim().min(2).max(1000),
});

export async function GET(req: Request, ctx: { params: Promise<{ practiceSlug: string }> }) {
  const { practiceSlug } = paramsSchema.parse(await ctx.params);
  const url = new URL(req.url);
  const serviceId = url.searchParams.get('serviceId');
  const date = url.searchParams.get('date');

  if (serviceId && date) {
    const result = await listPublicSlots(practiceSlug, serviceId, date);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, slots: result.slots });
  }

  const practice = await getPublicPractice(practiceSlug);
  if (!practice) {
    return NextResponse.json({ success: false, error: 'Practice unavailable' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    practice: {
      slug: practice.org.slug,
      practiceName: practice.setup.practiceName,
      clinicianName: practice.setup.fullName,
      credentials: [practice.setup.licenseType, practice.setup.licenseState].filter(Boolean).join(', '),
      bio: practice.setup.practiceBio,
      phone: practice.setup.practicePhone,
      website: practice.setup.practiceWebsite,
      address: practice.setup.practiceAddress,
      city: practice.setup.practiceCity,
      state: practice.setup.practiceState,
      zip: practice.setup.practiceZip,
      tagline: practice.setup.practiceTagline,
      languages: [],
      photoUrl: practice.org.users[0]?.image || null,
      requireCreditCard: practice.setup.requireCreditCard,
      acceptedInsurances: practice.setup.acceptsInsurance ? practice.setup.acceptedPayers : [],
      services: practice.setup.services.filter((service) => service.active !== false),
      cancellationPolicy: practice.setup.cancellationPolicy,
      acceptsInsurance: practice.setup.acceptsInsurance,
      selfPayRate: practice.setup.selfPayRate,
      slidingScalePolicy: practice.setup.slidingScalePolicy,
      bookingWindowDays: practice.setup.bookingWindowDays,
      selfSchedulingEnabled: publicBookingOpen(practice.org.id, practice.subscription),
    },
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ practiceSlug: string }> }) {
  const limited = rateLimit(clientKey(req, 'book'), 20, 15 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json({ success: false, error: 'Too many booking attempts. Please try again later.' }, { status: 429 });
  }
  try {
    const { practiceSlug } = paramsSchema.parse(await ctx.params);
    const body = bookingSchema.parse(await req.json());
    if (new Date(body.dob).getTime() >= Date.now()) {
      return NextResponse.json({ success: false, error: 'Date of birth must be in the past.' }, { status: 400 });
    }
    if (body.paymentType === 'Insurance' && (!body.insurance || !body.memberId)) {
      return NextResponse.json({ success: false, error: 'Insurance plan and member ID are required.' }, { status: 400 });
    }

    const result = await createPublicBooking({ slug: practiceSlug, ...body });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      success: true,
      confirmationCode: result.confirmationCode,
      appointmentId: result.appointmentId,
    });
  } catch (err: unknown) {
    // Public caller: never echo internal error text (Prisma, constraint names, stack details).
    if (!(err instanceof z.ZodError)) {
      console.error('[book POST]', err instanceof Error ? err.message : err);
    }
    const message = err instanceof z.ZodError ? 'Please check the booking form and try again.' : 'Could not confirm booking.';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
