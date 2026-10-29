import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { attendanceSchema, errorResponse, fail, ok, prpGate } from '@/lib/prp/http';
import { PRP_WRITE_ROLES, recordAttendance, rosterFor } from '@/lib/prp/program';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/prp/attendance?groupId=&date=YYYY-MM-DD: roster check-off state for one group session. */
export async function GET(req: Request) {
  const g = await prpGate();
  if (!g.ok) return g.res;
  try {
    const url = new URL(req.url);
    const groupId = url.searchParams.get('groupId');
    const date = url.searchParams.get('date');
    if (!groupId || !date) return fail('groupId and date are required', 400);
    const { enrollments, rows } = await rosterFor(g.actor, groupId, date);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'READ',
      resourceType: 'prpAttendance',
      metadata: {
        groupId,
        date,
        roster: enrollments.length,
        marked: rows.length,
        patientIds: enrollments.map((e) => e.clientId).slice(0, 50),
      },
    });
    const byEnrollment = new Map(rows.map((r) => [r.enrollmentId, r]));
    return ok({
      date,
      groupId,
      roster: enrollments.map((e) => {
        const r = byEnrollment.get(e.id);
        return {
          enrollmentId: e.id,
          clientId: e.clientId,
          name: e.clientName,
          displayId: e.displayId,
          present: !!r,
          attendanceId: r?.id ?? null,
          minutes: r?.minutes ?? null,
          billable: r?.billable ?? true,
          note: r?.note ?? null,
          location: r?.location ?? null,
          irpGoal: r?.irpGoal ?? null,
          intervention: r?.intervention ?? null,
          response: r?.response ?? null,
        };
      }),
    });
  } catch (e) {
    return errorResponse(e, 'Could not load the roster');
  }
}

/** POST /api/prp/attendance: record a group roster check-off or individual/community encounters. */
export async function POST(req: Request) {
  const g = await prpGate(PRP_WRITE_ROLES);
  if (!g.ok) return g.res;
  try {
    const body = attendanceSchema.parse(await req.json());
    const result = await recordAttendance(g.actor, body);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'WRITE',
      resourceType: 'prpAttendance',
      patientId: result.clientIds.length === 1 ? result.clientIds[0] : null,
      metadata: {
        serviceDate: body.serviceDate,
        serviceType: body.serviceType,
        groupId: body.groupId ?? null,
        location: body.location ?? null,
        created: result.created,
        updated: result.updated,
        removed: result.removed,
        patientIds: result.clientIds.slice(0, 50),
      },
    });
    return ok({ created: result.created, updated: result.updated, removed: result.removed });
  } catch (e) {
    return errorResponse(e, 'Could not save attendance');
  }
}
