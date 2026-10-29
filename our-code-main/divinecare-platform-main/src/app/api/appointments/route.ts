import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { APPOINTMENT_TYPES } from '@/features/appointments';
import {
  createAppointment,
  listAppointmentsForUser,
} from '@/lib/appointments/manage';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

const createSchema = z.object({
  clientId: z.string().min(1).max(128),
  type: z.string().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .nullable(),
  isVirtual: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
  clinicianId: z.string().min(1).max(128).optional().nullable(),
  videoProvider: z.enum(['zoom', 'google', 'in_app', 'chime']).optional().nullable(),
});

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to view appointments' },
      { status: 403 }
    );
  }

  try {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('clientId') || undefined;
    const isVirtual = url.searchParams.get('isVirtual') === 'true';
    const date = url.searchParams.get('date') || undefined;
    const appointments = await listAppointmentsForUser(
      {
        id: gate.userId,
        role: gate.role,
        organizationId: gate.organizationId,
      },
      { clientId, isVirtual: isVirtual || undefined, date }
    );
    return NextResponse.json({ success: true, appointments });
  } catch (err) {
    console.error('[appointments GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load appointments' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to schedule appointments' },
      { status: 403 }
    );
  }

  try {
    const body = createSchema.parse(await req.json());
    // Prefer known catalog types; still allow seeded specialty labels
    if (
      !(APPOINTMENT_TYPES as readonly string[]).includes(body.type) &&
      body.type.trim().length < 2
    ) {
      return NextResponse.json({ success: false, error: 'Invalid appointment type' }, { status: 400 });
    }

    const mappedProvider =
      body.videoProvider === 'chime' ? 'in_app' : body.videoProvider;

    const result = await createAppointment(
      {
        ...body,
        videoProvider: (mappedProvider || undefined) as 'zoom' | 'google' | 'in_app' | undefined,
      },
      gate.userId,
      gate.organizationId,
      gate.role
    );
    if (result.ok === false) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json(
      { success: true, appointment: result.appointment },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError
        ? 'Please check the appointment form and try again.'
        : err instanceof Error
          ? err.message
          : 'Could not create appointment';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
