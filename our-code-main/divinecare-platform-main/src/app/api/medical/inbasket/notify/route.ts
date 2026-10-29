import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  CLOSE_LOOP_NOTIFY_METHODS,
  recordPatientNotified,
} from '@/lib/medical/close-loop';

export const runtime = 'nodejs';

const ROLES = new Set(['PHYSICIAN', 'MEDICAL_NP', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);

const bodySchema = z.object({
  itemId: z.string().min(1),
  clientId: z.string().optional().nullable(),
  method: z.enum(['Phone', 'Portal message', 'Letter', 'In person']),
  notifiedAt: z.string().min(8),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid notify payload',
        methods: CLOSE_LOOP_NOTIFY_METHODS,
      },
      { status: 400 }
    );
  }

  const record = await recordPatientNotified(gate.organizationId, {
    ...parsed.data,
    actorUserId: gate.userId,
  });

  return NextResponse.json({
    success: true,
    record,
    button: 'Patient notified',
    methods: CLOSE_LOOP_NOTIFY_METHODS,
  });
}
