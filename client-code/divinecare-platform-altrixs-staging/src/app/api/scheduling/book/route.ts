import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  bookPublicAppointment,
  resolvePublicOrg,
} from '@/lib/scheduling/manage';
import { bookSchema } from '@/lib/scheduling/types';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const limited = rateLimit(clientKey(req, 'scheduling-book'), 20, 15 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { success: false, error: 'Too many booking attempts. Please try again later.' },
      { status: 429 }
    );
  }

  try {
    const body = bookSchema.parse(await req.json());
    const org = await resolvePublicOrg({
      organizationId: body.organizationId,
      organizationSlug: body.organizationSlug,
    });
    if (!org) {
      return NextResponse.json({ success: false, error: 'Practice not found' }, { status: 404 });
    }

    const result = await bookPublicAppointment({
      organizationId: org.id,
      serviceId: body.serviceId,
      modality: body.modality,
      providerId: body.providerId ?? null,
      startsAt: new Date(body.startsAt),
      firstName: body.firstName,
      lastName: body.lastName,
      dob: body.dob,
      phone: body.phone,
      email: body.email,
      insurance: body.insurance,
      memberId: body.memberId,
      notes: body.notes,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Please check your booking details and try again.' },
        { status: 400 }
      );
    }
    const status = typeof err === 'object' && err && 'status' in err ? Number((err as { status: number }).status) : 400;
    const message = err instanceof Error ? err.message : 'Could not complete booking';
    return NextResponse.json({ success: false, error: message }, { status: status || 400 });
  }
}
