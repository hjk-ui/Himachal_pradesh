import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { errorResponse, ok, prpGate } from '@/lib/prp/http';
import { deleteAttendance, PRP_WRITE_ROLES } from '@/lib/prp/program';

export const runtime = 'nodejs';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await prpGate(PRP_WRITE_ROLES);
  if (!g.ok) return g.res;
  try {
    const { id } = await params;
    const row = await deleteAttendance(g.actor, id);
    await auditPhiAccess({ gate: g.gate, req, action: 'DELETE', resourceType: 'prpAttendance', resourceId: id, patientId: row.clientId });
    return ok({ deleted: id });
  } catch (e) {
    return errorResponse(e, 'Could not delete the attendance entry');
  }
}
