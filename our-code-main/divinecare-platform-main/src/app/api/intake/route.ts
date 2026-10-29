import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  canAccessIntake,
  createIntakeInvite,
  listIntakeInvites,
} from '@/lib/intake/manage';
import { canAssignPatientToClinician } from '@/lib/clients/orgScope';
import { optionalCuid } from '@/lib/validation/optionalCuid';

export const runtime = 'nodejs';

const createSchema = z.object({
  clientName: z.string().trim().min(2).max(120),
  clientEmail: z.string().trim().email().max(200),
  clientPhone: z.string().trim().max(40).optional().nullable(),
  firstAppointment: z.string().trim().max(32).optional().nullable(),
  assignedToId: optionalCuid,
  waitlistEntryId: optionalCuid,
  insurancePayer: z.string().trim().max(120).optional().nullable(),
  appointmentType: z.enum(['In Office', 'Telehealth']).optional().nullable(),
  homeless: z.boolean().optional().default(false),
  sendVia: z.enum(['Email', 'SMS', 'Both']).optional(),
});

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessIntake(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const invites = await listIntakeInvites(gate.organizationId);
    return NextResponse.json({ success: true, invites });
  } catch (err) {
    console.error('[intake GET]', err);
    return NextResponse.json(
      { success: false, error: 'Could not load intake invites' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessIntake(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    // Non-admins may still Send Intake after Admin matched; copy clinician from waitlist only.
    if (body.assignedToId && !canAssignPatientToClinician(gate.role)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Only Admin, Practice Director, Front Desk, or Office Manager can assign a clinician',
        },
        { status: 403 }
      );
    }
    const { sendVia: _sendVia, ...inviteInput } = body;
    const result = await createIntakeInvite(gate.organizationId, gate.userId, inviteInput);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, invite: result.invite }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not create intake invite' },
      { status: 400 }
    );
  }
}
