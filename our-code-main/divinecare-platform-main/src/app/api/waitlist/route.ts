import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  canAccessWaitlist,
  createWaitlistEntry,
  listWaitlistClinicians,
  listWaitlistEntries,
} from '@/lib/waitlist/manage';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(40).optional().nullable(),
  specialty: z.string().trim().min(1).max(80),
  urgency: z.enum(['routine', 'urgent', 'crisis']).optional(),
  insurancePayer: z.string().trim().max(120).optional().nullable(),
  referralSource: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  preferredClinician: z.string().trim().max(120).optional().nullable(),
});

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessWaitlist(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [entries, clinicians] = await Promise.all([
      listWaitlistEntries(gate.organizationId),
      listWaitlistClinicians(gate.organizationId),
    ]);
    return NextResponse.json({ success: true, entries, clinicians });
  } catch (err) {
    console.error('[waitlist GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load waitlist' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessWaitlist(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const result = await createWaitlistEntry(gate.organizationId, {
      ...body,
      email: body.email || null,
    });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, entry: result.entry }, { status: 201 });
  } catch (err: any) {
    const message =
      err instanceof z.ZodError
        ? 'Please check the waitlist form and try again.'
        : err.message || 'Could not create waitlist entry';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
