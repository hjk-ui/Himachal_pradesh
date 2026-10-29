import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { requireDrFirstCaller } from '../../_lib/access';
import { uploadPatientToRcopia } from '../../_lib/registerPatient';

export const dynamic = 'force-dynamic';

// Demographics always come from the chart (legal name, recorded sex, DOB, address, phones), never
// from the request body: what DrFirst holds must match what staff entered and the audit trail.
const patientSyncSchema = z.object({
  clientId: z.string().min(1),
}).passthrough();

/**
 * POST /api/drfirst/patients/sync — register (or update) a client in Rcopia from the chart
 * (send_patient, then its ICD-10 problems, allergies and medications: _lib/registerPatient).
 * Prescribers only (signed as their own Rcopia username; an ADMIN never registers a patient: see
 * src/lib/drfirst/ssoPolicy.ts). The client must be on the prescriber's caseload (drFirstClientWhere:
 * assigned, treatment team or appointment; verified Medical Director org-wide) and pass the
 * 42 CFR Part 2 / sensitive-record lock (403 SENSITIVE_RECORD). The Rcopia external id is always our client id. Only new or changed records are sent
 * (DrFirst UM1 / PDUM5): an unchanged patient answers patientSent=false. A chart missing a required
 * item (legal name, DOB, sex, address or no-fixed-address status, ZIP) is refused with 422
 * DEMOGRAPHICS_INCOMPLETE and the list of missing items; nothing is sent.
 */
export async function POST(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { requireRcopiaUser: true });
  if (g.response) return g.response;
  const c = g.caller;

  try {
    const parsed = patientSyncSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
    }
    const res = await uploadPatientToRcopia(c, parsed.data.clientId, 'patient-sync');
    if (res.ok === false) {
      // Calls that reached DrFirst audit themselves (DRFIRST_SEND_PATIENT); a refusal before any call is audited here
      if (res.code === 'DEMOGRAPHICS_INCOMPLETE' || res.code === 'NOT_FOUND' || res.code === 'SENSITIVE_RECORD') {
        await writeAuditLog({
          action: 'DRFIRST_SEND_PATIENT',
          actorUserId: c.userId,
          actorRole: c.role,
          organizationId: c.organizationId,
          resourceType: 'patient',
          resourceId: parsed.data.clientId,
          patientId: res.code === 'NOT_FOUND' ? null : parsed.data.clientId,
          outcome: res.code === 'SENSITIVE_RECORD' ? 'DENIED' : 'FAILURE',
          ipAddress: c.ipAddress,
          userAgent: c.userAgent,
          metadata: { trigger: 'patient-sync', refused: res.code, missing: (res.missing ?? []).map((m) => m.field) },
        });
      }
      if (res.demo) return NextResponse.json({ success: true, demo: true, rcopiaPatientId: null, message: res.reason });
      if (res.code === 'NOT_FOUND') return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
      if (res.code === 'SENSITIVE_RECORD') {
        return NextResponse.json({ error: 'SENSITIVE_RECORD', canRequestBreakGlass: true, message: res.reason }, { status: 403 });
      }
      if (res.code === 'DEMOGRAPHICS_INCOMPLETE') {
        return NextResponse.json({ error: res.reason, code: 'DEMOGRAPHICS_INCOMPLETE', missing: res.missing ?? [] }, { status: 422 });
      }
      return NextResponse.json({ error: res.reason, code: res.code }, { status: 502 });
    }
    return NextResponse.json({ success: true, rcopiaPatientId: res.rcopiaPatientId, patientSent: res.patientSent, demo: false, chart: res.chart });
  } catch (err: unknown) {
    console.error('[drfirst-patient-sync] error:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: 'Failed to sync patient to DrFirst' }, { status: 500 });
  }
}
