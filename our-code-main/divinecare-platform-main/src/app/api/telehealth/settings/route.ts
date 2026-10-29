import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  getTelehealthSettings,
  updateTelehealthSettings,
} from '@/lib/telehealth/manage';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

const putSchema = z.object({
  defaultPlatform: z.enum(['chime', 'zoom', 'doxy', 'google', 'teams', 'phone']).optional(),
  reminderMinutes: z.number().int().min(0).max(120).optional(),
  recordingMode: z.string().max(40).optional(),
  autoSendLinkMinutes: z.number().int().min(0).max(1440).optional(),
  waitingRoom: z.boolean().optional(),
  platforms: z
    .object({
      zoom: z.boolean(),
      doxy: z.boolean(),
      google: z.boolean(),
      teams: z.boolean(),
      phone: z.boolean(),
    })
    .optional(),
});

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const settings = await getTelehealthSettings(gate.organizationId);
  return NextResponse.json({ success: true, settings });
}

export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = putSchema.parse(await req.json());
    const settings = await updateTelehealthSettings(gate.organizationId, body);
    return NextResponse.json({ success: true, settings });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not save settings';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
