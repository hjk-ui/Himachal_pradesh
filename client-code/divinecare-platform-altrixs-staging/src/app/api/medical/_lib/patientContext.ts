import { NextResponse } from 'next/server';
import { resolveMedicalPatientLink } from '@/lib/medical/patientLink';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { isMedicalProvider } from '@/features/medical/roles';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { canAccessClientRoster } from '@/lib/clients/orgScope';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';

export { isMedicalProvider };

/** Page whose role rule gates each kind of medical content (src/lib/auth/roleAccess.ts) */
export const MEDICAL_RULE = {
  /** demographics, medication list: the primary care area */
  patient: '/dashboard/medical/patients',
  /** visits & SOAP (and the combined chart payload, which carries SOAP) */
  visits: '/dashboard/medical/visits',
  vitals: '/dashboard/medical/vitals',
  /** allergies / past medical history */
  history: '/dashboard/medical/history',
  problems: '/dashboard/medical/problem-list',
} as const;

/**
 * Shared gate for every /api/medical/patients/[id]/* route: org session, the role rule of the
 * matching medical page, then the id (MedicalPatient id / MRN, or a Client id) resolved inside the
 * caller's org to the Client row, then the full chart access check (resolveChartAccess: roster
 * role, 42 CFR Part 2 via sensitiveAccess, caseload / primary care care-team). Every denial is
 * audited as DENIED, like GET /api/clients/[id]/chart. Nothing is created.
 */
export async function requireMedicalPatient(
  idOrMrn: string,
  opts: { req: Request; action: string; resourceType: string; rule?: string }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  }
  const { req, action, resourceType } = opts;
  const deny = async (status: 403 | 404, reason: string, patientId: string | null) => {
    await auditPhiAccess({ gate, req, action, resourceType, resourceId: null, patientId, outcome: 'DENIED', metadata: { reason } });
    if (reason === 'sensitive_record') {
      return { ok: false as const, response: NextResponse.json({ error: 'SENSITIVE_RECORD', canRequestBreakGlass: true }, { status: 403 }) };
    }
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: status === 404 ? 'Patient not found' : 'Forbidden' }, { status }),
    };
  };

  if (!canAccessPath(gate.role, opts.rule ?? MEDICAL_RULE.patient)) return deny(403, 'role_not_permitted', null);

  // A MedicalPatient id / MRN (older rows) or a Client id (one patient record); nothing is created
  const { medicalPatient: patient, clientId } = await resolveMedicalPatientLink(gate.organizationId, idOrMrn);
  if (!patient && !clientId) return deny(404, 'client_not_found', null);

  if (clientId) {
    const access = await resolveChartAccess(
      { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
      clientId,
      new URL(req.url).pathname
    );
    if (access.ok === false) return deny(access.status, access.reason, clientId);
  } else if (!canAccessClientRoster(gate.role) || isCaseloadScoped({ role: gate.role, userId: gate.userId, organizationId: gate.organizationId })) {
    // Unlinked MedicalPatient row: no assignment / care team to check, so caseload roles are refused
    return deny(403, !canAccessClientRoster(gate.role) ? 'role_not_permitted' : 'not_on_caseload', null);
  }

  return { ok: true as const, gate, patient, medicalPatientId: patient?.id ?? null, clientId };
}

export function providerOnlyResponse() {
  return NextResponse.json(
    { success: false, error: 'Only a physician, nurse practitioner, or practice director can do this.' },
    { status: 403 }
  );
}

export function noLinkedClientResponse() {
  return NextResponse.json(
    {
      success: false,
      error:
        'This medical patient is not linked to a client record, so this entry cannot be saved. Re-run intake or link the patient to a client first.',
    },
    { status: 409 }
  );
}

/**
 * User-facing message for a failed write: the first validation issue for Zod errors,
 * otherwise the generic fallback. Database error text never reaches the browser; callers
 * log only the error name server-side (Prisma messages can echo field values).
 */
export function errorMessage(err: unknown, fallback: string) {
  if (err && typeof err === 'object' && 'issues' in err) {
    const issues = (err as { issues?: { message?: string }[] }).issues;
    return issues?.[0]?.message || fallback;
  }
  return fallback;
}
