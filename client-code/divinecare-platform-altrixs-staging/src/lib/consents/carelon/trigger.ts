/**
 * "Starting a PRP / IOP / residential enrollment or referral automatically prompts for a new
 * Carelon non-overlap attestation" (Maryland Medicaid clients only). Routes call this after their
 * own write succeeds; it never fails the caller and audits what it did.
 */
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { triggerCarelonForProgram } from './store';
import { programTriggersAttestation, serviceLabel } from './workflow';

type Gate = Parameters<typeof auditPhiAccess>[0]['gate'] & { organizationId: string; userId: string; role: string };

export async function promptCarelonForProgram(input: {
  gate: Gate;
  req?: Request;
  clientId: string | null | undefined;
  /** prp | iop | residential (other programs do not auto-trigger) */
  program: string;
  /** e.g. prp_enrollment, prp_referral, service_eligibility_referral, residential_admission */
  trigger: string;
}) {
  if (!input.clientId || !programTriggersAttestation(input.program)) return null;
  const kind = input.trigger.includes('referral') ? 'referral' : 'enrollment';
  const result = await triggerCarelonForProgram({
    organizationId: input.gate.organizationId,
    clientId: input.clientId,
    actorUserId: input.gate.userId,
    actorRole: input.gate.role,
    programLabel: `${serviceLabel(input.program)} ${kind}`,
  });
  if (result && result.ok && result.outcome !== 'not_medicaid') {
    invalidateInboxForOrg(input.gate.organizationId);
    await auditPhiAccess({
      gate: input.gate,
      req: input.req,
      action: 'CREATE',
      resourceType: 'carelonAttestation',
      resourceId: result.id,
      patientId: input.clientId,
      metadata: { outcome: result.outcome, trigger: input.trigger, program: input.program },
    });
  }
  return result;
}
