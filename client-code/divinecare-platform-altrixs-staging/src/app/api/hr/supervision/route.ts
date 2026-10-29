import type { Role, SupervisionSessionType } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  canAccessSupervision,
  createSupervisionLog,
  listSupervisionLogs,
  listSupervisionStaff,
  listSupervisionTracks,
} from '@/lib/hr/supervision';

export const runtime = 'nodejs';

const createSchema = z.object({
  superviseeId: z.string().min(1).max(128),
  supervisorId: z.string().min(1).max(128).optional(),
  sessionAt: z.string().trim().min(8).max(40),
  sessionType: z.enum(['Individual', 'Triadic', 'Group']).optional(),
  durationMin: z.number().int().min(15).max(480),
  topics: z.string().trim().min(1).max(4000),
  clientRefs: z.array(z.string().trim().max(120)).max(20).optional(),
});

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return {
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  };
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessSupervision(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/hr/supervision')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const actor = actorFrom(gate);
    const [{ logs, schemaReady: logsReady }, { tracks, schemaReady: tracksReady }, staff] =
      await Promise.all([
        listSupervisionLogs(actor),
        listSupervisionTracks(actor),
        listSupervisionStaff(gate.organizationId),
      ]);
    const pendingSuperviseeSignatures = logs.filter(
      (log) => log.signedBySupervisorAt && !log.signedBySuperviseeAt
    ).length;
    return NextResponse.json({
      success: true,
      logs,
      tracks,
      staff,
      pendingSuperviseeSignatures,
      schemaReady: logsReady && tracksReady,
      actor: { userId: gate.userId, role: gate.role },
    });
  } catch (err) {
    console.error('[hr/supervision GET]', err);
    return NextResponse.json(
      { success: false, error: 'Could not load supervision logs' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessSupervision(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/hr/supervision')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const result = await createSupervisionLog(actorFrom(gate), {
      ...body,
      sessionType: body.sessionType as SupervisionSessionType | undefined,
    });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, log: result.log }, { status: 201 });
  } catch (err: unknown) {
    const missing =
      typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2021';
    const message = missing
      ? 'Supervision log table is not on this database yet'
      : err instanceof z.ZodError
        ? 'Invalid supervision log'
        : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not create supervision log' },
      { status: 400 }
    );
  }
}
