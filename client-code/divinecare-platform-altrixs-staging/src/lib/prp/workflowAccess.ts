import { canAccessPath } from '@/lib/auth/roleAccess';
import { canPrescribe } from '@/types/roles';

/**
 * Who may read / save the PRP workflow (/api/prp/workflow): the PRP board roles (/dashboard/prp)
 * and the PRP form roles (/dashboard/prp/assessment, incl. Case Manager). Saving an assessment or
 * an IRP body also needs that form's page (/dashboard/prp/assessment, /dashboard/prp/irp).
 */
export function canUsePrpWorkflow(role: string | null | undefined): boolean {
  return canAccessPath(role, '/dashboard/prp/assessment') || canAccessPath(role, '/dashboard/prp');
}

/** Field-level write rule for POST: the reason the role may not send this body, or null. */
export function prpWorkflowWriteBlock(
  role: string | null | undefined,
  body: { assessmentData?: unknown; irpData?: unknown; prescriberNpi?: string | null; prescriberSignature?: string | null },
): string | null {
  if (!canUsePrpWorkflow(role)) return 'role_not_permitted';
  if (body.assessmentData && !canAccessPath(role, '/dashboard/prp/assessment')) return 'assessment_not_permitted';
  if (body.irpData && !canAccessPath(role, '/dashboard/prp/irp')) return 'irp_not_permitted';
  // Prescriber attestation (NPI / signature) belongs to a prescriber only.
  if ((body.prescriberNpi?.trim() || body.prescriberSignature?.trim()) && !canPrescribe(role)) {
    return 'prescriber_fields_not_permitted';
  }
  return null;
}
