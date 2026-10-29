import { NextResponse } from 'next/server';
import { drFirstRoute, readInput, patientSchema } from '@/lib/drfirst/http';
import { syncPatientToDrFirst } from '@/lib/drfirst/service';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
export async function POST(req: Request) {
  return drFirstRoute(req, async context => {
    const input = await readInput(req, patientSchema);
    const audit = (outcome: 'SUCCESS' | 'FAILURE') =>
      auditPhiAccess({
        gate: context,
        req,
        action: 'DRFIRST_SEND_PATIENT',
        resourceType: 'patient',
        resourceId: input.clientId,
        patientId: input.clientId,
        outcome,
        metadata: { service: 'drfirst', operation: 'patient-sync' },
      });
    let data: Awaited<ReturnType<typeof syncPatientToDrFirst>>;
    try {
      data = await syncPatientToDrFirst(input.clientId, context);
    } catch (error) {
      await audit('FAILURE');
      throw error;
    }
    await audit('SUCCESS');
    return NextResponse.json({ success: true, data });
  });
}
