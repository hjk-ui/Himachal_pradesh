import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { attendanceSchema, day, errorResponse, fail, intensiveGate, ok } from '@/lib/intensive/http';
import { roster, saveAttendance } from '@/lib/intensive/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/intensive/attendance?programId=&date=YYYY-MM-DD: the day's roster (admitted clients in scope) and marks. */
export async function GET(req: Request) {
  const g = await intensiveGate();
  if (!g.ok) return g.res;
  try {
    const url = new URL(req.url);
    const programId = url.searchParams.get('programId');
    const date = url.searchParams.get('date') ?? '';
    if (!programId || !day.safeParse(date).success) return fail('programId and date (YYYY-MM-DD) are required', 400);
    const data = await roster(g.actor, programId, date);
    await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'intensiveAttendance',
      metadata: { programId, date, roster: data.clients.length, patientIds: data.clients.map((c) => c.clientId).slice(0, 50) },
    });
    return ok({ data });
  } catch (e) {
    return errorResponse(e, 'Could not load the roster');
  }
}

/** POST /api/intensive/attendance: save marks for one program day; opens / clears missed-day outreach. */
export async function POST(req: Request) {
  const g = await intensiveGate({ write: true });
  if (!g.ok) return g.res;
  try {
    const body = attendanceSchema.parse(await req.json());
    const r = await saveAttendance(g.actor, body.programId, body.date, body.marks);
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: 'intensiveAttendance',
      metadata: { programId: body.programId, date: body.date, saved: r.saved, followUpsOpened: r.followUpsOpened, patientIds: r.clientIds.slice(0, 50) },
    });
    return ok({ saved: r.saved, followUpsOpened: r.followUpsOpened });
  } catch (e) {
    return errorResponse(e, 'Could not save attendance');
  }
}
